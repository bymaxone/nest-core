/**
 * Unit tests for the names a host's marked provider answers while discovery reads them.
 *
 * Layer: unit.
 * Goal: a class whose `name` throws, and an indicator whose `name` answers once and then throws,
 * fail the boot as a labelled error with what the host threw as the cause, and no host text in the
 * message.
 * Mocks: a scanner that lists the provider under test.
 */
import { Reflector } from '@nestjs/core'

import { discoverIndicators, mergeIndicators } from './health/health.discovery'
import { BymaxHealthIndicator } from './health/health.marker'
import { BymaxMetricsContributor } from './metrics/metrics.contract'
import { discoverContributors } from './metrics/metrics.contribution'

const SECRET = 'SECRET-host-text'
const reflector = new Reflector()

/** What `read` throws, or `undefined`. */
function thrownBy(read: () => unknown): Error | undefined {
  try {
    read()
  } catch (error) {
    return error as Error
  }
  return undefined
}

/** An indicator whose name answers for the first `answers` reads and throws after. */
function indicatorNamedOnce(answers: number): object {
  let reads = 0
  return {
    get name(): string {
      reads += 1
      if (reads > answers) throw new Error(SECRET)
      return 'qa'
    },
    check: () => Promise.resolve({ status: 'up' })
  }
}

describe('a name the host answers while discovery reads it', () => {
  it('a class whose static name throws fails as a boot error with the host error as cause', () => {
    @BymaxMetricsContributor()
    class Queue {
      registerMetrics(): void {}
    }

    Object.defineProperty(Queue, 'name', {
      get: () => {
        throw new Error(SECRET)
      }
    })
    const error = thrownBy(() =>
      discoverContributors(
        { getProviders: () => [{ metatype: Queue, instance: new Queue(), name: 'Queue' }] },
        reflector
      )
    )
    expect(error?.message).toMatch(/^\[BymaxCoreModule\] a marked provider could not be read/)
    expect(error?.message).not.toContain(SECRET)
    expect((error?.cause as Error).message).toBe(SECRET)
  })

  it('a discovered indicator whose name throws fails as a boot error naming the provider', () => {
    @BymaxHealthIndicator()
    class Database {}

    const error = thrownBy(() =>
      discoverIndicators(
        {
          getProviders: () => [
            { metatype: Database, instance: indicatorNamedOnce(0), name: 'Database' }
          ]
        },
        reflector
      )
    )
    expect(error?.message).toBe(
      '[BymaxCoreModule] a provider marked @BymaxHealthIndicator() could not be read'
    )
    expect(error).toMatchObject({ provider: 'Database' })
    expect((error?.cause as Error).message).toBe(SECRET)
  })

  it('an explicit indicator whose name throws fails the merge as a boot error', () => {
    const error = thrownBy(() => mergeIndicators([indicatorNamedOnce(0) as never], []))
    expect(error?.message).toMatch(/^\[BymaxCoreModule\] a health indicator name could not be read/)
    expect((error?.cause as Error).message).toBe(SECRET)
  })

  it('reads the name of each discovered indicator exactly once, whatever the sort compares', () => {
    @BymaxHealthIndicator()
    class Database {}

    const reads = new Map<string, number>()
    const indicator = (name: string): object => ({
      get name(): string {
        reads.set(name, (reads.get(name) ?? 0) + 1)
        return name
      },
      check: () => Promise.resolve({ status: 'up' })
    })
    const found = discoverIndicators(
      {
        getProviders: () =>
          ['d', 'b', 'c', 'a', 'e'].map((name) => ({
            metatype: Database,
            instance: indicator(name),
            name
          }))
      },
      reflector
    )
    expect([...reads.values()]).toEqual([1, 1, 1, 1, 1])
    expect(found.map((item) => item.name)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it.each([42, '', undefined])(
    'an explicit indicator whose name is %p fails the merge as a boot error',
    (name) => {
      const explicit = { name, check: () => Promise.resolve({ status: 'up' }) }
      const error = thrownBy(() => mergeIndicators([explicit as never], []))
      expect(error?.message).toMatch(
        /^\[BymaxCoreModule\] a health indicator name must be a non-empty string/
      )
    }
  )
})
