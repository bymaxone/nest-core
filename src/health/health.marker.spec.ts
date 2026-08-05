/**
 * Unit tests for the discoverable-indicator marker.
 *
 * Layer: unit.
 * Goal: prove the marker writes metadata a scanner can read back, under a key
 * that is a stable literal rather than a value generated per module load — the
 * property that lets a class decorated through the `./health` subpath be found
 * by the scan running from the package root.
 * Mocks: none; Nest's own `Reflector` reads the metadata back.
 */
import { Reflector } from '@nestjs/core'

import { BymaxHealthIndicator, BYMAX_HEALTH_INDICATOR_METADATA } from './health.marker'
import type { HealthIndicatorResult } from './health.interfaces'

/** A marked indicator, exactly as a consumer would declare one. */
@BymaxHealthIndicator()
class MarkedIndicator {
  readonly name = 'marked'

  /**
   * Report healthy.
   *
   * @returns An `up` result.
   */
  async check(): Promise<HealthIndicatorResult> {
    return { status: 'up' }
  }
}

/** An ordinary provider that was never marked. */
class UnmarkedProvider {}

describe('BymaxHealthIndicator', () => {
  /**
   * The marker is readable through Nest's own metadata reader.
   *
   * Discovery reads it with `Reflector`, so that is what the test reads with:
   * asserting through the same door the scan uses is what makes this a contract
   * test rather than a restatement of the decorator's implementation.
   */
  it('marks a decorated class', () => {
    const reflector = new Reflector()

    expect(reflector.get(BYMAX_HEALTH_INDICATOR_METADATA, MarkedIndicator)).toBe(true)
  })

  /**
   * An undecorated class carries nothing.
   *
   * The scan skips on a missing marker, so a false positive here would mean
   * every provider in an application becomes a readiness check.
   */
  it('leaves an undecorated class unmarked', () => {
    const reflector = new Reflector()

    expect(reflector.get(BYMAX_HEALTH_INDICATOR_METADATA, UnmarkedProvider)).toBeUndefined()
  })

  /**
   * The key is a stable literal. Regression guard.
   *
   * `DiscoveryService.createDecorator()` mints a random key per module load,
   * which would silently break discovery across this package's separately
   * bundled subpaths. Pinning the literal is what keeps the `./health` copy and
   * the root copy talking about the same key.
   */
  it('uses a namespaced literal as its metadata key', () => {
    expect(BYMAX_HEALTH_INDICATOR_METADATA).toBe('bymax-one:health-indicator')
  })
})
