/**
 * Tests for readiness during shutdown.
 *
 * Layer: unit and integration.
 * Goal: pin that readiness answers not ready from the moment shutdown begins, whatever was cached
 * or running, and that Nest's own close path is what triggers it.
 * Mocks: indicators are stubs; the application is a real Nest application.
 */
import { Test } from '@nestjs/testing'

import { BymaxCoreModule } from '../core.module'
import { normalizeCoreOptions } from '../core.options'
import type { HealthIndicatorResult, IHealthIndicator } from './health.interfaces'
import { HealthService } from './health.service'

const NOT_READY = { status: 'error', checks: [{ name: 'shutdown', status: 'down' }] }

/** An indicator that counts its calls and answers with the result the test sets. */
function countingIndicator(result: HealthIndicatorResult = { status: 'up' }): {
  indicator: IHealthIndicator
  calls: () => number
} {
  let calls = 0
  return {
    indicator: {
      name: 'db',
      check: (): Promise<HealthIndicatorResult> => {
        calls += 1
        return Promise.resolve(result)
      }
    },
    calls: () => calls
  }
}

describe('HealthService during shutdown', () => {
  it('answers not ready at once although a healthy answer is cached', async () => {
    const probe = countingIndicator()
    const service = new HealthService(
      [probe.indicator],
      normalizeCoreOptions({ health: { readinessCacheMs: 60_000 } })
    )
    await expect(service.checkReadiness()).resolves.toMatchObject({ status: 'ok' })
    service.beforeApplicationShutdown()
    await expect(service.checkReadiness()).resolves.toEqual(NOT_READY)
    expect(probe.calls()).toBe(1)
  })

  it('does not wait for a run in progress, and does not cache what it finds', async () => {
    let release: (result: HealthIndicatorResult) => void = () => undefined
    const slow: IHealthIndicator = {
      name: 'db',
      check: () =>
        new Promise<HealthIndicatorResult>((resolve) => {
          release = resolve
        })
    }
    const service = new HealthService(
      [slow],
      normalizeCoreOptions({ health: { readinessCacheMs: 60_000 } })
    )
    const running = service.checkReadiness()
    await Promise.resolve()
    service.beforeApplicationShutdown()
    await expect(service.checkReadiness()).resolves.toEqual(NOT_READY)
    release({ status: 'up' })
    await running
    await expect(service.checkReadiness()).resolves.toEqual(NOT_READY)
  })

  it('runs no indicator once shutdown has begun', async () => {
    const probe = countingIndicator()
    const service = new HealthService([probe.indicator], normalizeCoreOptions())
    service.beforeApplicationShutdown()
    await service.checkReadiness()
    expect(probe.calls()).toBe(0)
  })

  it('flips to not ready when the application closes', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [BymaxCoreModule.forRoot({ health: { readinessCacheMs: 60_000 } })]
    }).compile()
    const app = moduleRef.createNestApplication()
    await app.init()
    const service = app.get(HealthService)
    await expect(service.checkReadiness()).resolves.toMatchObject({ status: 'ok' })
    await app.close()
    await expect(service.checkReadiness()).resolves.toEqual(NOT_READY)
  })
})
