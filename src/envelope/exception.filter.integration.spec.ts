/**
 * Integration tests for BymaxExceptionFilter through a real Nest application.
 *
 * Layer: integration.
 * Goal: prove the filter is wired as the outermost APP_FILTER on both
 * registration paths, formats real errors into the envelope, reads the request
 * path through the framework-neutral adapter (Express here), and stays
 * production-safe. Also exercises the async selector's envelope-enabled branch
 * and the real consumer-override mechanism for the correlation provider (§4.3
 * of the technical specification): a `@Global()` sibling module providing
 * `BYMAX_CORRELATION_PROVIDER`, imported alongside `BymaxCoreModule`, with no
 * test-only override utility involved.
 * Mocks: none; a real Express Nest app is driven with supertest.
 */
import { Controller, Get, Global, Injectable, Module, NotFoundException } from '@nestjs/common'
import type { DynamicModule, INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import type { BymaxCoreModuleOptions } from '../core.options'
import { BymaxCoreModule } from '../core.module'
import { BYMAX_CORRELATION_PROVIDER } from '../core.tokens'
import type { ICorrelationIdProvider } from './correlation.interfaces'

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
async function createSyncApp(extraImports: DynamicModule[] = []): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [BymaxCoreModule.forRoot(), ...extraImports],
    controllers: [ProbeController]
  }).compile()
  const app = moduleRef.createNestApplication()
  await app.init()
  return app
}

/**
 * Build a `@Global()` module binding `BYMAX_CORRELATION_PROVIDER` to a fixed
 * id, mirroring the consumer-override pattern from the technical
 * specification (§4.3): a global module providing the shared token, imported
 * alongside `BymaxCoreModule`.
 */
function fixedCorrelationModule(id: string): DynamicModule {
  @Injectable()
  class FixedCorrelationProvider implements ICorrelationIdProvider {
    getCorrelationId(): string {
      return id
    }
  }

  @Global()
  @Module({
    providers: [
      FixedCorrelationProvider,
      { provide: BYMAX_CORRELATION_PROVIDER, useExisting: FixedCorrelationProvider }
    ],
    exports: [BYMAX_CORRELATION_PROVIDER]
  })
  class ObservabilityModule {}
  return { module: ObservabilityModule }
}

/** Boot an app registering the core module asynchronously. */
async function createAsyncApp(
  factory: () => BymaxCoreModuleOptions,
  extraImports: DynamicModule[] = []
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [BymaxCoreModule.forRootAsync({ inject: [], useFactory: factory }), ...extraImports],
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
   * Consumer correlation-provider override reaches the filter, end to end.
   *
   * `BymaxCoreModule` binds no local default for `BYMAX_CORRELATION_PROVIDER`;
   * a consumer's own `@Global()` module providing that token (the pattern
   * documented in the technical specification §4.3) must be the value the
   * real, DI-instantiated `BymaxExceptionFilter` uses to stamp
   * `correlationId`, proving the override is not shadowed by a competing
   * local binding.
   */
  it('stamps correlationId from a consumer-bound correlation provider on the sync path', async () => {
    app = await createSyncApp([fixedCorrelationModule('req-correlation-id')])

    const response = await request(app.getHttpServer()).get('/probe/missing').expect(404)

    expect(response.body).toMatchObject({
      code: 'BYMAX_NOT_FOUND',
      correlationId: 'req-correlation-id'
    })
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

  /**
   * Consumer correlation-provider override reaches the async slot factory.
   *
   * The always-on `APP_FILTER` slot injects `BYMAX_CORRELATION_PROVIDER` as an
   * optional factory dependency; a consumer's own `@Global()` module for that
   * token must reach the real filter it constructs, exactly as on the sync
   * path.
   */
  it('stamps correlationId from a consumer-bound correlation provider on the async path', async () => {
    app = await createAsyncApp(
      () => ({ envelope: { enabled: true } }),
      [fixedCorrelationModule('async-correlation-id')]
    )

    const response = await request(app.getHttpServer()).get('/probe/missing').expect(404)

    expect(response.body).toMatchObject({
      code: 'BYMAX_NOT_FOUND',
      correlationId: 'async-correlation-id'
    })
  })
})
