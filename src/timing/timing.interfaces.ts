/**
 * @fileoverview Request-timing contracts. `BymaxTimingMiddleware` emits one
 * {@link RequestTimingSample} per **closed** request to the bound
 * {@link ITimingSink} — every request the server finished with, including the
 * ones a guard rejected, the ones that matched no route, and the ones a client
 * abandoned mid-flight. The default sink is a no-op; consumers plug in a logger
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
 * Receive request-timing samples. Implementations should not fail, and a failure
 * is absorbed by the recorder either way so timing never breaks a request.
 *
 * Both ways an implementation can fail are absorbed: a synchronous throw, and a
 * rejection from an `async record()` — which compiles despite the `void` return
 * type, because TypeScript accepts any return value in a void-returning
 * position, and is the natural shape when the backend behind the sink is async.
 * The failure is swallowed rather than logged, unlike `IHealthTransitionSink`:
 * this runs on every request, so a sink failing systematically would turn one
 * broken backend into a second flood beside it.
 */
export interface ITimingSink {
  /**
   * Record one sample for a closed request, however it ended.
   *
   * Called once per request the server closed — not only the ones a handler
   * answered. A rejection issued by a guard, a request matching no route, and a
   * client that hung up mid-response all arrive here.
   *
   * @param sample - The timing sample to record.
   */
  record(sample: RequestTimingSample): void
}
