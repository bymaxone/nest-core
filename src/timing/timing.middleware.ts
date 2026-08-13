/**
 * @fileoverview `BymaxTimingMiddleware`, which records one timing sample per
 * request — every request, including the ones nothing else in the application
 * ever sees.
 *
 * It is middleware rather than an interceptor because of where Nest puts each
 * in the request lifecycle. Guards run **before** interceptors, so a request a
 * guard rejects never reaches `intercept()`: an unauthenticated call, a
 * forbidden one, a throttled one. A request matching no route never reaches a
 * controller at all. Measured on a real application before this existed, three
 * requests — a handler success, a guard rejection and an unknown path —
 * produced exactly one sample.
 *
 * That is a security defect rather than a gap in observability. The signals it
 * hides are the ones an operator most needs: a credential-stuffing run is a
 * flood of 401s, route enumeration is a flood of 404s, and a throttler doing
 * its job is a flood of 429s. All three were invisible, so a deployment could
 * be under attack and its error graph stay flat.
 *
 * The sample is emitted from the response's `'close'` event and not `'finish'`.
 * `'finish'` means the response was sent in full; a client that hangs up
 * mid-request never emits it — and hanging up mid-request is exactly what a
 * scanner does. `'close'` fires in both cases, once, so nothing is
 * double-counted and nothing is missed; `writableFinished` distinguishes the
 * two for anyone who later wants them labelled apart.
 *
 * Resolving the trace identifiers takes two contexts, not one, because neither
 * alone covers the cases. Node warns that "event listeners triggered by an
 * `EventEmitter` may be run in a different execution context than the one that
 * was active when `eventEmitter.on()` was called", and `'close'` is its own
 * example. Measured against a registered `AsyncLocalStorageContextManager`, with
 * the span opened either before this middleware (an auto-instrumented HTTP
 * server) or after it (instrumentation registered as Nest middleware, which is
 * downstream of this one):
 *
 * | span opened  | request  | live read at emit | `AsyncResource.bind` |
 * | ------------ | -------- | ----------------- | -------------------- |
 * | upstream     | normal   | resolves          | resolves             |
 * | upstream     | aborted  | —                 | resolves             |
 * | downstream   | normal   | resolves          | —                    |
 * | downstream   | aborted  | —                 | —                    |
 *
 * So the live read is tried first and the captured context is the fallback:
 * binding alone would have dropped the identifiers for every consumer whose
 * instrumentation is Nest middleware, which the interceptor this replaced did
 * see, and reading live alone would drop them on every aborted request. The
 * bottom row is genuinely unreachable — that span never existed in any context
 * this middleware can hold — and costs the optional trace fields only.
 * @layer Middleware
 */
import { AsyncResource } from 'node:async_hooks'

import type { NestMiddleware } from '@nestjs/common'
import { Inject, Injectable, Optional } from '@nestjs/common'

import type { ResolvedCoreOptions } from '../core.options'
import { BYMAX_CORE_OPTIONS, BYMAX_TIMING_SINK, BYMAX_TRACE_CONTEXT } from '../core.tokens'
import { NoopTimingSink } from '../defaults.providers'
import { readRequestInfo } from './request-info.accessor'
import type { RequestShape } from './request-info.accessor'
import { BYMAX_TIMING_CLOCK, DEFAULT_MONOTONIC_CLOCK } from './timing.clock'
import type { MonotonicClock } from './timing.clock'
import type { ITimingSink } from './timing.interfaces'
import { buildTimingSample, readTraceContext } from './timing.sample'
import type { ITraceContextProvider, TraceContext } from '../telemetry/trace-context'
import { NoopTraceContextProvider } from '../telemetry/trace-context'

/** The part of a response this middleware reads and listens on. */
interface ResponseShape {
  /** Node's event emitter, used for the single `'close'` subscription. */
  on(event: 'close', listener: () => void): unknown
  /**
   * Final status code. Optional and explicitly nullable: a connection can close
   * before anything settled one, and that case has to be expressible rather
   * than assumed away.
   */
  statusCode?: number | undefined
}

