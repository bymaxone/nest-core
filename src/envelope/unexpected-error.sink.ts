/**
 * @fileoverview The unexpected-error contract: a sink that receives the
 * original value behind every collapsed `500 BYMAX_INTERNAL_ERROR`, with the
 * request it failed.
 *
 * This exists because the collapse is what makes the response safe, and that
 * same collapse is what makes the cause unrecoverable. The envelope carries a
 * fixed message by design, an access log sees only the status, and the thrown
 * value is gone the moment the filter replies. Nothing downstream of the filter
 * can get it back, so the filter has to hand it over before it goes.
 *
 * **Structural on purpose.** A sink is matched by shape, not by inheritance, so
 * a logging library can ship a compatible class without importing this package
 * or declaring it as a peer. Nothing here is a class or a value.
 *
 * **What the report leaves out.** No request body, no headers, no query string
 * and no raw URL: `route` is the template the router matched, the same
 * bounded label the timing sample carries. A sink usually writes to a log that
 * outlives the request and is read by more people than the request's sender,
 * and a query string is where tokens and personal data end up. A sink that
 * needs more than this reads it from its own request context.
 *
 * The thrown value itself is passed as is, uncut and unsanitised, whatever
 * `envelope.exposeInternals` says. That option controls the response body,
 * which goes to an untrusted client; a sink is application code at the same
 * trust level as the logger, and a cause cut down to make it safe is not much
 * of a cause. Treat what reaches it as possibly carrying hosts, queries and
 * credentials from a driver's error message, and send it where access is
 * already controlled.
 * @layer Contract
 */

/**
 * One unexpected error, as the filter saw it when collapsing it.
 *
 * Optional fields are **absent** when unknown, never present holding
 * `undefined`, so a sink that spreads the report into a structured log line
 * writes no empty keys.
 */
export interface UnexpectedErrorReport {
  /** The original thrown value: an `Error`, or anything else that was thrown. */
  readonly error: unknown
  /** HTTP method, read through the adapter (Express and Fastify neutral). */
  readonly method: string
  /**
   * Route template the request matched, for example `"/invoices/:id"`, or
   * `UNMATCHED_ROUTE` when it matched none: an error raised by middleware
   * before routing. Never the raw URL.
   */
  readonly route: string
  /** Correlation id for the request; absent when no provider resolves one. */
  readonly correlationId?: string
  /**
   * Trace the request ran under; absent when telemetry is off or nothing was
   * recording. Present whatever `telemetry.exposeTraceId` says, because that
   * option controls the response body and the sink is not the response.
   */
  readonly traceId?: string
}

/**
 * Receives the cause of each collapsed `500 BYMAX_INTERNAL_ERROR`.
 *
 * Bind an implementation under `BYMAX_UNEXPECTED_ERROR_SINK` from a module of
 * your own marked `@Global()`. Nothing is bound by default, and with no sink the
 * filter records nothing: this package owns no logger.
 *
 * Called once per unexpected error, never for an `HttpException` and never for
 * a 4xx the framework's body pipeline raised (a malformed JSON body, a payload
 * over the limit) — those are not unexpected, and a sink would otherwise get a
 * flood of client mistakes mixed in with server failures.
 *
 * Called synchronously from the exception filter, before the response is
 * written, so an implementation must be cheap and must not block: hand the
 * report to a logger and return. Whatever it does, the response does not
 * change. A synchronous throw is caught, and an `async record()` that rejects
 * is contained, and both are dropped silently: the filter is the last thing
 * between an error and the client, and anything it reported about its own sink
 * would push aside the failure the caller actually needs to see.
 *
 * Runs alongside the protected `BymaxExceptionFilter.onUnexpectedError` seam,
 * not instead of it; a subclass overriding that seam still receives every call.
 *
 * Takes a single object, matching `ITimingSink.record` and
 * `IHealthTransitionSink.record`, so a later field is an additive change rather
 * than a new positional parameter.
 */
export interface IUnexpectedErrorSink {
  /**
   * Record one unexpected error.
   *
   * @param report - The original thrown value and the request it failed.
   */
  record(report: UnexpectedErrorReport): void
}
