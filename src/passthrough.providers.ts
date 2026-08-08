/**
 * @fileoverview Transparent pipeline building blocks for the async registration
 * path. `forRootAsync` cannot know the resolved options at module-definition
 * time, so the `APP_FILTER` and `APP_INTERCEPTOR` slots are always registered
 * and resolve a real implementation when a feature is enabled or one of these
 * pass-throughs otherwise. Each pass-through is intentionally indistinguishable
 * from the feature's absence: the filter defers to Nest's default handling, the
 * interceptor forwards the stream untouched.
 * @layer Provider
 */
import { Catch, NotFoundException } from '@nestjs/common'
import type {
  ArgumentsHost,
  CallHandler,
  ExceptionFilter,
  ExecutionContext,
  NestInterceptor
} from '@nestjs/common'
import type { HttpAdapterHost } from '@nestjs/core'
import { BaseExceptionFilter } from '@nestjs/core'
import type { Observable } from 'rxjs'

import type { ResolvedCoreOptions } from './core.options'
import type { ICorrelationIdProvider } from './envelope/correlation.interfaces'
import { BymaxExceptionFilter } from './envelope/exception.filter'
import type { MonotonicClock } from './timing/timing.clock'
import { TimingInterceptor } from './timing/timing.interceptor'
import type { ITimingSink } from './timing/timing.interfaces'

/**
 * Exception filter that reproduces Nest's default error handling, used on the
 * async path as the transparent stand-in when the envelope feature is disabled.
 * It delegates to a {@link BaseExceptionFilter} built from the live HTTP adapter,
 * which on the async path is not yet available when the module's providers are
 * constructed, so the delegate is built lazily on the first catch and reused
 * thereafter to avoid per-exception allocation. The formatted response is
 * byte-for-byte identical to having no filter at all.
 */
@Catch()
export class PassThroughExceptionFilter implements ExceptionFilter {
  /** Built on first use, once the bootstrapped HTTP adapter is available. */
  private delegate: BaseExceptionFilter | undefined

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  /**
   * Format the exception exactly as Nest's default handler would.
   *
   * @param exception - The exception that escaped the handler.
   * @param host - The arguments host for the current request.
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    this.delegate ??= new BaseExceptionFilter(this.adapterHost.httpAdapter)
    this.delegate.catch(exception, host)
  }
}

/**
 * Interceptor that forwards the handler stream without touching it, used on the
 * async path as the transparent stand-in when the timing feature is disabled.
 * It adds no observable behavior and no measurable per-request work.
 */
export class PassThroughInterceptor implements NestInterceptor {
  /**
   * Forward the request to the next handler unchanged.
   *
   * @param _context - The execution context; unused by a transparent forwarder.
   * @param next - The next handler in the chain.
   * @returns The downstream response stream, unmodified.
   */
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle()
  }
}

/**
 * Guard a controller route that could only be registered unconditionally on the
 * async path. When the owning feature resolves to disabled, answer `404` so the
 * route is indistinguishable from one that was never registered.
 *
 * A disabled feature is the ordinary, intended state — not a misconfiguration —
 * and the async path registers its controller anyway because route metadata is
 * fixed before the options resolve. Throwing a plain `Error` here made every
 * such deployment serve an unauthenticated endpoint that answered `500` to
 * anyone who asked: a real server error in alerting, in error budgets and in any
 * uptime check, describing a state nothing was wrong with. `404` is what the
 * caller would have seen had the framework been able to skip the registration,
 * which is the whole intent.
 *
 * Only the *absence* of the feature is normalised. A path that disagrees with
 * the one the controller was registered at is a genuine misconfiguration and
 * still fails loudly at its own call site.
 *
 * @param feature - The feature name, used in the message.
 * @param enabled - Whether the feature is enabled in the resolved options.
 * @throws NotFoundException When the feature is disabled.
 */
export function assertAsyncFeatureEnabled(feature: string, enabled: boolean): void {
  if (!enabled) {
    throw new NotFoundException(
      `[BymaxCoreModule] The "${feature}" feature is disabled, so this route does not exist.`
    )
  }
}

/**
 * Select the exception filter for the async path from the resolved options: the
 * real {@link BymaxExceptionFilter} when the envelope feature is enabled, the
 * transparent {@link PassThroughExceptionFilter} otherwise. The slot is always
 * registered on the async path because options resolve after the module is
 * defined, so the choice is made here at runtime.
 *
 * @param options - The resolved options snapshot (gates the envelope feature).
 * @param correlation - Provider resolving the current request's correlation id,
 *   or `undefined` when no provider is bound anywhere in the application; the
 *   real filter falls back to its own no-op default in that case.
 * @param adapterHost - The HTTP adapter host used to read and write the response.
 * @returns The real envelope filter when enabled, else a transparent pass-through.
 */
export function selectAsyncExceptionFilter(
  options: ResolvedCoreOptions,
  correlation: ICorrelationIdProvider | undefined,
  adapterHost: HttpAdapterHost
): ExceptionFilter {
  return options.envelope.enabled
    ? new BymaxExceptionFilter(options, correlation, adapterHost)
    : new PassThroughExceptionFilter(adapterHost)
}

/**
 * Select the timing interceptor for the async path from the resolved options:
 * the real {@link TimingInterceptor} when the timing feature is enabled, the
 * transparent {@link PassThroughInterceptor} otherwise. The slot is always
 * registered on the async path because options resolve after the module is
 * defined, so the choice is made here at runtime.
 *
 * @param options - The resolved options snapshot (gates the timing feature).
 * @param sink - The bound timing sink; only used when timing is enabled.
 * @param clock - The bound monotonic clock seam; only used when timing is enabled.
 * @returns The real timing interceptor when enabled, else a transparent pass-through.
 */
export function selectAsyncTimingInterceptor(
  options: ResolvedCoreOptions,
  sink: ITimingSink,
  clock: MonotonicClock
): NestInterceptor {
  return options.timing.enabled
    ? new TimingInterceptor(options, sink, clock)
    : new PassThroughInterceptor()
}