/**
 * Records one timing sample per request, whatever ended it.
 *
 * Registered by `BymaxCoreModule` for every route when the timing feature is
 * enabled. It replaces the interceptor as the recorder rather than joining it:
 * two recorders would count every matched request twice, which is a worse
 * defect than the one being fixed because it is silent and plausible.
 */
@Injectable()
export class BymaxTimingMiddleware implements NestMiddleware {
  /** The bound sink, or an in-code no-op when nothing is bound. */
  private readonly sink: ITimingSink

  /** The bound trace reader, or an in-code no-op when nothing is bound. */
  private readonly traceContext: ITraceContextProvider

  /**
   * @param options - The resolved options, read for the slow-request threshold.
   * @param sink - The bound timing sink; its failures are swallowed, because a
   *   throwing sink must never affect the request it is observing.
   * @param clock - Monotonic clock seam, so a test advances time by controlled
   *   amounts instead of sleeping.
   * @param traceContext - Reads the active span's identifiers. Optional: the
   *   middleware stays constructible on its own, and a no-op resolves nothing.
   */
  constructor(
    @Inject(BYMAX_CORE_OPTIONS) private readonly options: ResolvedCoreOptions,
    @Optional() @Inject(BYMAX_TIMING_SINK) sink: ITimingSink | undefined,
    @Inject(BYMAX_TIMING_CLOCK) private readonly clock: MonotonicClock = DEFAULT_MONOTONIC_CLOCK,
    @Optional() @Inject(BYMAX_TRACE_CONTEXT) traceContext?: ITraceContextProvider
  ) {
    this.sink = sink ?? new NoopTimingSink()
    this.traceContext = traceContext ?? new NoopTraceContextProvider()
  }

  /**
   * Start the measurement and arrange for the sample to be recorded once the
   * connection closes, then hand the request straight on.
   *
   * The route is read inside the listener rather than here: at middleware time
   * the router has not matched yet, so `req.route` is still empty. By the time
   * the connection closes it is populated — including for a request a guard
   * rejected, since matching happens before guards run.
   *
   * The trace lookup is tried in the live context first and in this moment's
   * captured context second; see this file's header for the measurements that
   * decided that order.
   *
   * @param request - The framework request object.
   * @param response - The framework response object.
   * @param next - Continues the chain; called synchronously and unconditionally.
   */
  use(request: RequestShape, response: ResponseShape, next: () => void): void {
    const start = this.clock.now()
    // Bound to *this* moment's context, and called only if the live read below
    // comes up empty. Instrumentation that opened its span before this
    // middleware — what an auto-instrumented HTTP server does — is already in
    // the captured context, which is the only thing that still resolves once
    // the connection is aborted.
    const readCapturedTrace = AsyncResource.bind(() => readTraceContext(this.traceContext))
    // Deliberately NOT bound: the live context at emit time is the only one
    // holding a span that instrumentation opened *after* this middleware, and
    // consumer instrumentation registered as Nest middleware is downstream of
    // this one. Binding here would have been a regression against the
    // interceptor, which ran after all middleware and saw those spans.
    response.on('close', () => {
      this.record(
        request,
        response,
        start,
        readTraceContext(this.traceContext) ?? readCapturedTrace()
      )
    })
    next()
  }

  /**
   * Build the sample and hand it to the sink, guarding both steps.
   *
   * @param request - The framework request object.
   * @param response - The framework response object.
   * @param start - Monotonic timestamp captured before the chain ran.
   * @param trace - The span identifiers already resolved by the caller, which
   *   owns the choice of which context to read them from.
   */
  private record(
    request: RequestShape,
    response: ResponseShape,
    start: number,
    trace: TraceContext | undefined
  ): void {
    const { method, route } = readRequestInfo(request)
    const sample = buildTimingSample({
      method,
      route,
      statusCode: response.statusCode ?? 0,
      durationMs: this.clock.now() - start,
      threshold: this.options.timing.slowRequestThresholdMs,
      trace
    })
    try {
      this.sink.record(sample)
    } catch {
      // Fire-and-forget contract: a throwing sink must never break the request
      // it is observing, so its failure is caught and silenced here.
    }
  }
}
