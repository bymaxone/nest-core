/**
 * Contract and registration tests for the health feature.
 *
 * Layer: integration (contract).
 * Goal: pin the EXACT serialized JSON for liveness, all-up readiness, and
 * one-down readiness (with its 503 status), against a real, booted Nest
 * application; prove that disabled health registers no controller and
 * exposes no route at all.
 * Mocks: hand-built `IHealthIndicator` stubs, registered through a small
 * `@Global()` sibling module providing `BYMAX_HEALTH_INDICATORS`: the real
 * consumer-override mechanism documented in the technical specification
 * (§4.3). `BymaxCoreModule` binds no local default for this token, so the
 * sibling module's binding reaches `HealthService` directly, with no
 * test-only override utility involved. A real Express Nest app is driven
 * with supertest.
 */
import { Global, Module } from '@nestjs/common'
import type { DynamicModule, INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { BymaxCoreModule } from '../core.module'
import { BYMAX_HEALTH_INDICATORS } from '../core.tokens'
import type { HealthIndicatorResult, IHealthIndicator } from './health.interfaces'

/** Build an indicator whose `check()` resolves immediately with the given result. */
function stubIndicator(name: string, result: HealthIndicatorResult): IHealthIndicator {
  return { name, check: (): Promise<HealthIndicatorResult> => Promise.resolve(result) }
}

/**
 * Build a `@Global()` module binding `BYMAX_HEALTH_INDICATORS` to the given
 * array, mirroring the consumer-override pattern from the technical
 * specification (§4.3): a global module providing the shared token, imported
 * alongside `BymaxCoreModule`.
 */
function indicatorsModule(indicators: IHealthIndicator[]): DynamicModule {
  @Global()
  @Module({
    providers: [{ provide: BYMAX_HEALTH_INDICATORS, useValue: indicators }],
    exports: [BYMAX_HEALTH_INDICATORS]
  })
  class IndicatorsModule {}
  return { module: IndicatorsModule }
}

/** Boot a real Nest app registering the health feature, with the given indicators. */
async function bootAppWithIndicators(indicators: IHealthIndicator[]): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [BymaxCoreModule.forRoot({}), indicatorsModule(indicators)]
  }).compile()
  const app = moduleRef.createNestApplication()
  await app.init()
  return app
}

describe('health contract', () => {
  let app: INestApplication | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  /**
   * Liveness, exact JSON.
   *
   * Liveness must always reply 200 with the documented empty-checks shape,
   * regardless of any registered indicator's state.
   */
  it('pins the JSON for liveness', async () => {
    app = await bootAppWithIndicators([stubIndicator('redis', { status: 'down' })])

    const response = await request(app.getHttpServer()).get('/health/live').expect(200)

    expect(response.body).toEqual({ status: 'ok', checks: [] })
  })

  /**
   * All-up readiness, exact JSON.
   *
   * Every indicator up must reply 200 with status ok and every check's name,
   * status, and details carried through.
   */
  it('pins the JSON for all-up readiness', async () => {
    app = await bootAppWithIndicators([
      stubIndicator('redis', { status: 'up', details: { latencyMs: 2 } }),
      stubIndicator('database', { status: 'up' })
    ])

    const response = await request(app.getHttpServer()).get('/health/ready').expect(200)

    expect(response.body).toEqual({
      status: 'ok',
      checks: [
        { name: 'redis', status: 'up', details: { latencyMs: 2 } },
        { name: 'database', status: 'up' }
      ]
    })
  })

  /**
   * One-down readiness, exact JSON and 503.
   *
   * A single down indicator must reply 503, naming the failing check while
   * still listing every other check's real, unhidden result.
   */
  it('pins the JSON for one-down readiness and replies 503', async () => {
    app = await bootAppWithIndicators([
      stubIndicator('redis', { status: 'up' }),
      stubIndicator('database', { status: 'down', details: { error: 'connection refused' } })
    ])

    const response = await request(app.getHttpServer()).get('/health/ready').expect(503)

    expect(response.body).toEqual({
      status: 'error',
      checks: [
        { name: 'redis', status: 'up' },
        { name: 'database', status: 'down', details: { error: 'connection refused' } }
      ]
    })
  })

  /**
   * Disabled health registers no controller and no route.
   *
   * With the feature disabled, the sync path never builds the health
   * controller, so both endpoints must 404, not merely reply with an error
   * body at the same path.
   */
  it('exposes no health route when disabled', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [BymaxCoreModule.forRoot({ health: { enabled: false } })]
    }).compile()
    app = moduleRef.createNestApplication()
    await app.init()

    await request(app.getHttpServer()).get('/health/live').expect(404)
    await request(app.getHttpServer()).get('/health/ready').expect(404)
  })

  /**
   * No indicators bound at all.
   *
   * `BymaxCoreModule` binds no local default for `BYMAX_HEALTH_INDICATORS`;
   * with no consumer override present either, `HealthService`'s `@Optional()`
   * injection must resolve `undefined` and its constructor default parameter
   * must supply an empty array, so readiness stays vacuously ok rather than
   * failing to resolve the aggregator at all.
   */
  it('aggregates readiness as ok when no indicators are bound anywhere', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [BymaxCoreModule.forRoot({})]
    }).compile()
    app = moduleRef.createNestApplication()
    await app.init()

    const response = await request(app.getHttpServer()).get('/health/ready').expect(200)

    expect(response.body).toEqual({ status: 'ok', checks: [] })
  })
})
