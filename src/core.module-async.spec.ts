/**
 * Integration tests for the asynchronous `BymaxCoreModule.forRootAsync` path.
 *
 * Layer: integration.
 * Goal: prove the async factory resolves and normalizes options, the always-on
 * pipeline slots are transparent (a request and a thrown error flow through
 * Nest's default handling unchanged), and the async controller guard fails fast
 * when its feature is disabled.
 * Mocks: none; a real Express Nest app exercises the pipeline via supertest.
 */
import { Controller, Get, NotFoundException } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { normalizeCoreOptions } from './core.options'
import type { BymaxCoreModuleOptions } from './core.options'
import { BymaxCoreModule } from './core.module'
import { BYMAX_CORE_OPTIONS } from './core.tokens'
import { assertAsyncFeatureEnabled } from './passthrough.providers'

/** Minimal controller whose responses reveal any pipeline interference. */
@Controller('probe')
class ProbeController {
  @Get('ok')
  ok(): { ok: boolean } {
    return { ok: true }
  }

  @Get('boom')
  boom(): never {
    throw new NotFoundException('missing')
  }
}

/** Build and initialize an app whose core module registers via the async path. */
async function createAsyncApp(factory: () => BymaxCoreModuleOptions): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [BymaxCoreModule.forRootAsync({ inject: [], useFactory: factory })],
    controllers: [ProbeController]
  }).compile()
  const app = moduleRef.createNestApplication()
  await app.init()
  return app
}

describe('BymaxCoreModule.forRootAsync', () => {
  let app: INestApplication | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  /**
   * Factory resolution and normalization.
   *
   * The async factory output must reach BYMAX_CORE_OPTIONS as the frozen,
   * defaults-applied snapshot, never as the raw partial input.
   */
  it('normalizes and freezes the options produced by the injected factory', async () => {
    app = await createAsyncApp(() => ({ health: { path: 'zzz' } }))

    const options = app.get(BYMAX_CORE_OPTIONS)

    expect(options).toEqual(normalizeCoreOptions({ health: { path: 'zzz' } }))
    expect(Object.isFrozen(options)).toBe(true)
  })

  /**
   * Interceptor pass-through is transparent.
   *
   * With timing disabled the always-on interceptor slot must forward the
   * handler result unchanged.
   */
  it('leaves a successful response unchanged when timing is disabled', async () => {
    app = await createAsyncApp(() => ({ timing: { enabled: false } }))

    await request(app.getHttpServer()).get('/probe/ok').expect(200, { ok: true })
  })

  /**
   * Filter pass-through is transparent.
   *
   * With the envelope disabled the always-on filter slot must reproduce Nest's
   * default error body: the correct status and message and no BYMAX_ envelope
   * code, proving the envelope feature is not active.
   */
  it('formats a thrown error with Nest defaults when the envelope is disabled', async () => {
    app = await createAsyncApp(() => ({ envelope: { enabled: false } }))

    const response = await request(app.getHttpServer()).get('/probe/boom').expect(404)

    expect(response.body).toMatchObject({ statusCode: 404, message: 'missing' })
    expect(response.body).not.toHaveProperty('code')

    // A second error reuses the delegate built on the first catch, proving the
    // cached-delegate path is transparent and still formats Nest's default body.
    const repeat = await request(app.getHttpServer()).get('/probe/boom').expect(404)

    expect(repeat.body).toMatchObject({ statusCode: 404, message: 'missing' })
    expect(repeat.body).not.toHaveProperty('code')
  })
})

describe('BymaxCoreModule.forRootAsync, health controller guard', () => {
  let app: INestApplication | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  /**
   * Health is always registered, but fails fast when resolved disabled.
   *
   * The health controller cannot be conditionally omitted on the async path,
   * since its route metadata is fixed before the async options resolve. A
   * real request against a disabled resolved configuration must therefore
   * fail with a server error instead of silently serving liveness or
   * readiness for a feature the consumer asked to disable.
   */
  it('fails a real request instead of silently serving health when resolved disabled', async () => {
    app = await createAsyncApp(() => ({ health: { enabled: false } }))

    await request(app.getHttpServer()).get('/health/live').expect(500)
  })
})

describe('assertAsyncFeatureEnabled', () => {
  /**
   * Enabled feature passes.
   *
   * A controller reached while its feature is enabled must proceed without
   * error.
   */
  it('does not throw when the feature is enabled', () => {
    expect(() => assertAsyncFeatureEnabled('health', true)).not.toThrow()
  })

  /**
   * Disabled feature fails fast.
   *
   * Reaching a controller whose feature is disabled on the async path must throw
   * a descriptive configuration error naming the feature.
   */
  it('throws a descriptive error naming the feature when disabled', () => {
    expect(() => assertAsyncFeatureEnabled('metrics', false)).toThrow(/"metrics"/)
  })
})
