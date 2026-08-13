/**
 * @fileoverview Building a `RequestTimingSample`, shared by the two things that
 * produce one.
 *
 * Extracted so the middleware that records every request and the interceptor
 * that predates it cannot drift: the slow-request rule, the trace lookup and
 * the decision to omit trace fields rather than send `undefined` are one
 * implementation, exercised by both callers' tests.
 * @layer Utility
 */
import type { RequestTimingSample } from './timing.interfaces'
import type { ITraceContextProvider, TraceContext } from '../telemetry/trace-context'

/** Everything needed to describe one completed request. */
export interface TimingSampleInput {
  /** HTTP method of the request. */
  method: string
  /** Route template, or the unmatched-route label. */
  route: string
  /** Final status code, whatever ended the request. */
  statusCode: number
  /** Wall-clock duration from a monotonic clock, in milliseconds. */
  durationMs: number
  /** Configured slow-request threshold, absent when the consumer set none. */
  threshold: number | undefined
  /** The already-resolved span identifiers, absent when none resolved. */
  trace: TraceContext | undefined
}

/**
 * Read the active span's identifiers, tolerating a provider that throws.
 *
 * The lookup is guarded on its own rather than folded into the caller's guard
 * around the sink. A failed lookup must cost the optional trace fields and
 * nothing else: dropping the whole sample would let a broken tracer silently
 * stop the request counter, which is a worse outcome than the missing
 * identifiers it was meant to tolerate — and, since that counter is what makes
 * an attack visible, a tracer bug would take the security signal down with it.
 *
 * Separate from {@link buildTimingSample} because *when* the lookup happens is
 * the caller's problem, and the two callers answer it differently: the
 * interceptor runs inside the request's context and reads once, while the
 * middleware records from an event and has to try two contexts.
 *
 * @param traceContext - Reads the active span's identifiers.
 * @returns The identifiers, or `undefined` when none resolved or the lookup threw.
 */
export function readTraceContext(traceContext: ITraceContextProvider): TraceContext | undefined {
  try {
    return traceContext.getTraceContext()
  } catch {
    // The provider contract says it never throws; this guarantee does not
    // depend on that being true.
    return undefined
  }
}

/**
 * Assemble one sample.
 *
 * @param input - The measured request.
 * @returns The sample to hand to a sink.
 */
export function buildTimingSample(input: TimingSampleInput): RequestTimingSample {
  const { method, route, statusCode, durationMs, threshold, trace } = input
  return {
    method,
    route,
    statusCode,
    durationMs,
    slow: threshold !== undefined && durationMs > threshold,
    // Spread rather than assigned: an absent trace must leave the keys off the
    // sample entirely, so a sink cannot mistake `undefined` for an id.
    ...(trace !== undefined ? { traceId: trace.traceId, spanId: trace.spanId } : {})
  }
}
