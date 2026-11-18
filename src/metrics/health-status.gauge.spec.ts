/**
 * Unit and integration tests for the `bymax_core_health_status` gauge.
 *
 * Layer: unit / integration.
 * Goal: each readiness check has one series with the single label `indicator`, at `1` while its
 * dependency is up (from the first probe) and `0` while it is down, scraped from `/metrics`, on both
 * registration paths; the gauge and the optional peer are not touched when metrics or health is off.
 * Mocks: a spy on `loadPromClient` proves the peer is not loaded when the gauge is off; the app and
 * the scrape are real, with a switchable indicator.
 */
import { Global, Module } from '@nestjs/common'
import type { DynamicModule, INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { BymaxCoreModule } from '../core.module'
import { normalizeCoreOptions } from '../core.options'
import type { BymaxCoreModuleOptions } from '../core.options'
import { BYMAX_HEALTH_INDICATORS } from '../core.tokens'
import type { IHealthIndicator } from '../health/health.interfaces'
import { BYMAX_HEALTH_STATUS_RECORDER } from '../health/health.status-recorder'
import {
  HealthStatusGauge,
  HEALTH_STATUS_METRIC,
  resolveHealthStatusRecorder
} from './health-status.gauge'
import { createMetricsRegistry, loadPromClient } from './metrics.registry'
import * as registryModule from './metrics.registry'

/** An indicator whose state the test flips. */
class SwitchableIndicator implements IHealthIndicator {
  up = true
  constructor(readonly name: string) {}
  check(): Promise<{ status: 'up' | 'down' }> {
    return Promise.resolve({ status: this.up ? 'up' : 'down' })
  }
}

/** A global module binding the indicators, as a consuming application does. */
function indicatorsModule(indicators: IHealthIndicator[]): DynamicModule {
  @Global()
  @Module({
    providers: [{ provide: BYMAX_HEALTH_INDICATORS, useValue: indicators }],
    exports: [BYMAX_HEALTH_INDICATORS]
  })
  class IndicatorsModule {}
  return { module: IndicatorsModule }
}

/** The options of a test app: health without a cache, metrics as asked. */
function optionsFor(metrics: boolean, health = true): BymaxCoreModuleOptions {
  return {
    health: { enabled: health, readinessCacheMs: 0 },
    metrics: { enabled: metrics }
  }
}

/** Boot an app on the sync or the async path. */
async function boot(
  options: BymaxCoreModuleOptions,
  indicators: IHealthIndicator[],
  asyncPath: boolean
): Promise<INestApplication> {
  const core = asyncPath
    ? BymaxCoreModule.forRootAsync({
        inject: [],
        useFactory: (): BymaxCoreModuleOptions => options
      })
    : BymaxCoreModule.forRoot(options)
  const moduleRef = await Test.createTestingModule({
    imports: [core, indicatorsModule(indicators)]
  }).compile()
  const app = moduleRef.createNestApplication()
  await app.init()
  return app
}

/** The `/metrics` body. */
async function scrape(app: INestApplication): Promise<string> {
  return (await request(app.getHttpServer()).get('/metrics').expect(200)).text
}

describe('HealthStatusGauge', () => {
  it('sets 1 for an up check and 0 for a down one, under the single label indicator', async () => {
    const registry = await createMetricsRegistry(
      normalizeCoreOptions({ metrics: { enabled: true } })
    )
    const gauge = new HealthStatusGauge(registry, await loadPromClient())
    gauge.record('db', true)
    gauge.record('cache', false)
    const body = await registry.metrics()
    expect(body).toContain('# TYPE bymax_core_health_status gauge')
    expect(body).toContain('bymax_core_health_status{indicator="db"} 1')
    expect(body).toContain('bymax_core_health_status{indicator="cache"} 0')
    gauge.record('db', false)
    expect(await registry.metrics()).toContain('bymax_core_health_status{indicator="db"} 0')
  })

  it('carries a help text and the documented name', async () => {
    const registry = await createMetricsRegistry(
      normalizeCoreOptions({ metrics: { enabled: true } })
    )
    new HealthStatusGauge(registry, await loadPromClient())
    expect(HEALTH_STATUS_METRIC).toBe('bymax_core_health_status')
    expect(await registry.metrics()).toContain(
      '# HELP bymax_core_health_status Readiness state of each health check: 1 while its dependency is up, 0 while it is down.'
    )
  })
})

describe('resolveHealthStatusRecorder', () => {
  afterEach(() => jest.restoreAllMocks())

  it.each([
    ['metrics off', { metrics: { enabled: false } }],
    ['health off', { metrics: { enabled: true }, health: { enabled: false } }]
  ])('is undefined and loads nothing with %s', async (_name, options) => {
    const load = jest.spyOn(registryModule, 'loadPromClient')
    const registry = {} as never
    expect(
      await resolveHealthStatusRecorder(normalizeCoreOptions(options as never), registry)
    ).toBeUndefined()
    expect(load).not.toHaveBeenCalled()
  })

  it('is the gauge when metrics and health are both on', async () => {
    const options = normalizeCoreOptions({ metrics: { enabled: true } })
    const registry = await createMetricsRegistry(options)
    expect(await resolveHealthStatusRecorder(options, registry)).toBeInstanceOf(HealthStatusGauge)
  })
})

describe.each([
  ['sync', false],
  ['async', true]
])('the gauge on the %s path', (_name, asyncPath) => {
  let app: INestApplication | undefined
  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  it('reads 1 from the first probe, 0 while the dependency is down, and 1 again after', async () => {
    const indicator = new SwitchableIndicator('db')
    app = await boot(optionsFor(true), [indicator], asyncPath)
    await request(app.getHttpServer()).get('/health/ready').expect(200)
    expect(await scrape(app)).toContain('bymax_core_health_status{indicator="db"} 1')
    indicator.up = false
    await request(app.getHttpServer()).get('/health/ready').expect(503)
    expect(await scrape(app)).toContain('bymax_core_health_status{indicator="db"} 0')
    indicator.up = true
    await request(app.getHttpServer()).get('/health/ready').expect(200)
    expect(await scrape(app)).toContain('bymax_core_health_status{indicator="db"} 1')
  })

  it('has no series for a check that has not been probed, and one per check once it has', async () => {
    app = await boot(
      optionsFor(true),
      [new SwitchableIndicator('a'), new SwitchableIndicator('b')],
      asyncPath
    )
    expect(await scrape(app)).not.toContain('bymax_core_health_status{')
    await request(app.getHttpServer()).get('/health/ready').expect(200)
    const body = await scrape(app)
    expect(body).toContain('bymax_core_health_status{indicator="a"} 1')
    expect(body).toContain('bymax_core_health_status{indicator="b"} 1')
  })

  it('leaves readiness working, with no gauge, when metrics are off', async () => {
    app = await boot(optionsFor(false), [new SwitchableIndicator('db')], asyncPath)
    await request(app.getHttpServer()).get('/health/ready').expect(200)
    await request(app.getHttpServer()).get('/metrics').expect(404)
  })
})

describe('the recorder provider on the sync path', () => {
  /** Whether the module definition binds the recorder token. */
  function bindsRecorder(options: BymaxCoreModuleOptions): boolean {
    return (BymaxCoreModule.forRoot(options).providers ?? []).some(
      (provider) => (provider as { provide?: unknown }).provide === BYMAX_HEALTH_STATUS_RECORDER
    )
  }

  it('is registered only when metrics and health are both on', () => {
    expect(bindsRecorder({ metrics: { enabled: true }, health: { enabled: true } })).toBe(true)
    expect(bindsRecorder({ metrics: { enabled: true }, health: { enabled: false } })).toBe(false)
    expect(bindsRecorder({ metrics: { enabled: false }, health: { enabled: true } })).toBe(false)
  })
})
