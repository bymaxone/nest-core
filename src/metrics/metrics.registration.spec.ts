/**
 * Unit and integration tests for metrics-feature registration on both
 * `BymaxCoreModule` paths.
 *
 * Layer: unit / integration.
 * Goal: prove that disabled metrics register no controller, expose no registry
 * provider, and never load the optional peer `prom-client` (the governing
 * zero-cost invariant); that an enabled sync or async configuration serves the
 * two default HTTP metrics with bounded labels and the applied default labels
 * after a request flows; and that the provider resolvers gate correctly (guarded
 * placeholder when disabled, metrics bridge only when timing and metrics are
 * both enabled).
 * Mocks: a `jest.spyOn` on the lazy `loadPromClient` proves the peer is never
 * loaded when metrics are disabled; a minimal probe controller and a real
 * Express Nest app drive the end-to-end scrape assertions with supertest.
 */
import { Controller, Get } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { normalizeCoreOptions } from '../core.options'
import type { BymaxCoreModuleOptions } from '../core.options'
import { BymaxCoreModule } from '../core.module'
import { BYMAX_METRICS_REGISTRY } from '../core.tokens'
import { NoopTimingSink } from '../defaults.providers'
import { resolveMetricsRegistry, resolveTimingSink } from './metrics.providers'
import { createMetricsRegistry } from './metrics.registry'
import * as registryModule from './metrics.registry'
import { TimingMetricsSink } from './timing-metrics.sink'

/** Minimal controller whose route produces a bounded `route` label on the metrics. */
@Controller('probe')
class ProbeController {
  @Get('ok')
  ok(): { ok: boolean } {
    return { ok: true }
  }
}

/** Extract the class names of a module definition's controllers. */
function controllerNames(controllers: unknown[] | undefined): string[] {
  return (controllers ?? []).map((controller) => (controller as { name: string }).name)
}

/** Boot a sync app registering the core module with the given options. */
async function bootSyncApp(options: BymaxCoreModuleOptions): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [BymaxCoreModule.forRoot(options)],
    controllers: [ProbeController]
  }).compile()
  const app = moduleRef.createNestApplication()
  await app.init()
  return app
}

/** Boot an async app whose core module resolves the given options via a factory. */
async function bootAsyncApp(options: BymaxCoreModuleOptions): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      BymaxCoreModule.forRootAsync({
        inject: [],
        useFactory: (): BymaxCoreModuleOptions => options
      })
    ],
    controllers: [ProbeController]
  }).compile()
  const app = moduleRef.createNestApplication()
  await app.init()
  return app
}

describe('metrics registration, disabled', () => {
  let app: INestApplication | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  /**
   * Zero cost when disabled: no controller.
   *
   * With metrics disabled (the default) the sync path knows the options at
   * definition time and registers no metrics controller and no route.
   */
  it('registers no metrics controller on the sync path when disabled', () => {
    const def = BymaxCoreModule.forRoot({})

    expect(controllerNames(def.controllers)).not.toContain('MetricsController')
  })

  /**
   * Zero cost when disabled: no registry provider, peer never loaded.
   *
   * Booting a disabled configuration must neither resolve a metrics registry
   * provider nor load the optional peer `prom-client`, proving a consumer who
   * leaves metrics off pays nothing.
   */
  it('resolves no registry provider and never loads prom-client when disabled', async () => {
    const loadSpy = jest.spyOn(registryModule, 'loadPromClient')

    app = await bootSyncApp({})

    expect(() => app?.get(BYMAX_METRICS_REGISTRY)).toThrow()
    expect(loadSpy).not.toHaveBeenCalled()
  })
})

describe('metrics registration, sync enabled', () => {
  let app: INestApplication | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  /**
   * Enabled scrape exposes the default HTTP metrics with applied labels.
   *
   * After a real request flows through the timing bridge, the endpoint must
   * serve both HTTP metrics with the bounded label set, the configured default
   * labels, and the Prometheus text content type.
   */
  it('serves both HTTP metrics with bounded and default labels after a request', async () => {
    app = await bootSyncApp({
      metrics: { enabled: true, collectDefaultMetrics: false, defaultLabels: { app: 'svc' } },
      timing: { enabled: true }
    })

    await request(app.getHttpServer()).get('/probe/ok').expect(200, { ok: true })
    const scrape = await request(app.getHttpServer()).get('/metrics').expect(200)

    expect(scrape.headers['content-type']).toMatch(/text\/plain/)
    expect(scrape.text).toContain('http_requests_total{')
    expect(scrape.text).toContain('http_request_duration_seconds_count{')
    expect(scrape.text).toContain('route="/probe/ok"')
    expect(scrape.text).toContain('status_code="200"')
    expect(scrape.text).toContain('app="svc"')
  })

  /**
   * Registry is exported for custom metrics, and the endpoint works without the
   * bridge when timing is disabled.
   *
   * Metrics enabled with timing disabled must still register the registry
   * provider and controller (so applications register their own metrics),
   * exporting the registry token, without wiring the timing-sink bridge.
   */
  it('registers the registry and exports its token when metrics are enabled but timing is disabled', async () => {
    const def = BymaxCoreModule.forRoot({
      metrics: { enabled: true, collectDefaultMetrics: false },
      timing: { enabled: false }
    })

    expect(def.exports).toContain(BYMAX_METRICS_REGISTRY)
    app = await bootSyncApp({
      metrics: { enabled: true, collectDefaultMetrics: false },
      timing: { enabled: false }
    })
    await request(app.getHttpServer()).get('/metrics').expect(200)
  })
})

