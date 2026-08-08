/**
 * Integration tests for the asynchronous `BymaxCoreModule.forRootAsync` path.
 *
 * Layer: integration.
 * Goal: prove the async factory resolves and normalizes options, the always-on
 * pipeline slots are transparent (a request and a thrown error flow through
 * Nest's default handling unchanged), and the async controller guard answers
 * `404` when its feature is disabled, so a route the async path could not avoid
 * registering reads as absent rather than broken.
 * Mocks: none; a real Express Nest app exercises the pipeline via supertest.
 */
import { Controller, Get, HttpStatus, NotFoundException } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { normalizeCoreOptions } from './core.options'
import type { BymaxCoreModuleOptions } from './core.options'
import { BymaxCoreModule } from './core.module'
import { BYMAX_CORE_OPTIONS, BYMAX_METRICS_REGISTRY, BYMAX_TIMING_SINK } from './core.tokens'
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
   * The async path always exports its resolved tokens.
   *
   * The metrics registry and the timing-sink bridge are always registered on the
   * async path (options are unknown at definition time), so all three tokens,
   * the core options plus both metrics tokens, must appear in the module exports;
   * an empty export list would leave consumers unable to inject them.
   */
  it('exports the core options and both metrics tokens', () => {
    const def = BymaxCoreModule.forRootAsync({ inject: [], useFactory: () => ({}) })

    expect(def.exports).toContain(BYMAX_CORE_OPTIONS)
    expect(def.exports).toContain(BYMAX_TIMING_SINK)
    expect(def.exports).toContain(BYMAX_METRICS_REGISTRY)
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
   * Health is always registered, and reads as absent when resolved disabled.
   *
   * The health controller cannot be conditionally omitted on the async path,
   * since its route metadata is fixed before the async options resolve. A real
   * request against a disabled resolved configuration must therefore answer
   * exactly as it would have had the route never been registered — not serve
   * liveness for a feature the consumer disabled, and not report a server error
   * for a state nothing is wrong with, which a deployment would see in alerting
   * and in its error budget for as long as the feature stays off.
   */
  it('answers 404 rather than serving health when resolved disabled', async () => {
    app = await createAsyncApp(() => ({ health: { enabled: false } }))

    await request(app.getHttpServer()).get('/health/live').expect(404)
  })
})

describe('BymaxCoreModule.forRootAsync, metrics controller guard', () => {
  let app: INestApplication | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  /**
   * Metrics off is the default, and the route must not exist.
   *
   * This is the shape almost every consumer runs: metrics disabled so the
   * optional `prom-client` peer is never loaded. The scrape route is registered
   * regardless, because the async path fixes route metadata before the options
   * resolve, so what a caller finds there is the only thing separating "the
   * feature is off" from "the service is broken". An unauthenticated endpoint
   * answering 500 on every request is a real error in every alert and uptime
   * check pointed at the service.
   */
  it('answers 404 rather than a server error while metrics are disabled', async () => {
    app = await createAsyncApp(() => ({ metrics: { enabled: false } }))

    await request(app.getHttpServer()).get('/metrics').expect(404)
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
   * Disabled feature answers 404.
   *
   * A disabled feature is the ordinary state, not a misconfiguration, so the
   * route it could not avoid registering must read as absent. The status is
   * asserted rather than the message: a caller sees the status, and it is what
   * keeps a deliberately disabled feature out of alerting and error budgets.
   */
  it('throws a 404 naming the feature when disabled', () => {
    expect(() => assertAsyncFeatureEnabled('metrics', false)).toThrow(NotFoundException)
    expect(() => assertAsyncFeatureEnabled('metrics', false)).toThrow(/"metrics"/)
    try {
      assertAsyncFeatureEnabled('metrics', false)
    } catch (error) {
      expect((error as NotFoundException).getStatus()).toBe(HttpStatus.NOT_FOUND)
    }
  })
})
