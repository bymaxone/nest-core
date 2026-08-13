/**
 * Unit and integration tests for timing-feature registration on both
 * `BymaxCoreModule` paths.
 *
 * Layer: unit / integration.
 * Goal: prove the sync path provides `BymaxTimingMiddleware` exactly when
 * timing is enabled and no interceptor at all, both at the provider-definition
 * level and end to end through a live request; prove the async path, which must
 * provide the middleware unconditionally, gates it in `configure` instead.
 * Mocks: a spy `ITimingSink`, registered through a small `@Global()` sibling
 * module providing `BYMAX_TIMING_SINK`, the real consumer-override mechanism
 * documented in the technical specification (§4.3): `BymaxCoreModule` binds
 * no local default for this token when the metrics bridge is not registered,
 * so the sibling module's binding reaches the middleware directly, with
 * no test-only override utility involved. A minimal probe controller and a
 * real Express Nest app drive the end-to-end assertions.
 */
import { Controller, Get, Global, Module } from '@nestjs/common'
import type { DynamicModule, INestApplication, Provider } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { BymaxCoreModule } from '../core.module'
import { DEFAULT_METRICS_PATH } from '../core.options'
import { BYMAX_TIMING_SINK } from '../core.tokens'
import { UNMATCHED_ROUTE } from './request-info.accessor'
import { BymaxTimingMiddleware } from './timing.middleware'
import type { ITimingSink, RequestTimingSample } from './timing.interfaces'

/** Extract the injection token of a provider regardless of its shape. */
function tokenOf(provider: Provider): unknown {
  return typeof provider === 'object' && 'provide' in provider ? provider.provide : provider
}

/** Find the provider entry bound to the given token, if any. */
function providerFor(providers: Provider[], token: unknown): Provider | undefined {
  return providers.find((provider) => tokenOf(provider) === token)
}

/** A sink spy recording every sample it receives. */
function recordingSink(): ITimingSink & { samples: RequestTimingSample[] } {
  const samples: RequestTimingSample[] = []
  return {
    samples,
    record: (sample: RequestTimingSample): void => {
      samples.push(sample)
    }
  }
}

/**
 * Build a `@Global()` module binding `BYMAX_TIMING_SINK` to the given sink,
 * mirroring the consumer-override pattern from the technical specification
 * (§4.3): a global module providing the shared token, imported alongside
 * `BymaxCoreModule`.
 */
function sinkModule(sink: ITimingSink): DynamicModule {
  @Global()
  @Module({
    providers: [{ provide: BYMAX_TIMING_SINK, useValue: sink }],
    exports: [BYMAX_TIMING_SINK]
  })
  class SinkModule {}
  return { module: SinkModule }
}

/** Minimal controller whose routes prove whether a sample was recorded. */
@Controller('probe')
class ProbeController {
  @Get('ok')
  ok(): { ok: boolean } {
    return { ok: true }
  }
}

/** Serves the application root, the one path a naive wildcard fails to match. */
@Controller()
class RootController {
  @Get()
  root(): { ok: boolean } {
    return { ok: true }
  }
}

