/**
 * @fileoverview Transparent pipeline building blocks for the async registration
 * path. `forRootAsync` cannot know the resolved options at module-definition
 * time, so the `APP_FILTER` slot is always registered and resolves the real
 * filter when the envelope feature is enabled or the pass-through otherwise,
 * which is intentionally indistinguishable from the feature's absence: it
 * defers to Nest's default handling.
 * @layer Provider
 */
import { Catch, NotFoundException } from '@nestjs/common'
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common'
import type { HttpAdapterHost } from '@nestjs/core'
import { BaseExceptionFilter } from '@nestjs/core'

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
 * Guard a controller route that could only be registered unconditionally on the
 * async path. When the owning feature resolves to disabled, answer `404` so the
 * route reads as absent.
 *
 * A disabled feature is the ordinary, intended state — not a misconfiguration —
 * and the async path registers its controller anyway because route metadata is
 * fixed before the options resolve. Throwing a plain `Error` here made every
 * such deployment serve an unauthenticated endpoint that answered `500` to
 * anyone who asked: a real server error in alerting, in error budgets and in any
 * uptime check, describing a state nothing was wrong with. `404` is the status
 * the caller would have seen had the framework been able to skip the
 * registration, which is the whole intent.
 *
 * The *status* is what matches; the body does not. This carries a message naming
 * the disabled feature, where a route that was never registered carries Nest's
 * own "Cannot GET /path". That is deliberate — an operator reading a log needs
 * to know which feature answered — and it is why the claim here is "reads as
 * absent" rather than "is indistinguishable".
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
