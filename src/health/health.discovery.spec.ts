/**
 * Unit tests for indicator discovery and the explicit/discovered merge.
 *
 * Layer: unit.
 * Goal: prove the scan keeps exactly the marked providers, refuses a marked
 * provider that does not implement the contract instead of skipping it, returns
 * a stable order, and that merging never lets discovery displace or reorder what
 * the application registered by hand.
 * Mocks: the provider graph is expressed as plain objects against the structural
 * `ProviderScanner` contract; metadata is read by the real `Reflector`.
 */
import { Reflector } from '@nestjs/core'

import type { ProviderNode } from '../discovery'
import { discoverIndicators, mergeIndicators } from './health.discovery'
import { BymaxHealthIndicator } from './health.marker'
import type { HealthIndicatorResult, IHealthIndicator } from './health.interfaces'

/** Build an indicator that always reports the given status. */
function indicator(name: string, status: 'up' | 'down' = 'up'): IHealthIndicator {
  return {
    name,
    check: async (): Promise<HealthIndicatorResult> => ({ status })
  }
}

/** A marked, contract-satisfying indicator class. */
@BymaxHealthIndicator()
class RedisIndicator {
  readonly name = 'redis'

  /**
   * Report healthy.
   *
   * @returns An `up` result.
   */
  async check(): Promise<HealthIndicatorResult> {
    return { status: 'up' }
  }
}

/** A second marked indicator, named so it sorts before the first. */
@BymaxHealthIndicator()
class DatabaseIndicator {
  readonly name = 'database'

  /**
   * Report healthy.
   *
   * @returns An `up` result.
   */
  async check(): Promise<HealthIndicatorResult> {
    return { status: 'up' }
  }
}

/** A marked class that forgot to implement the contract. */
@BymaxHealthIndicator()
class IncompleteIndicator {
  readonly name = 'incomplete'
}

/** An ordinary provider, marked by nobody. */
class OrdinaryService {
  readonly name = 'ordinary'

  /**
   * A method that merely shares the contract's shape.
   *
   * @returns An `up` result.
   */
  async check(): Promise<HealthIndicatorResult> {
    return { status: 'up' }
  }
}

/** Build a scanner over the given provider entries. */
function scannerOver(nodes: readonly ProviderNode[]): { getProviders(): readonly ProviderNode[] } {
  return { getProviders: () => nodes }
}

/** Build the provider entry Nest would produce for a class provider. */
function nodeFor(metatype: new () => object): ProviderNode {
  return { metatype, instance: new metatype(), name: metatype.name }
}

