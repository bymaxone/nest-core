/**
 * Unit tests for the properties of an indicator result when diagnostics are off.
 *
 * Layer: unit.
 * Goal: with `health.exposeIndicatorErrors` off, only `status` of an indicator result is read, so a
 * diagnostic property that cannot be computed never turns an up indicator down; with it on, the copy of
 * the diagnostics keeps its behaviour.
 * Mocks: a hand-built `IHealthIndicator` whose `details` is a getter that throws.
 */
import { normalizeCoreOptions } from '../core.options'
import type { IHealthIndicator } from './health.interfaces'
import { HealthService } from './health.service'

/** An up indicator whose `details` getter throws and counts its reads. */
function throwingDetails(): { indicator: IHealthIndicator; reads: () => number } {
  let reads = 0
  const indicator = {
    name: 'db',
    check: () =>
      Promise.resolve({
        status: 'up',
        get details(): never {
          reads += 1
          throw new Error('diagnostic unavailable')
        }
      })
  } as unknown as IHealthIndicator
  return { indicator, reads: () => reads }
}

describe('an indicator whose diagnostic property throws', () => {
  it('stays up and is never read when diagnostics are off', async () => {
    const given = throwingDetails()
    const service = new HealthService(
      [given.indicator],
      normalizeCoreOptions({ health: { enabled: true, exposeIndicatorErrors: false } })
    )

    const result = await service.checkReadiness()

    expect(result.status).toBe('ok')
    expect(result.checks).toEqual([{ name: 'db', status: 'up' }])
    expect(given.reads()).toBe(0)
  })

  it('is down with the rejection message when diagnostics are on', async () => {
    const given = throwingDetails()
    const service = new HealthService(
      [given.indicator],
      normalizeCoreOptions({ health: { enabled: true, exposeIndicatorErrors: true } })
    )

    const result = await service.checkReadiness()

    expect(result.status).toBe('error')
    expect(result.checks[0]).toMatchObject({ name: 'db', status: 'down' })
    expect(given.reads()).toBe(1)
  })
})