describe('BymaxCoreModule.forRoot, timing registration', () => {
  /**
   * Disabled timing registers nothing.
   *
   * The sync path knows options at definition time, so a disabled timing
   * feature contributes no provider at all — neither the interceptor slot the
   * recorder used to occupy nor the middleware that replaced it. Registering
   * the middleware anyway would be invisible at runtime, since `configure`
   * would decline to apply it, which is exactly why it is asserted here: a
   * disabled feature that still constructs a provider is dead weight nothing
   * else would catch.
   */
  it('registers neither an interceptor nor the middleware when timing is disabled', () => {
    const def: DynamicModule = BymaxCoreModule.forRoot({ timing: { enabled: false } })
    const providers = def.providers ?? []

    expect(providers.map(tokenOf)).not.toContain(APP_INTERCEPTOR)
    expect(providers).not.toContain(BymaxTimingMiddleware)
  })

  /**
   * Enabled timing registers the middleware, not an interceptor.
   *
   * The recorder moved out of the interceptor slot because guards run before
   * interceptors, so every rejection a guard issues — unauthenticated,
   * forbidden, throttled — was invisible to it. The middleware is registered as
   * a plain provider and applied through `configure`; asserting on the absence
   * of `APP_INTERCEPTOR` matters as much as its presence, because two recorders
   * would count every matched request twice.
   */
  it('registers the timing middleware and no interceptor when timing is enabled', () => {
    const def: DynamicModule = BymaxCoreModule.forRoot({ timing: { enabled: true } })
    const providers = def.providers ?? []

    expect(providers).toContain(BymaxTimingMiddleware)
    expect(providerFor(providers, APP_INTERCEPTOR)).toBeUndefined()
  })

  describe('end to end', () => {
    let app: INestApplication | undefined

    afterEach(async () => {
      await app?.close()
      app = undefined
    })

    /**
     * Enabled timing delivers a sample for a real request.
     *
     * Booting a full app proves the sync-path DI wiring resolves (options,
     * sink, and clock all inject cleanly) and that the applied middleware is
     * genuinely active, not merely present in the provider list.
     */
    it('delivers exactly one sample to the sink for a real request', async () => {
      const sink = recordingSink()
      const moduleRef = await Test.createTestingModule({
        imports: [BymaxCoreModule.forRoot({ timing: { enabled: true } }), sinkModule(sink)],
        controllers: [ProbeController]
      }).compile()
      app = moduleRef.createNestApplication()
      await app.init()

      await request(app.getHttpServer()).get('/probe/ok').expect(200, { ok: true })

      expect(sink.samples).toHaveLength(1)
      expect(sink.samples[0]).toMatchObject({ method: 'GET', statusCode: 200 })
    })

    /**
     * Disabled timing never touches the sink.
     *
     * With the feature disabled, the sync path registers no recorder at all,
     * so a real request must leave the sink untouched.
     */
    it('never calls the sink for a real request when timing is disabled', async () => {
      const sink = recordingSink()
      const moduleRef = await Test.createTestingModule({
        imports: [BymaxCoreModule.forRoot({ timing: { enabled: false } }), sinkModule(sink)],
        controllers: [ProbeController]
      }).compile()
      app = moduleRef.createNestApplication()
      await app.init()

      await request(app.getHttpServer()).get('/probe/ok').expect(200, { ok: true })

      expect(sink.samples).toHaveLength(0)
    })

    /**
     * The root path is recorded like any other.
     *
     * Nest 11's migration guide prescribes the braced `'{*splat}'` for "all
     * routes" precisely because the unbraced form requires at least one
     * segment and skips `/`. The two patterns are indistinguishable on every
     * other path, so nothing but a request to the root can tell them apart —
     * and an application whose root is a real endpoint would have had it
     * missing from its metrics with no error anywhere to explain why.
     */
    it('records a request to the application root', async () => {
      const sink = recordingSink()
      const moduleRef = await Test.createTestingModule({
        imports: [BymaxCoreModule.forRoot({ timing: { enabled: true } }), sinkModule(sink)],
        controllers: [RootController]
      }).compile()
      app = moduleRef.createNestApplication()
      await app.init()

      await request(app.getHttpServer()).get('/').expect(200, { ok: true })

      expect(sink.samples).toEqual([expect.objectContaining({ route: '/', statusCode: 200 })])
    })

    /**
     * The root is still recorded once the application takes a global prefix.
     *
     * `setGlobalPrefix` scopes module middleware to the prefix, and the
     * wildcard Nest's migration guide prescribes stops matching the prefixed
     * root there while continuing to match everything below it — nest#14520.
     * Production applications almost always set a prefix, so the case the bug
     * hides is the ordinary one, and only a request to the prefixed root can
     * distinguish the pattern that survives it from the one that does not.
     */
    it('records the prefixed root when the application sets a global prefix', async () => {
      const sink = recordingSink()
      const moduleRef = await Test.createTestingModule({
        imports: [BymaxCoreModule.forRoot({ timing: { enabled: true } }), sinkModule(sink)],
        controllers: [RootController]
      }).compile()
      app = moduleRef.createNestApplication()
      app.setGlobalPrefix('api')
      await app.init()

      await request(app.getHttpServer()).get('/api').expect(200, { ok: true })

      expect(sink.samples).toEqual([expect.objectContaining({ route: '/api', statusCode: 200 })])
    })

    /**
     * A request matching no route is recorded, under a bounded label.
     *
     * This is the case the middleware is applied to every route to reach: no
     * controller runs, so nothing downstream of the router can observe it, and
     * a scan shows up as a flood of these. The label must be the fixed
     * `<unmatched>` and never the requested path, which the caller chooses and
     * could use to mint one time series per probe.
     */
    it('records an unmatched request under the unmatched-route label', async () => {
      const sink = recordingSink()
      const moduleRef = await Test.createTestingModule({
        imports: [BymaxCoreModule.forRoot({ timing: { enabled: true } }), sinkModule(sink)],
        controllers: [ProbeController]
      }).compile()
      app = moduleRef.createNestApplication()
      await app.init()

      await request(app.getHttpServer()).get('/.env').expect(404)

      expect(sink.samples).toEqual([
        expect.objectContaining({ route: UNMATCHED_ROUTE, statusCode: 404 })
      ])
    })

    /**
     * No sink bound anywhere.
     *
     * `BymaxCoreModule` binds no local default for `BYMAX_TIMING_SINK` when
     * the metrics bridge is not registered; with no consumer override present
     * either, the middleware's `@Optional()` injection must resolve
     * `undefined` and fall back to a no-op sink, so a real request still
     * completes normally instead of failing to resolve the middleware.
     */
    it('completes a real request when no sink is bound anywhere', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [BymaxCoreModule.forRoot({ timing: { enabled: true } })],
        controllers: [ProbeController]
      }).compile()
      app = moduleRef.createNestApplication()
      await app.init()

      await request(app.getHttpServer()).get('/probe/ok').expect(200, { ok: true })
    })
  })
})

