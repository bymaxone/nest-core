/**
 * @fileoverview `TimingInterceptor`, the request-timing interceptor. Wraps the
 * downstream handler chain (pipes, the route handler, and response
 * serialization) with a monotonic clock; guards run before interceptors in
 * Nest, so guard time is not part of `durationMs`. It delivers exactly one
 * {@link RequestTimingSample} per
 * completed request, on both the success path and the error path, to the
 * bound `ITimingSink`. The sink contract is fire-and-forget: any exception it
 * throws is caught and silenced here, so request timing can never break a
 * request or alter the response an error path propagates.
 *
 * Superseded as the module's recorder by {@link BymaxTimingMiddleware}. That
 * same "guards run before interceptors" is why: a request a guard rejects never
 * reaches `intercept()`, so authentication failures, authorization failures and
 * throttled requests were never counted at all. Nothing registers this class
 * any more; it remains exported so an application that wired it by hand keeps
 * compiling, and registering it alongside the middleware double-counts every
 * request that does reach a handler.
 * @layer Interceptor
 */
import { HttpException, Inject, Injectable, Optional } from '@nestjs/common'
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import type { Observable } from 'rxjs'
import { catchError, tap, throwError } from 'rxjs'

import type { ResolvedCoreOptions } from '../core.options'
import { BYMAX_CORE_OPTIONS, BYMAX_TIMING_SINK, BYMAX_TRACE_CONTEXT } from '../core.tokens'
import { NoopTimingSink } from '../defaults.providers'
import { extractRequestInfo } from './request-info.accessor'
import { BYMAX_TIMING_CLOCK, DEFAULT_MONOTONIC_CLOCK } from './timing.clock'
import type { MonotonicClock } from './timing.clock'
import type { ITimingSink } from './timing.interfaces'
import { buildTimingSample, readTraceContext } from './timing.sample'
import type { ITraceContextProvider } from '../telemetry/trace-context'
import { NoopTraceContextProvider } from '../telemetry/trace-context'

/** Status recorded when a response completes without an explicit status code. */
const DEFAULT_SUCCESS_STATUS = 200

/** Status recorded for an error that is not an `HttpException`. */
const UNKNOWN_ERROR_STATUS = 500

/** Structural shape read off the response object to find its final status. */
interface ResponseStatusShape {
  statusCode?: number
}

/**
 * Request-timing interceptor. No longer registered by `BymaxCoreModule`, which
 * records through {@link BymaxTimingMiddleware} instead so that requests ended
 * by a guard or by no route matching are counted too. Non-HTTP execution
 * contexts (GraphQL, RPC) pass through untouched: this feature is HTTP-first,
 * matching the exception filter's documented scope.
 *
 * @deprecated Since 1.4.0, superseded by `BymaxTimingMiddleware`, which the
 *   module registers automatically. Registering this interceptor as well
 *   records a second sample for every request that reaches a handler.
 */
@Injectable()
export class TimingInterceptor implements NestInterceptor {
  /** The bound timing sink, or the no-op fallback when none resolves. */
  private readonly sink: ITimingSink

  /** The bound trace-context provider, or the no-op fallback when none resolves. */
  private readonly traceContext: ITraceContextProvider

  /**
   * @param options - Resolved core options; supplies `slowRequestThresholdMs`.
   * @param sink - The bound timing sink; its `record` failures are swallowed.
   *   Injected with `@Optional()`: `BymaxCoreModule` binds no local default for
   *   this token on the sync path when the metrics bridge is not registered, so
   *   a consumer's own `BYMAX_TIMING_SINK` binding is not shadowed by one; when
   *   nothing resolves, this falls back to a no-op sink.
   * @param clock - Monotonic clock seam; defaults to `performance.now()`, and
   *   is bound explicitly through {@link BYMAX_TIMING_CLOCK} so tests inject a
   *   stub advancing by controlled amounts.
   * @param traceContext - Reads the active span's identifiers. Injected with
   *   `@Optional()` so this interceptor stays constructible on its own; when
   *   nothing resolves, a no-op resolves no trace and the sample simply omits
   *   the fields.
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
   * Measure the handler chain and record exactly one sample per completed
   * request, on the success path and on the error path alike.
   *
   * @param context - The execution context of the current request.
   * @param next - The next handler in the chain.
   * @returns The downstream response stream, unmodified beyond the measurement.
   */
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle()
    }
    const start = this.clock.now()
    const { method, route } = extractRequestInfo(context)
    return next.handle().pipe(
      tap({
        complete: () => {
          this.recordSample(method, route, this.readSuccessStatus(context), start)
        }
      }),
      catchError((error: unknown) => {
        this.recordSample(method, route, this.readErrorStatus(error), start)
        return throwError(() => error)
      })
    )
  }

  /**
   * Read the final status code from the response object on the success path.
   *
   * @param context - The execution context of the current request.
   * @returns The response's status code, or the default success status when absent.
   */
  private readSuccessStatus(context: ExecutionContext): number {
    const response = context.switchToHttp().getResponse<ResponseStatusShape>()
    return response.statusCode ?? DEFAULT_SUCCESS_STATUS
  }

  /**
   * Derive the final status code for an error that escaped the handler.
   *
   * @param error - The error propagated by the handler chain.
   * @returns The `HttpException` status, or the generic 500 for anything else.
   */
  private readErrorStatus(error: unknown): number {
    return error instanceof HttpException ? error.getStatus() : UNKNOWN_ERROR_STATUS
  }

  /**
   * Build the sample and deliver it to the sink inside a try/catch that
   * silences any failure: a throwing sink must never affect the request it is
   * observing.
   *
   * @param method - HTTP method of the request.
   * @param route - Route template of the request.
   * @param statusCode - Final status code, success or error.
   * @param start - Monotonic start timestamp captured before the handler ran.
   */
  private recordSample(method: string, route: string, statusCode: number, start: number): void {
    const sample = buildTimingSample({
      method,
      route,
      statusCode,
      durationMs: this.clock.now() - start,
      threshold: this.options.timing.slowRequestThresholdMs,
      trace: readTraceContext(this.traceContext)
    })
    try {
      this.sink.record(sample)
    } catch {
      // Fire-and-forget contract: a throwing sink must never break the request
      // it is observing, so its failure is caught and silenced here.
    }
  }
}
