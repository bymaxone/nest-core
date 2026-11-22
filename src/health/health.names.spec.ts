/**
 * Unit tests for the names `HealthService` serves.
 *
 * Layer: unit.
 * Goal: an indicator's name is read once, when the readiness set is resolved, and every probe, the
 * merge with the registered indicators and the log serve that name, so a name that changes or starts
 * to throw afterwards cannot break a probe or change which indicator is dropped as a duplicate.
 * Mocks: hand-built indicators whose name is a getter that counts its reads.
 */
import { Reflector } from '@nestjs/core'

import { normalizeCoreOptions } from '../core.options'
import type { IHealthIndicator } from './health.interfaces'
import { BymaxHealthIndicator } from './health.marker'
import { HealthService } from './health.service'

/** An indicator that is up, named by `answer` on its n-th read (1-based). */
function named(answer: (read: number) => unknown): IHealthIndicator {
  let reads = 0
  return {
    get name(): string {
      reads += 1
      return answer(reads) as string
    },
    check: () => Promise.resolve({ status: 'up' as const })
  }
}

@BymaxHealthIndicator()
class Marked {}

const reflector = new Reflector()
const discovering = normalizeCoreOptions({ health: { autoDiscover: true, readinessCacheMs: 0 } })

describe('the name a probe serves is the one read when the set was resolved', () => {
  it('an explicit indicator whose name throws after it was read is still served by that name', async () => {
    const indicator = named((read) => {
      if (read > 1) throw new Error('name is gone')
      return 'database'
    })
    const service = new HealthService(
      [indicator],
      normalizeCoreOptions({ health: { readinessCacheMs: 0 } })
    )
    service.onApplicationBootstrap()

    const first = await service.checkReadiness()
    const second = await service.checkReadiness()

    expect(first).toEqual({ status: 'ok', checks: [{ name: 'database', status: 'up' }] })
    expect(second).toEqual(first)
  })

  it.each(['', 42, undefined])(
    'an explicit indicator whose name is %p fails the boot when discovery is off',
    (name) => {
      const indicator = { name, check: () => Promise.resolve({ status: 'up' as const }) }
      const service = new HealthService(
        [indicator as never],
        normalizeCoreOptions({ health: { readinessCacheMs: 0 } })
      )

      expect(() => service.onApplicationBootstrap()).toThrow(
        '[BymaxCoreModule] a health indicator name must be a non-empty string'
      )
    }
  )

  it('a discovered indicator whose name changes after discovery is served by the name it had', async () => {
    const indicator = named((read) => (read <= 3 ? 'queue' : 'renamed'))
    const scanner = {
      getProviders: () => [{ metatype: Marked, instance: indicator, name: 'Marked' }]
    }
    const service = new HealthService([], discovering, scanner, reflector)
    service.onApplicationBootstrap()

    const response = await service.checkReadiness()

    expect(response.checks.map((check) => check.name)).toEqual(['queue'])
  })

  it('a discovered name that changes into a registered one is not dropped as its duplicate', async () => {
    const registered = named(() => 'database')
    const discovered = named((read) => (read <= 3 ? 'queue' : 'database'))
    const scanner = {
      getProviders: () => [{ metatype: Marked, instance: discovered, name: 'Marked' }]
    }
    const service = new HealthService([registered], discovering, scanner, reflector)

    const response = await service.checkReadiness()

    expect(response.checks.map((check) => check.name)).toEqual(['database', 'queue'])
  })

  it('a disabled health feature reads no name, so a misdeclared indicator cannot fail its boot', () => {
    const broken = named(() => {
      throw new Error('name is gone')
    })
    const disabled = normalizeCoreOptions({ health: { enabled: false } })
    const service = new HealthService([broken], disabled)

    expect(() => service.onApplicationBootstrap()).not.toThrow()
  })
})
