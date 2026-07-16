/**
 * @fileoverview Monotonic clock seam for request-timing duration math. Wall-clock
 * date sources (`Date.now()`, `new Date()`) are banned for measuring elapsed
 * time anywhere in this feature: the system clock can jump backward or forward
 * (NTP adjustments, leap seconds, manual changes), which would corrupt a
 * duration measurement. Every elapsed-time computation in `src/timing/` reads
 * from this seam instead, so the interceptor stays testable with a stub clock
 * that advances by controlled amounts.
 * @layer Utility
 */

/** A source of monotonically increasing timestamps, in milliseconds. */
export interface MonotonicClock {
  /**
   * Read the current monotonic timestamp.
   *
   * @returns Milliseconds from a monotonic, ever-increasing source. Only
   *   differences between two calls are meaningful; the absolute value carries
   *   no calendar significance.
   */
  now(): number
}

/**
 * Default monotonic clock, delegating to the platform's `performance.now()`.
 * Bound as the default timing clock so `TimingInterceptor` measures real
 * elapsed time in production; tests inject a stub implementing the same
 * {@link MonotonicClock} contract.
 */
export const DEFAULT_MONOTONIC_CLOCK: MonotonicClock = {
  now: (): number => performance.now()
}

/**
 * Internal DI token for the monotonic clock seam. Not part of the public
 * package API: it exists so `TimingInterceptor` can be constructed through
 * Nest's container (which cannot resolve a plain interface type) while tests
 * substitute a stub clock through the same explicit injection site.
 */
export const BYMAX_TIMING_CLOCK: unique symbol = Symbol('BYMAX_TIMING_CLOCK')
