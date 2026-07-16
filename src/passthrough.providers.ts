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
import { Catch } from '@nestjs/common'
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
 * async path as the transparent stand-in for the timing feature. The async
 * selector returns it unconditionally today; it becomes the disabled-feature
 * branch once the real timing interceptor exists. It adds no observable
 * behavior and no measurable per-request work.
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
 * async path. When the owning feature resolves to disabled, fail fast with a
 * descriptive configuration error instead of serving a half-configured route.
 *
 * @param feature - The feature name, used in the error message.
 * @param enabled - Whether the feature is enabled in the resolved options.
 * @throws Error When the feature is disabled.
 */
export function assertAsyncFeatureEnabled(feature: string, enabled: boolean): void {
  if (!enabled) {
    throw new Error(
      `[BymaxCoreModule] The "${feature}" controller was reached while the feature is disabled. ` +
        `On the forRootAsync path this controller is always registered because options resolve ` +
        `after the module is defined; enable "${feature}" in the resolved options, or do not ` +
        `expose this controller while the feature is disabled.`
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
 * @param correlation - Provider resolving the current request's correlation id.
 * @param adapterHost - The HTTP adapter host used to read and write the response.
 * @returns The real envelope filter when enabled, else a transparent pass-through.
 */
export function selectAsyncExceptionFilter(
  options: ResolvedCoreOptions,
  correlation: ICorrelationIdProvider,
  adapterHost: HttpAdapterHost
): ExceptionFilter {
  return options.envelope.enabled
    ? new BymaxExceptionFilter(options, correlation, adapterHost)
    : new PassThroughExceptionFilter(adapterHost)
}

/**
 * Build the pass-through interceptor for a disabled timing feature. The
 * resolved options are the gating seam later phases read to return the real
 * timing interceptor when enabled.
 *
 * @param _options - The resolved options snapshot (gating seam input).
 * @returns A transparent interceptor.
 */
export function selectAsyncTimingInterceptor(_options: ResolvedCoreOptions): NestInterceptor {
  return new PassThroughInterceptor()
}
