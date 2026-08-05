/**
 * @fileoverview The contract a component implements to publish its own metrics
 * on the application's registry, and the marker that makes it discoverable.
 *
 * Unlike the rest of this package, this file names `prom-client` types. That is
 * deliberate and not a leak of the optional peer: the only reason to implement
 * this contract is to construct `prom-client` collectors, so anyone importing
 * the `./metrics` subpath already depends on the peer. Every other subpath stays
 * free of it.
 *
 * Contributors receive the registry rather than injecting it. A library that
 * injected `BYMAX_METRICS_REGISTRY` would depend on this package's DI tokens,
 * and therefore on the module; receiving the registry as an argument means the
 * only thing it imports is this contract and the marker.
 * @layer Contract
 */
import { SetMetadata } from '@nestjs/common'
import type { CustomDecorator } from '@nestjs/common'
import type * as PromClient from 'prom-client'

/**
 * The dedicated registry backing the application's scrape endpoint. Collectors
 * registered against it appear at `GET /metrics`; nothing else does.
 */
export type MetricsRegistry = PromClient.Registry

/**
 * A component that publishes its own metrics.
 *
 * Implement it on a provider, mark the class, and the module calls it once at
 * bootstrap with the registry the scrape endpoint serves. Registration failures
 * — most often a metric name another component already claimed — fail the boot
 * with the contributor named, rather than surfacing at the first scrape.
 */
export interface IMetricsContributor {
  /**
   * Register this component's collectors against the shared registry.
   *
   * Called exactly once, during application bootstrap, and only when the metrics
   * feature is enabled. Construct collectors with `registers: [registry]` (or
   * call `registry.registerMetric`); do not create metrics on the global default
   * registry, which this package never scrapes.
   *
   * @param registry - The registry the scrape endpoint serves.
   */
  registerMetrics(registry: MetricsRegistry): void
}

/**
 * Reflect metadata key carrying the contributor marker. Namespaced so it cannot
 * collide with a consumer's own metadata, and exported so a conformance test can
 * assert a class is marked without depending on how the decorator is built.
 */
export const BYMAX_METRICS_CONTRIBUTOR_METADATA = 'bymax-one:metrics-contributor'

/**
 * Mark a provider class as a metrics contributor, so `BymaxCoreModule` calls it
 * at bootstrap without the application wiring anything.
 *
 * The class must implement {@link IMetricsContributor}; a marked provider that
 * does not fails at bootstrap with a message naming it. Contributors run only
 * when the metrics feature is enabled — marking a class in an application that
 * leaves metrics off costs one metadata entry and changes nothing.
 *
 * @returns The class decorator carrying the marker.
 * @example
 *   \@BymaxMetricsContributor()
 *   \@Injectable()
 *   export class QueueMetrics implements IMetricsContributor {
 *     registerMetrics(registry: MetricsRegistry): void {
 *       new Gauge({ name: 'bymax_queue_depth', help: 'Jobs waiting', registers: [registry] })
 *     }
 *   }
 */
export function BymaxMetricsContributor(): CustomDecorator<string> {
  return SetMetadata(BYMAX_METRICS_CONTRIBUTOR_METADATA, true)
}
