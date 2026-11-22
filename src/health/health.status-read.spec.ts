/**
 * Unit tests for the one read of the status an indicator reports.
 *
 * Layer: unit.
 * Goal: the status an indicator answers is read once, so the check the response carries, the aggregate
 * and the transition the service records are the same verdict, whatever a getter answers the second time.
 * Mocks: a hand-built `IHealthIndicator` whose status is a getter.
 */
import { normalizeCoreOptions } from '../core.options'
import type { IHealthIndicator } from './health.interfaces'
import { HealthService } from './health.service'

/** An indicator whose `status` getter answers each value of `answers` in turn, and then the last one. */
function flipping(
  name: string,
  answers: readonly string[]
): { indicator: IHealthIndicator; reads: () => number } {
  let reads = 0
  const indicator = {
    name,
    check: () =>
      Promise.resolve({
        get status(): string {
          reads += 1
          return answers[Math.min(reads - 1, answers.length - 1)] as string
        }
      })
  } as unknown as IHealthIndicator
  return { indicator, reads: () => reads }
}

describe('the status of an indicator that answers differently on a second read', () => {
  it.each([
    ['down then up', ['down', 'up']],
    ['up then down', ['up', 'down']]
  ])('is one verdict when it says %s, with diagnostics off and on', async (_name, answers) => {
    for (const exposeIndicatorErrors of [false, true]) {
      const given = flipping('db', answers)
      const service = new HealthService(
        [given.indicator],
        normalizeCoreOptions({ health: { enabled: true, exposeIndicatorErrors } })
      )

      const result = await service.checkReadiness()

      const check = result.checks[0] as { status: string }
      expect(given.reads()).toBe(1)
      expect(result.status).toBe(check.status === 'up' ? 'ok' : 'error')
      expect(check.status).toBe(answers[0] === 'up' ? 'up' : 'down')
    }
  })
})
