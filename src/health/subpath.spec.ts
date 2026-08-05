/**
 * Integration tests for the `./health` public barrel.
 *
 * Layer: integration.
 * Goal: prove a library that only implements an indicator can reach everything
 * it needs through this subpath alone — the contract types and the marker — and
 * that the marker reached through the barrel is the same one the scan matches.
 * Mocks: none; Nest's own `Reflector` reads the metadata back, and the scan runs
 * over a hand-built provider graph.
 */
import { Reflector } from '@nestjs/core'

import { discoverIndicators } from './health.discovery'
import { BymaxHealthIndicator, BYMAX_HEALTH_INDICATOR_METADATA } from './index'
import type { HealthIndicatorResult, IHealthIndicator } from './index'

/**
 * An indicator declared exactly as a sibling library would declare it: the
 * contract type and the marker both imported from this subpath, with no
 * reference to `BymaxCoreModule`.
 */
@BymaxHealthIndicator()
class LibraryIndicator implements IHealthIndicator {
  readonly name = 'library-dependency'

  /**
   * Report healthy.
   *
   * @returns An `up` result.
   */
  async check(): Promise<HealthIndicatorResult> {
    return { status: 'up' }
  }
}

describe('health subpath barrel', () => {
  /**
   * The subpath is self-sufficient for an indicator author.
   *
   * The marker and its key must both be reachable here; a library forced to
   * import the package root to mark a class would pull the whole module in,
   * which is exactly what this subpath exists to avoid.
   */
  it('exposes the marker and its metadata key', () => {
    expect(typeof BymaxHealthIndicator).toBe('function')
    expect(BYMAX_HEALTH_INDICATOR_METADATA).toBe('bymax-one:health-indicator')
  })

  /**
   * A class marked through the barrel is found by the scan.
   *
   * This is the seam that a per-subpath bundle could break: the marker is
   * bundled into `./health` and the scan into the package root, so if the key
   * were generated rather than literal, the two copies would disagree and
   * nothing would ever be discovered.
   */
  it('marks a class the discovery scan then finds', () => {
    const graph = [{ metatype: LibraryIndicator, instance: new LibraryIndicator() }]

    const discovered = discoverIndicators({ getProviders: () => graph }, new Reflector())

    expect(discovered.map((entry) => entry.name)).toEqual(['library-dependency'])
  })
})
