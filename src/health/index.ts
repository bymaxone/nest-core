/**
 * @fileoverview Public barrel for the `./health` subpath. Ships the health
 * indicator contract and the health response types only; the aggregation
 * service and the controller are internal implementation details wired by
 * `BymaxCoreModule` and are not part of this subpath's public surface.
 * @layer public-api
 */

export type {
  HealthCheckEntry,
  HealthIndicatorResult,
  HealthResponse,
  IHealthIndicator
} from './health.interfaces'
