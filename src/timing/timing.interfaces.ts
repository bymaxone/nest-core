/**
 * @fileoverview Request-timing contracts. The timing interceptor emits one
 * {@link RequestTimingSample} per completed request to the bound
 * {@link ITimingSink}. The default sink is a no-op; consumers plug in a logger
 * bridge or the metrics bridge through the `BYMAX_TIMING_SINK` token.
 * @layer Contract
 */

/**
 * A single request-timing measurement. The route template (not the raw URL) is
 * used to keep cardinality bounded for downstream metric sinks.
 */
export interface RequestTimingSample {
  /** HTTP method, for example `"GET"`. */
  method: string
  /** Route template, for example `"/invoices/:id"` (not the raw URL). */
  route: string
  /** Final HTTP status, including error statuses. */
  statusCode: number
  /** Wall-clock duration from a monotonic clock, in milliseconds. */
  durationMs: number
  /** Whether the sample exceeded the configured slow-request threshold. */
  slow: boolean
  /**
   * Trace this request ran under. Present only when telemetry is enabled and a
   * span was recording, so a sink can correlate the sample with the trace
   * without deciding what "no trace" looks like.
   */
  traceId?: string
  /** Span active when the request completed. Present under the same conditions. */
  spanId?: string
}

/**
 * Receive request-timing samples. Implementations must never throw: a sink
 * failure is caught and silenced by the interceptor so timing never breaks a
 * request.
 */
export interface ITimingSink {
  /**
   * Record one sample for a completed request.
   *
   * @param sample - The timing sample to record.
   */
  record(sample: RequestTimingSample): void
}