describe('discoverIndicators', () => {
  const reflector = new Reflector()

  /**
   * Only marked providers are collected.
   *
   * A provider that merely looks like an indicator must be ignored: scraping one
   * into readiness would let an unrelated failure take the application out of
   * rotation, which is the risk the marker exists to prevent.
   */
  it('collects marked providers and ignores everything else', () => {
    const nodes = [nodeFor(RedisIndicator), nodeFor(OrdinaryService)]

    const discovered = discoverIndicators(scannerOver(nodes), reflector)

    expect(discovered.map((entry) => entry.name)).toEqual(['redis'])
  })

  /**
   * The order is stable, not the container's.
   *
   * Provider order depends on module resolution, which can shift between
   * restarts; a readiness response whose `checks` array reorders itself is
   * hostile to anything diffing or asserting on it.
   */
  it('returns discovered indicators sorted by name', () => {
    const nodes = [nodeFor(RedisIndicator), nodeFor(DatabaseIndicator)]

    const discovered = discoverIndicators(scannerOver(nodes), reflector)

    expect(discovered.map((entry) => entry.name)).toEqual(['database', 'redis'])
  })

  /**
   * A marked provider that does not implement the contract fails loudly.
   *
   * Skipping it would leave an operator believing a check runs when it never
   * does — the one failure mode a readiness probe must never have. The message
   * names the class so the fix is obvious.
   */
  it('throws naming the class when a marked provider is not an indicator', () => {
    // The token deliberately differs from the class name: the message must
    // identify the class a reader has to fix, not the token it was bound under.
    const nodes: ProviderNode[] = [
      {
        metatype: IncompleteIndicator,
        instance: new IncompleteIndicator(),
        name: 'SOME_OTHER_TOKEN'
      }
    ]

    // The whole message is asserted: it has to say which provider, that the
    // marker is what put it in scope, and what the contract requires — dropping
    // any of the three sends the reader back to this package's source.
    expect(() => discoverIndicators(scannerOver(nodes), reflector)).toThrow(
      '[BymaxCoreModule] "IncompleteIndicator" is marked with @BymaxHealthIndicator() but does not ' +
        'implement IHealthIndicator: it must expose a non-empty "name" and a "check" method.'
    )
  })

  /**
   * A marked provider resolved to a primitive. Edge case: non-object instance.
   *
   * A `useValue` provider bound to a string cannot carry the marker, but a class
   * provider whose instance is replaced can; the contract check must reject it
   * with the descriptive error rather than crashing while inspecting it.
   */
  it.each([
    ['a string', 'not-an-object'],
    ['a number', 42],
    ['null', null],
    ['undefined', undefined]
  ])('rejects a marked provider whose instance is %s', (_label, instance) => {
    const nodes: ProviderNode[] = [
      { metatype: IncompleteIndicator, instance, name: 'PRIMITIVE_TOKEN' }
    ]

    expect(() => discoverIndicators(scannerOver(nodes), reflector)).toThrow(
      /does not implement IHealthIndicator/
    )
  })

  /**
   * A marked indicator whose name is not a string. Edge case: wrong type.
   *
   * The name is interpolated into the response and used to deduplicate against
   * explicit registrations; a non-string would break both, so it is rejected
   * rather than coerced.
   */
  it('rejects a marked indicator whose name is not a string', () => {
    const numeric = {
      name: 42,
      check: async (): Promise<HealthIndicatorResult> => ({ status: 'up' as const })
    }
    const nodes: ProviderNode[] = [
      { metatype: IncompleteIndicator, instance: numeric, name: 'NUMERIC_TOKEN' }
    ]

    expect(() => discoverIndicators(scannerOver(nodes), reflector)).toThrow(
      /does not implement IHealthIndicator/
    )
  })

  /**
   * A provider with no class is skipped. Edge case: value provider.
   *
   * `useValue` and `useFactory` providers have no metatype to carry metadata, so
   * they can never be marked; reading metadata off them would throw.
   */
  it('skips providers that have no class', () => {
    const nodes: ProviderNode[] = [
      { metatype: null, instance: indicator('from-value'), name: 'VALUE_TOKEN' },
      nodeFor(RedisIndicator)
    ]

    const discovered = discoverIndicators(scannerOver(nodes), reflector)

    expect(discovered.map((entry) => entry.name)).toEqual(['redis'])
  })

  /**
   * A marked provider whose instance is not an object. Edge case.
   *
   * The failure message falls back to the provider token when there is no usable
   * class name, so the error still points at something the reader can find.
   */
  it('names the provider token when the marked class has no name', () => {
    const anonymous = class {}
    // A class expression inherits the variable's name, so the name is cleared
    // explicitly to reproduce a genuinely anonymous provider class.
    Object.defineProperty(anonymous, 'name', { value: '' })
    Reflect.defineMetadata('bymax-one:health-indicator', true, anonymous)
    const nodes: ProviderNode[] = [{ metatype: anonymous, instance: null, name: 'ANON_TOKEN' }]

    expect(() => discoverIndicators(scannerOver(nodes), reflector)).toThrow(/"ANON_TOKEN"/)
  })

  /**
   * An indicator with a blank name is rejected. Edge case: empty name.
   *
   * The name is what identifies the check in the response; an empty one produces
   * an unattributable entry that no operator can act on.
   */
  it('rejects a marked indicator whose name is empty', () => {
    const blank = class {
      readonly name = ''

      /**
       * Report healthy.
       *
       * @returns An `up` result.
       */
      async check(): Promise<HealthIndicatorResult> {
        return { status: 'up' }
      }
    }
    Reflect.defineMetadata('bymax-one:health-indicator', true, blank)
    const nodes: ProviderNode[] = [{ metatype: blank, instance: new blank(), name: 'BLANK' }]

    expect(() => discoverIndicators(scannerOver(nodes), reflector)).toThrow(
      /does not implement IHealthIndicator/
    )
  })

  /**
   * An empty graph discovers nothing. Edge case.
   *
   * The scan must degrade to "no indicators", not to an error, so enabling
   * discovery in an application that has none is harmless.
   */
  it('discovers nothing in an application with no marked providers', () => {
    expect(discoverIndicators(scannerOver([]), reflector)).toEqual([])
  })
})

describe('mergeIndicators', () => {
  /**
   * Explicit registrations keep their identity and their position.
   *
   * An application that registered an indicator under a name has decided what
   * that check is; discovery must extend the set, never rewrite it.
   */
  it('keeps explicit indicators first and unchanged', () => {
    const explicit = [indicator('cache'), indicator('database')]
    const discovered = [indicator('queue')]

    const merged = mergeIndicators(explicit, discovered)

    expect(merged.map((entry) => entry.name)).toEqual(['cache', 'database', 'queue'])
    expect(merged[0]).toBe(explicit[0])
  })

  /**
   * A name collision resolves in favor of the application.
   *
   * A library shipping a `database` indicator must not silently replace the one
   * the application already wrote for its own database.
   */
  it('drops a discovered indicator whose name is already registered', () => {
    const mine = indicator('database', 'down')
    const theirs = indicator('database')

    const merged = mergeIndicators([mine], [theirs])

    expect(merged).toHaveLength(1)
    expect(merged[0]).toBe(mine)
  })

  /**
   * Nothing discovered changes nothing. Edge case.
   *
   * With discovery enabled but no marked providers, the readiness set must be
   * exactly what it was before, so turning the feature on is observable only
   * when something is actually found.
   */
  it('returns the explicit set unchanged when nothing was discovered', () => {
    const explicit = [indicator('cache')]

    expect(mergeIndicators(explicit, [])).toEqual(explicit)
  })
})
