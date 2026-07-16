/**
 * @fileoverview No-op default bindings for the pluggable contracts. Both
 * registration paths wire these so the correlation-provider, timing-sink, and
 * health-indicator tokens always resolve, and consumers replace any of them with
 * a standard provider (`useValue` / `useExisting` / `useClass`) for the same
 * token. Defaults do nothing observable: the correlation provider returns
 * `undefined`, the timing sink discards its samples, the indicator list is empty.
 * @layer Provider
 */
import type { Provider } from '@nestjs/common'

import {
  BYMAX_CORRELATION_PROVIDER,
  BYMAX_HEALTH_INDICATORS,
  BYMAX_TIMING_SINK
} from './core.tokens'
import type { ICorrelationIdProvider } from './envelope/correlation.interfaces'
import type { ITimingSink } from './timing/timing.interfaces'

/**
 * Correlation provider that never resolves an id. Bound by default so the
 * envelope simply omits `correlationId` until a real provider is supplied.
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
 * Timing sink that discards every sample. Bound by default so timing can run
 * with no downstream sink configured.
 */
export class NoopTimingSink implements ITimingSink {
  /**
   * Discard the sample.
   *
   * @param _sample - The sample to discard.
   */
  record(_sample: Parameters<ITimingSink['record']>[0]): void {
    // Intentionally empty: the default sink is fire-and-forget and observable
    // behavior must be indistinguishable from having no sink at all.
  }
}

/**
 * Build the no-op default bindings for the pluggable contracts. Included in both
 * registration paths so the tokens always resolve; a consumer provider for the
 * same token overrides the default.
 *
 * @returns The default correlation-provider, timing-sink, and indicators providers.
 */
export function buildDefaultProviders(): Provider[] {
  return [
    { provide: BYMAX_CORRELATION_PROVIDER, useClass: NoopCorrelationIdProvider },
    { provide: BYMAX_TIMING_SINK, useClass: NoopTimingSink },
    { provide: BYMAX_HEALTH_INDICATORS, useValue: [] }
  ]
}
