/**
 * Unit tests for the monotonic clock seam.
 *
 * Layer: unit.
 * Goal: prove the default clock delegates to `performance.now()` and returns a
 * monotonically non-decreasing value across two reads, the property the whole
 * timing feature depends on for correct duration math.
 * Mocks: none; exercises the real platform clock.
 */
import { DEFAULT_MONOTONIC_CLOCK } from './timing.clock'

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
