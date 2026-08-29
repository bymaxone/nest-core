/**
 * @fileoverview Public barrel for the `./health` subpath. Ships the health
 * indicator contract, the health response types, and the marker that makes an
 * indicator discoverable; the aggregation service, the discovery scan and the
 * controller are internal implementation details wired by `BymaxCoreModule` and
 * are not part of this subpath's public surface.
 *
 * The marker lives here, not at the package root, for the same reason the
 * contract does: a library that only implements an indicator should not have to
 * import the module.
 * @layer public-api
 */

export { BymaxHealthIndicator, BYMAX_HEALTH_INDICATOR_METADATA } from './health.marker'

export type {
  HealthCheckEntry,
  HealthIndicatorResult,
  HealthResponse,
  IHealthIndicator
} from './health.interfaces'

export type {
  HealthTransition,
  HealthTransitionCause,
  IHealthTransitionSink
} from './health.transition'
