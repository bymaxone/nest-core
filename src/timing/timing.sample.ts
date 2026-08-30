/**
 * @fileoverview Building a `RequestTimingSample`, shared by the two things that
 * produce one.
 *
 * Extracted so the middleware that records every request and the interceptor
 * that predates it cannot drift: the slow-request rule, the trace lookup and
 * the decision to omit trace fields rather than send `undefined` are one
 * implementation, exercised by both callers' tests. Delivering the sample lives
 * here for the same reason: a sink that fails must never reach the request it is
 * observing, and that guarantee is worth exactly as much as its least careful
 * copy.
 * @layer Utility
 */
import { containRejection } from '../contain-rejection'
import type { ITimingSink, RequestTimingSample } from './timing.interfaces'
import type { ITraceContextProvider, TraceContext } from '../telemetry/trace-context'

/** Everything needed to describe one closed request, however it ended. */
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

/**
 * Hand a sample to the sink, absorbing any failure it produces.
 *
 * Fire-and-forget by contract: a sink exists to observe the request, so its
 * breaking must never break what it observes. The failure is swallowed rather
 * than logged, unlike the health transition sink — this runs on every request,
 * so a sink failing systematically would turn one broken logger into a second
 * flood beside it.
 *
 * Both ways a sink can fail are absorbed. `record` is declared to return `void`,
 * but TypeScript accepts any return value in a void-returning position, so
 * `async record()` compiles and is the shape a consumer reaches for when the
 * logger it delegates to is async. Its rejection settles a microtask after the
 * `try` block has exited, which would be an unhandled rejection — able to take
 * the process down under `--unhandled-rejections=strict` — rather than the
 * contained failure this contract promises.
 *
 * Whatever comes back is assimilated with `Promise.resolve`, not tested with
 * `instanceof Promise`. `Promise` is a per-realm binding, so an `async` function
 * defined in another realm — a plugin loaded through `node:vm` — returns a
 * native promise that fails `instanceof` here, and a userland promise library's
 * result is not an instance either. Both are ordinary things for a consumer to
 * return. Assimilation is the language's own thenable test, so it recognizes
 * every shape that can carry a rejection, and it is inert for the `undefined`
 * an ordinary synchronous sink returns.
 *
 * @param sink - The consumer's sink.
 * @param sample - The sample to deliver.
 */
export function deliverSample(sink: ITimingSink, sample: RequestTimingSample): void {
  try {
    containRejection(sink.record(sample), () => {
      // Absorbed for the same reason as the synchronous path below.
    })
  } catch {
    // Fire-and-forget contract: a throwing sink must never break the request it
    // is observing, so its failure is caught and silenced here.
  }
}
