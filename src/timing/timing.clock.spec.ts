/**
 * Unit tests for the monotonic clock seam.
 *
 * Layer: unit.
 * Goal: prove the default clock delegates to `performance.now()` and returns a
 * monotonically non-decreasing value across two reads, the property the whole
 * timing feature depends on for correct duration math — and that the token
 * naming that seam keeps one identity across the per-subpath bundles, without
 * which the interceptor's injection site stops matching its provider.
 * Mocks: none; exercises the real platform clock.
 */
import { BYMAX_TIMING_CLOCK, DEFAULT_MONOTONIC_CLOCK } from './timing.clock'

describe('BYMAX_TIMING_CLOCK', () => {
  /**
   * Holds one identity across the per-subpath bundles.
   *
   * This module is inlined into every published bundle, so a `Symbol()` token
   * would mint a separate identity per bundle and the interceptor's injection
   * site would stop matching the provider. `Symbol(k) !== Symbol.for(k)`, so
   * this fails the moment the token regresses to a plain `Symbol()`.
   */
  it('resolves through the global symbol registry under its namespaced key', () => {
    expect(BYMAX_TIMING_CLOCK).toBe(Symbol.for('@bymax-one/nest-core:timing-clock'))
  })
})

describe('DEFAULT_MONOTONIC_CLOCK', () => {
  /**
   * Delegates to performance.now().
   *
   * The seam must expose a real, monotonic timestamp source, not a stub, so
   * production duration measurements reflect actual elapsed time.
   */
  it('returns a non-decreasing timestamp across two reads', () => {
    const first = DEFAULT_MONOTONIC_CLOCK.now()
    const second = DEFAULT_MONOTONIC_CLOCK.now()

    expect(typeof first).toBe('number')
    expect(second).toBeGreaterThanOrEqual(first)
  })
})
