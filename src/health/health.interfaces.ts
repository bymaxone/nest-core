/**
 * @fileoverview Health-check contracts. Consumers implement
 * {@link IHealthIndicator} against a client they already own (a cache, a
 * database, an external service) and register it under the
 * `BYMAX_HEALTH_INDICATORS` multi-token; the aggregation service runs every
 * registered indicator and folds the results into a {@link HealthResponse}.
 * A rejecting or slow indicator is converted to a `down` entry by the
 * aggregator: an indicator implementation never needs to guard its own
 * timeout or catch its own errors.
 * @layer Contract
 */

/**
 * The outcome of a single indicator check.
 */
export interface HealthIndicatorResult {
  /** Whether the checked dependency is reachable and healthy. */
  status: 'up' | 'down'
  /**
   * Optional diagnostic detail. Must never include secrets, connection
   * strings, credentials, or a raw internal error object: only safe,
   * human-readable fields belong here.
   */
  details?: Record<string, unknown>
}

/**
 * A pluggable readiness check. Implementations are registered under the
 * `BYMAX_HEALTH_INDICATORS` multi-token and run concurrently by the
 * aggregation service.
 */
export interface IHealthIndicator {
  /** Unique name reported in the {@link HealthResponse.checks} array. */
  readonly name: string
  /**
   * Perform the check.
   *
   * @returns The indicator's outcome.
   * @throws Any error; a rejection is converted to a `down` entry by the
   *   aggregator and never propagates to the caller.
   */
  check(): Promise<HealthIndicatorResult>
}

/**
 * One entry in a {@link HealthResponse.checks} array: an indicator's result,
 * tagged with the name that identifies it.
 */
export interface HealthCheckEntry {
  /** The indicator's {@link IHealthIndicator.name}. */
  name: string
  /** The indicator's resolved status. */
  status: 'up' | 'down'
  /** The indicator's optional diagnostic detail, when present. */
  details?: Record<string, unknown>
}

/**
 * The stable, versioned response body served by the health endpoints.
 */
export interface HealthResponse {
  /** `'ok'` when every check is `up`; `'error'` when any check is `down`. */
  status: 'ok' | 'error'
  /** Every indicator's result. Empty for the liveness endpoint. */
  checks: HealthCheckEntry[]
}
