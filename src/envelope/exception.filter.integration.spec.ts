/**
 * Integration tests for BymaxExceptionFilter through a real Nest application.
 *
 * Layer: integration.
 * Goal: prove the filter is wired as the outermost APP_FILTER on both
 * registration paths, formats real errors into the envelope, reads the request
 * path through the framework-neutral adapter (Express here), and stays
 * production-safe. Also exercises the async selector's envelope-enabled branch.
 * Mocks: none; a real Express Nest app is driven with supertest.
 */
import { Controller, Get, NotFoundException } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import type { BymaxCoreModuleOptions } from '../core.options'
import { BymaxCoreModule } from '../core.module'

/** A controller whose routes throw the errors under test. */
@Controller('probe')
class ProbeController {
  @Get('missing')
  missing(): never {
    throw new NotFoundException('resource gone')
  }

  @Get('boom')
  boom(): never {
    throw new Error('secret internal detail')
  }
}

/** Boot an app registering the core module synchronously. */
async function createSyncApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [BymaxCoreModule.forRoot()],
    controllers: [ProbeController]
  }).compile()
  const app = moduleRef.createNestApplication()
  await app.init()
  return app
}

/** Boot an app registering the core module asynchronously. */
async function createAsyncApp(factory: () => BymaxCoreModuleOptions): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [BymaxCoreModule.forRootAsync({ inject: [], useFactory: factory })],
    controllers: [ProbeController]
  }).compile()
  const app = moduleRef.createNestApplication()
  await app.init()
  return app
}

describe('BymaxExceptionFilter integration', () => {
  let app: INestApplication | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  /**
   * Sync path formats an HttpException into the envelope.
   *
   * With the module registered synchronously and the envelope enabled, a
   * NotFoundException must reach the client as the envelope with the catalog
   * code and the real Express request path, proving the neutral accessor works.
   */
  it('formats an HttpException into the envelope on the sync path', async () => {
    app = await createSyncApp()

    const response = await request(app.getHttpServer()).get('/probe/missing').expect(404)

    expect(response.body).toMatchObject({
      statusCode: 404,
      code: 'BYMAX_NOT_FOUND',
      message: 'resource gone',
      path: '/probe/missing'
    })
    expect(typeof response.body.timestamp).toBe('string')
  })

  /**
   * Sync path collapses an unknown error without leaking.
   *
   * An unhandled Error must collapse to the generic 500 envelope, and the
   * serialized response must contain neither the original message nor a stack.
   */
  it('collapses an unknown error to a safe 500 on the sync path', async () => {
    app = await createSyncApp()

    const response = await request(app.getHttpServer()).get('/probe/boom').expect(500)

    expect(response.body).toMatchObject({
      statusCode: 500,
      code: 'BYMAX_INTERNAL_ERROR',
      message: 'Internal server error'
    })
    expect(JSON.stringify(response.body)).not.toContain('secret internal detail')
    expect(response.body).not.toHaveProperty('details')
  })

  /**
   * Async path uses the real filter when the envelope is enabled.
   *
   * With the envelope enabled on the async path, the always-on APP_FILTER slot
   * must resolve the real filter (not the pass-through) and emit the envelope,
   * covering the enabled branch of the async selector.
   */
  it('formats an HttpException into the envelope on the async path when enabled', async () => {
    app = await createAsyncApp(() => ({ envelope: { enabled: true } }))

    const response = await request(app.getHttpServer()).get('/probe/missing').expect(404)

    expect(response.body).toMatchObject({ statusCode: 404, code: 'BYMAX_NOT_FOUND' })
  })
})
