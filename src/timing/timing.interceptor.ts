/**
 * @fileoverview `TimingInterceptor`, the request-timing interceptor. Wraps the
 * full handler chain (guards, pipes, the handler, and serialization) with a
 * monotonic clock and delivers exactly one {@link RequestTimingSample} per
 * completed request, on both the success path and the error path, to the
 * bound `ITimingSink`. The sink contract is fire-and-forget: any exception it
 * throws is caught and silenced here, so request timing can never break a
 * request or alter the response an error path propagates.
 * @layer Interceptor
 */
import { HttpException, Inject, Injectable } from '@nestjs/common'
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import type { Observable } from 'rxjs'
import { catchError, tap, throwError } from 'rxjs'

import type { ResolvedCoreOptions } from '../core.options'
import { BYMAX_CORE_OPTIONS, BYMAX_TIMING_SINK } from '../core.tokens'
import { extractRequestInfo } from './request-info.accessor'
import { BYMAX_TIMING_CLOCK, DEFAULT_MONOTONIC_CLOCK } from './timing.clock'
import type { MonotonicClock } from './timing.clock'
import type { ITimingSink, RequestTimingSample } from './timing.interfaces'

/** Status recorded when a response completes without an explicit status code. */
const DEFAULT_SUCCESS_STATUS = 200

/** Status recorded for an error that is not an `HttpException`. */
const UNKNOWN_ERROR_STATUS = 500

/** Structural shape read off the response object to find its final status. */
interface ResponseStatusShape {
  statusCode?: number
}

/**
 * Request-timing interceptor. Registered as the `APP_INTERCEPTOR` when the
 * timing feature is enabled, on both the sync and async registration paths.
 * Non-HTTP execution contexts (GraphQL, RPC) pass through untouched: this
 * feature is HTTP-first, matching the exception filter's documented scope.
 */
@Injectable()
export class TimingInterceptor implements NestInterceptor {
  /**
   * @param options - Resolved core options; supplies `slowRequestThresholdMs`.
   * @param sink - The bound timing sink; its `record` failures are swallowed.
   * @param clock - Monotonic clock seam; defaults to `performance.now()`, and
   *   is bound explicitly through {@link BYMAX_TIMING_CLOCK} so tests inject a
   *   stub advancing by controlled amounts.
   */
  constructor(
    @Inject(BYMAX_CORE_OPTIONS) private readonly options: ResolvedCoreOptions,
    @Inject(BYMAX_TIMING_SINK) private readonly sink: ITimingSink,
    @Inject(BYMAX_TIMING_CLOCK) private readonly clock: MonotonicClock = DEFAULT_MONOTONIC_CLOCK
  ) {}

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
   * Build the sample, compute the slow flag, and deliver it to the sink inside
   * a try/catch that silences any failure: a throwing sink must never affect
   * the request it is observing.
   *
   * @param method - HTTP method of the request.
   * @param route - Route template of the request.
   * @param statusCode - Final status code, success or error.
   * @param start - Monotonic start timestamp captured before the handler ran.
   */
  private recordSample(method: string, route: string, statusCode: number, start: number): void {
    const durationMs = this.clock.now() - start
    const threshold = this.options.timing.slowRequestThresholdMs
    const slow = threshold !== undefined && durationMs > threshold
    const sample: RequestTimingSample = { method, route, statusCode, durationMs, slow }
    try {
      this.sink.record(sample)
    } catch {
      // Fire-and-forget contract: a throwing sink must never break the request
      // it is observing, so its failure is caught and silenced here.
    }
  }
}
