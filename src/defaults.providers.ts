/**
 * @fileoverview No-op fallback classes for the pluggable contracts, plus the
 * one token this module still binds unconditionally: the timing clock, which
 * has no meaningful "no-op" shape and is not a consumer override point.
 *
 * The correlation-provider, timing-sink, and health-indicator tokens are
 * deliberately NOT bound here. A consumer overrides one of these contracts by
 * providing the same `Symbol` token from their own module (marked `@Global()`
 * so the binding is visible outside that module), following the pattern
 * documented in the technical specification. NestJS resolves a dependency
 * against the provider's OWN hosting module first: if `BymaxCoreModule`
 * bound a hard local default for these tokens, that local binding would
 * always win over a sibling module's override, no matter how the consumer
 * registers it, making the documented override pattern impossible to use.
 * Each consuming class (`BymaxExceptionFilter`, `TimingInterceptor`,
 * `HealthService`) therefore injects its token with `@Optional()` and falls
 * back, in code, to one of the no-op classes below when nothing resolves, so
 * a consumer's override is picked up deterministically while the
 * unconfigured case still behaves exactly as before.
 * @layer Provider
 */
import type { Provider } from '@nestjs/common'

import type { ResolvedCoreOptions } from './core.options'
import { BYMAX_CORE_OPTIONS, BYMAX_TRACE_CONTEXT } from './core.tokens'
import type { ICorrelationIdProvider } from './envelope/correlation.interfaces'
import { resolveTraceContextProvider } from './telemetry/trace-context'
import type { ITraceContextProvider } from './telemetry/trace-context'
import { BYMAX_TIMING_CLOCK, DEFAULT_MONOTONIC_CLOCK } from './timing/timing.clock'
import type { ITimingSink, RequestTimingSample } from './timing/timing.interfaces'

/**
 * Correlation provider that never resolves an id. Used as the in-code
 * fallback so the envelope simply omits `correlationId` until a real
 * provider is supplied.
 */
export class NoopCorrelationIdProvider implements ICorrelationIdProvider {
  /**
   * Resolve no correlation id.
   *
   * @returns Always `undefined`.
   */
  getCorrelationId(): string | undefined {
    return undefined
  }
}

/**
 * Timing sink that discards every sample. Used as the in-code fallback so
 * timing can run with no downstream sink configured.
 */
export class NoopTimingSink implements ITimingSink {
  /**
   * Discard the sample.
   *
   * @param _sample - The sample to discard.
   */
  record(_sample: RequestTimingSample): void {
    // Intentionally empty: the default sink is fire-and-forget and observable
    // behavior must be indistinguishable from having no sink at all.
  }
}

/**
 * Build the module-owned default providers. The timing clock is the only
 * pluggable token bound unconditionally here: it is an internal seam (tests
 * substitute it directly), not a consumer override point, so no `@Optional()`
 * fallback applies to it.
 *
 * @returns The default timing-clock provider.
 */
export function buildDefaultProviders(): Provider[] {
  return [{ provide: BYMAX_TIMING_CLOCK, useValue: DEFAULT_MONOTONIC_CLOCK }]
}

/**
 * Build the `BYMAX_TRACE_CONTEXT` provider: an async factory resolving the
 * OpenTelemetry reader when telemetry is enabled and a no-op otherwise.
 *
 * Registered conditionally on the synchronous path, where the options are known,
 * so a disabled feature contributes no provider — the rule every other feature
 * follows. On the asynchronous path it is registered unconditionally, because
 * the options resolve after the module is defined; there the factory's own gate
 * is what keeps the optional peer unloaded.
 *
 * @returns The trace-context provider.
 */
export function buildTraceContextProvider(): Provider {
  return {
    provide: BYMAX_TRACE_CONTEXT,
    useFactory: (options: ResolvedCoreOptions): Promise<ITraceContextProvider> =>
      resolveTraceContextProvider(options),
    inject: [BYMAX_CORE_OPTIONS]
  }
}