describe('BymaxCoreModule.forRootAsync, timing registration', () => {
  let app: INestApplication | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  /**
   * Boot an async-registered app whose factory resolves the given options, hit
   * the probe route, and return the exposition text.
   *
   * The assertions read `/metrics` rather than a spy sink because the async
   * path always binds its own `BYMAX_TIMING_SINK` — the metrics bridge — inside
   * `BymaxCoreModule`, which takes precedence over a sibling module's binding
   * for the module's own consumers. Reading the exposition therefore observes
   * the wiring the async path actually has, end to end, instead of a seam
   * substituted for the test.
   */
  async function scrapeAfterProbe(enabled: boolean): Promise<string> {
    const moduleRef = await Test.createTestingModule({
      imports: [
        BymaxCoreModule.forRootAsync({
          useFactory: () => ({ timing: { enabled }, metrics: { enabled: true } })
        })
      ],
      controllers: [ProbeController]
    }).compile()
    app = moduleRef.createNestApplication()
    await app.init()

    await request(app.getHttpServer()).get('/probe/ok').expect(200, { ok: true })
    const scrape = await request(app.getHttpServer()).get(`/${DEFAULT_METRICS_PATH}`).expect(200)
    return scrape.text
  }

  /**
   * The async path records too.
   *
   * The middleware is provided unconditionally here — the resolved options do
   * not exist when the module is defined — so the gate lives entirely in
   * `configure`, which runs after the consumer's factory. The counter must read
   * exactly `1` for the probe: the same "exactly one" the sync path proves,
   * because a second recorder on either path would double every rate an
   * operator alerts on.
   */
  it('counts the request once when the factory enables timing', async () => {
    const exposition = await scrapeAfterProbe(true)

    expect(exposition).toMatch(/^http_requests_total\{[^}]*route="\/probe\/ok"[^}]*\} 1$/m)
  })

  /**
   * A disabled feature stays silent on the async path.
   *
   * The provider is registered regardless, so nothing but `configure`'s gate
   * stops it from running; this asserts that gate rather than the registration
   * that cannot express it. Metrics stay enabled, so the endpoint answers and
   * the absence of the series is the disabled feature rather than a dead
   * endpoint.
   */
  it('counts nothing when the factory disables timing', async () => {
    const exposition = await scrapeAfterProbe(false)

    expect(exposition).not.toMatch(/^http_requests_total\{/m)
  })
})
