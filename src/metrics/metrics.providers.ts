/**
 * @fileoverview Provider builders wiring the optional metrics feature into
 * `BymaxCoreModule` on both registration paths. Every builder keeps
 * `prom-client` behind the lazy registry factory: the registry provider loads
 * the peer only when metrics resolve enabled, and the timing-sink provider
 * composes the metrics bridge only when timing and metrics are both enabled.
 *
 * On the sync path these providers are added only when the feature is enabled,
 * so a disabled configuration never touches `prom-client`. On the async path,
 * where options are unknown at module-definition time, the providers are always
 * registered and gate themselves at resolution: the registry resolves to a
 * guarded placeholder when disabled, so the `BYMAX_METRICS_REGISTRY` token
 * resolves without ever loading the optional peer, and the effective timing
 * sink falls back to the no-op when metrics or timing is off.
 *
 * Composition of the timing sink: when timing and metrics are both enabled this
 * binds the `TimingMetricsSink` as the effective `BYMAX_TIMING_SINK`, replacing
 * the no-op default so HTTP samples feed the two default HTTP metrics. A
 * consumer who binds their own `BYMAX_TIMING_SINK` overrides this default per
 * standard NestJS last-registered-wins semantics, opting out of the built-in
 * HTTP metrics in favor of their own sink.
 * @layer Provider
 */
import type { Provider } from '@nestjs/common'

import type { ResolvedCoreOptions } from '../core.options'
import { BYMAX_CORE_OPTIONS, BYMAX_METRICS_REGISTRY, BYMAX_TIMING_SINK } from '../core.tokens'
import { NoopTimingSink } from '../defaults.providers'
import { createMetricsRegistry, loadPromClient } from './metrics.registry'
import type { MetricsRegistry } from './metrics.registry'
import { TimingMetricsSink } from './timing-metrics.sink'
import type { ITimingSink } from '../timing/timing.interfaces'

/**
 * Build a placeholder that stands in for the metrics registry when metrics
 * resolve disabled on the async path. The metrics controller's guard throws
 * before any scrape when metrics are disabled, so this value is never
 * dereferenced in practice; it exists only so `BYMAX_METRICS_REGISTRY` resolves
 * without loading the optional peer `prom-client`. An accidental scrape throws
 * descriptively rather than silently loading the peer.
 *
 * @returns A registry-typed placeholder whose scrape throws.
 */
function createDisabledRegistryPlaceholder(): MetricsRegistry {
  const throwDisabled = (): never => {
    throw new Error(
      '[BymaxCoreModule] The metrics registry was accessed while metrics are disabled. ' +
        'Enable "metrics" in the resolved options before injecting the registry.'
    )
  }
  // A minimal, non-thenable stand-in typed as the registry: the metrics
  // controller's guard throws before any scrape when metrics are disabled, so
  // this is never dereferenced in practice. It exists only so
  // BYMAX_METRICS_REGISTRY resolves on the async path without loading the
  // optional peer; an accidental scrape throws descriptively instead. It cannot
  // throw on arbitrary property reads: Nest's DI resolution reads properties on
  // the resolved value, so a throwing accessor would break module boot.
  return { metrics: throwDisabled } as unknown as MetricsRegistry
}

/**
 * Resolve the value bound to `BYMAX_METRICS_REGISTRY`. When metrics are enabled,
 * the lazy factory loads `prom-client` and builds the dedicated registry; when
 * disabled, a guarded placeholder is returned so the token resolves on the async
 * path without loading the optional peer.
 *
 * @param options - The resolved core options.
 * @returns The dedicated registry, or a guarded placeholder when disabled.
 * @throws Error When metrics are enabled but the optional peer is not installed.
 */
export async function resolveMetricsRegistry(
  options: ResolvedCoreOptions
): Promise<MetricsRegistry> {
  if (!options.metrics.enabled) {
    return createDisabledRegistryPlaceholder()
  }
  return createMetricsRegistry(options)
}

/**
 * Resolve the effective timing sink. When timing and metrics are both enabled,
 * the `TimingMetricsSink` bridge feeds the default HTTP metrics; otherwise the
 * no-op sink is used, so a disabled combination never touches the registry.
 *
 * @param options - The resolved core options.
 * @param registry - The resolved metrics registry (the bridge target).
 * @returns The metrics bridge when both features are enabled, else a no-op sink.
 * @throws Error When metrics are enabled but the optional peer is not installed.
 */
export async function resolveTimingSink(
  options: ResolvedCoreOptions,
  registry: MetricsRegistry
): Promise<ITimingSink> {
  if (options.metrics.enabled && options.timing.enabled) {
    return new TimingMetricsSink(registry, await loadPromClient())
  }
  return new NoopTimingSink()
}

/**
 * Build the `BYMAX_METRICS_REGISTRY` provider: an async factory that resolves
 * the registry (or its disabled placeholder) from the resolved options.
 *
 * @returns The registry provider.
 */
export function buildMetricsRegistryProvider(): Provider {
  return {
    provide: BYMAX_METRICS_REGISTRY,
    useFactory: (options: ResolvedCoreOptions): Promise<MetricsRegistry> =>
      resolveMetricsRegistry(options),
    inject: [BYMAX_CORE_OPTIONS]
  }
}

/**
 * Build the `BYMAX_TIMING_SINK` provider that binds the metrics bridge when
 * timing and metrics are both enabled. Registered after the no-op default so it
 * overrides it on the paths that add it.
 *
 * @returns The timing-sink provider.
 */
export function buildMetricsTimingSinkProvider(): Provider {
  return {
    provide: BYMAX_TIMING_SINK,
    useFactory: (options: ResolvedCoreOptions, registry: MetricsRegistry): Promise<ITimingSink> =>
      resolveTimingSink(options, registry),
    inject: [BYMAX_CORE_OPTIONS, BYMAX_METRICS_REGISTRY]
  }
}
