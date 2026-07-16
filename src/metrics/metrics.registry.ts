/**
 * @fileoverview Lazy `prom-client` registry factory. `prom-client` is an
 * optional peer dependency: consumers who never enable metrics never install it
 * and never load it. Every runtime touch of `prom-client` in the whole package
 * stays behind the dynamic `import()` executed inside {@link loadPromClient}, so
 * a static top-level import never leaks the dependency into consumers who leave
 * metrics disabled. The `import type` references below are erased at compile
 * time and never load the module at runtime.
 * @layer Provider
 */
import type * as PromClient from 'prom-client'

import type { ResolvedCoreOptions } from '../core.options'

/** The dedicated `prom-client` `Registry` backing the metrics endpoint. */
export type MetricsRegistry = PromClient.Registry

/**
 * The subset of the `prom-client` module surface this package constructs at
 * runtime. Declared structurally, and only over a type-only namespace import, so
 * the lazily loaded module is fully typed without a top-level runtime import
 * that would defeat the optional-peer contract.
 */
export interface PromClientModule {
  /** The registry constructor, instantiated once per enabled metrics feature. */
  readonly Registry: new () => PromClient.Registry
  /** The counter constructor, used by the timing-sink bridge. */
  readonly Counter: new <T extends string>(
    configuration: PromClient.CounterConfiguration<T>
  ) => PromClient.Counter<T>
  /** The histogram constructor, used by the timing-sink bridge. */
  readonly Histogram: new <T extends string>(
    configuration: PromClient.HistogramConfiguration<T>
  ) => PromClient.Histogram<T>
  /** Wire process CPU, memory, and event-loop metrics against a registry. */
  readonly collectDefaultMetrics: (
    config?: PromClient.DefaultMetricsCollectorConfiguration<PromClient.PrometheusContentType>
  ) => void
}

/**
 * Guidance shown when metrics are enabled but the optional peer is absent. Names
 * the package and the exact install command so the failure is self-explanatory
 * at boot rather than a cryptic module-resolution error at request time.
 */
const MISSING_PEER_MESSAGE =
  'metrics.enabled is true but the optional peer prom-client is not installed. Run: pnpm add prom-client'

/**
 * Load `prom-client` lazily through a dynamic import. This is the only runtime
 * access to the optional peer in the whole package; a module-not-found failure
 * is rethrown as a descriptive boot error naming the package and the install
 * command, so enabling metrics without the peer fails fast and legibly instead
 * of surfacing a cryptic resolution error at the first scrape.
 *
 * @returns The loaded `prom-client` module.
 * @throws Error When `prom-client` is not installed.
 */
export async function loadPromClient(): Promise<PromClientModule> {
  try {
    return await import('prom-client')
  } catch (cause) {
    throw new Error(MISSING_PEER_MESSAGE, { cause })
  }
}

/**
 * Create the dedicated `prom-client` `Registry` backing the metrics endpoint.
 * `prom-client` is loaded here, lazily, and only when this factory runs, which
 * the module wires exclusively when `metrics.enabled` resolves true. The
 * resolved `defaultLabels` are applied to every metric the registry emits, and
 * `collectDefaultMetrics` (process CPU, memory, event-loop lag) is wired only
 * when the resolved options opt in.
 *
 * @param options - The resolved core options; supplies the metrics block.
 * @returns The configured registry, ready to bind under `BYMAX_METRICS_REGISTRY`.
 * @throws Error When the optional peer `prom-client` is not installed.
 */
export async function createMetricsRegistry(
  options: ResolvedCoreOptions
): Promise<MetricsRegistry> {
  const promClient = await loadPromClient()
  const registry = new promClient.Registry()
  registry.setDefaultLabels(options.metrics.defaultLabels)
  if (options.metrics.collectDefaultMetrics) {
    promClient.collectDefaultMetrics({ register: registry })
  }
  return registry
}
