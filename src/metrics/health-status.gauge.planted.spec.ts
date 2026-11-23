/**
 * Tests for the health gauge beside a name planted on `Object.prototype`.
 *
 * Layer: integration.
 * Goal: `prom-client` throws from a write when an enumerable name sits on `Object.prototype`; the
 * readiness route must still answer as documented, so a write of the gauge that throws is dropped.
 * Mocks: none; a real application, a real registry and a real scrape-less readiness route.
 */
import { Global, Module } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { BymaxCoreModule } from '../core.module'
import { BYMAX_HEALTH_INDICATORS } from '../core.tokens'
import { createMetricsRegistry, loadPromClient } from './metrics.registry'
import { normalizeCoreOptions } from '../core.options'
import { HealthStatusGauge } from './health-status.gauge'

@Global()
@Module({
  providers: [
    {
      provide: BYMAX_HEALTH_INDICATORS,
      useValue: [{ name: 'db', check: () => Promise.resolve({ status: 'up' }) }]
    }
  ],
  exports: [BYMAX_HEALTH_INDICATORS]
})
class IndicatorsModule {}

/** Plants an enumerable name on `Object.prototype`, restored by the returned function. */
function plant(name: string): () => void {
  Object.defineProperty(Object.prototype, name, {
    value: 1,
    enumerable: true,
    configurable: true,
    writable: true
  })
  return () => {
    delete (Object.prototype as Record<string, unknown>)[name]
  }
}

describe('the health gauge beside an enumerable name planted on Object.prototype', () => {
  it('drops the write instead of throwing', async () => {
    const registry = await createMetricsRegistry(
      normalizeCoreOptions({ metrics: { enabled: true }, health: { enabled: true } } as never)
    )
    const gauge = new HealthStatusGauge(registry, await loadPromClient())
    const restore = plant('planted')
    try {
      expect(() => gauge.record('db', true)).not.toThrow()
    } finally {
      restore()
    }
  })

  it('answers /health/ready as documented while the realm is polluted', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        BymaxCoreModule.forRoot({ metrics: { enabled: true }, health: { enabled: true } } as never),
        IndicatorsModule
      ]
    }).compile()
    const app: INestApplication = moduleRef.createNestApplication()
    await app.init()
    const restore = plant('planted')
    try {
      const response = await request(app.getHttpServer()).get('/health/ready')

      expect(response.status).toBe(200)
    } finally {
      restore()
      await app.close()
    }
  })
})
