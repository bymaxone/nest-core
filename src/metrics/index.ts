/**
 * @fileoverview Public barrel for the `./metrics` subpath. Ships the metrics
 * contribution contract and its marker, so a library that publishes metrics
 * imports neither the module nor the DI tokens; the registry factory, the
 * controller, the contribution runner and the timing bridge are internal.
 *
 * This is the one subpath whose types name `prom-client`. Implementing the
 * contract means constructing `prom-client` collectors, so anyone importing here
 * already depends on the peer; every other subpath stays free of it.
 * @layer public-api
 */

export { BymaxMetricsContributor, BYMAX_METRICS_CONTRIBUTOR_METADATA } from './metrics.contract'

export type { IMetricsContributor, MetricsRegistry } from './metrics.contract'