describe('metrics registration, async enabled', () => {
  let app: INestApplication | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  /**
   * Async enabled scrape works end to end.
   *
   * On the async path the metrics controller and registry are always registered
   * and gate on the resolved options; enabling both features must serve the HTTP
   * metrics after a request, exactly as the sync path does.
   */
  it('serves the HTTP metrics after a request on the async path', async () => {
    app = await bootAsyncApp({
      metrics: { enabled: true, collectDefaultMetrics: false },
      timing: { enabled: true }
    })

    await request(app.getHttpServer()).get('/probe/ok').expect(200, { ok: true })
    const scrape = await request(app.getHttpServer()).get('/metrics').expect(200)

    expect(scrape.text).toContain('http_requests_total{')
  })

  /**
   * Async disabled metrics fail fast at the route.
   *
   * The metrics controller is always registered on the async path, so a scrape
   * against a disabled resolved configuration must fail with a server error
   * instead of serving a disabled feature.
   */
  it('fails the scrape instead of serving it when metrics resolve disabled', async () => {
    app = await bootAsyncApp({ metrics: { enabled: false } })

    await request(app.getHttpServer()).get('/metrics').expect(500)
  })
})

describe('resolveMetricsRegistry', () => {
  /**
   * Disabled resolution yields a guarded placeholder.
   *
   * When metrics are disabled the resolver must return a placeholder that never
   * loaded `prom-client` and throws descriptively on any access, so a stray
   * dereference fails loudly rather than loading the optional peer.
   */
  it('returns a guarded placeholder that throws on access when disabled', async () => {
    const registry = await resolveMetricsRegistry(
      normalizeCoreOptions({ metrics: { enabled: false } })
    )

    // Assert both sentences of the guard message so neither can silently empty
    // out: the disabled-access statement and the actionable remedy.
    expect(() => registry.metrics()).toThrow(
      'The metrics registry was accessed while metrics are disabled.'
    )
    expect(() => registry.metrics()).toThrow(
      'Enable "metrics" in the resolved options before injecting the registry.'
    )
  })
})

describe('resolveTimingSink', () => {
  /**
   * Both enabled binds the metrics bridge.
   *
   * When timing and metrics are both enabled the resolver must produce the
   * `TimingMetricsSink` so samples feed the registry.
   */
  it('returns the metrics bridge when timing and metrics are both enabled', async () => {
    const options = normalizeCoreOptions({
      metrics: { enabled: true, collectDefaultMetrics: false },
      timing: { enabled: true }
    })
    const registry = await createMetricsRegistry(options)

    const sink = await resolveTimingSink(options, registry)

    expect(sink).toBeInstanceOf(TimingMetricsSink)
  })

  /**
   * Metrics disabled falls back to the no-op sink.
   *
   * With metrics disabled the resolver must never touch the placeholder
   * registry and must return the no-op sink.
   */
  it('returns the no-op sink when metrics are disabled', async () => {
    const options = normalizeCoreOptions({ metrics: { enabled: false }, timing: { enabled: true } })
    const registry = await resolveMetricsRegistry(options)

    const sink = await resolveTimingSink(options, registry)

    expect(sink).toBeInstanceOf(NoopTimingSink)
  })

  /**
   * Timing disabled falls back to the no-op sink.
   *
   * With timing disabled the request pipeline emits no samples, so the resolver
   * must return the no-op sink even when metrics are enabled.
   */
  it('returns the no-op sink when timing is disabled', async () => {
    const options = normalizeCoreOptions({
      metrics: { enabled: true, collectDefaultMetrics: false },
      timing: { enabled: false }
    })
    const registry = await createMetricsRegistry(options)

    const sink = await resolveTimingSink(options, registry)

    expect(sink).toBeInstanceOf(NoopTimingSink)
  })
})
