/**
 * @fileoverview The seam between the readiness aggregator and the metrics feature: something that is
 * told, for each check, whether its dependency is up. Internal to the package and not exported from a
 * barrel; the token is minted with `Symbol.for`, as every token here is, so that the bundles share
 * one identity.
 * @layer Contract
 */

/** Receives the state of one readiness check each time it is observed. */
export interface IHealthStatusRecorder {
  /**
   * Record whether a check's dependency is up.
   *
   * @param name - The check's name, as the indicator declares it.
   * @param isUp - Whether the dependency answered healthy.
   */
  record(name: string, isUp: boolean): void
}

/** Binds an {@link IHealthStatusRecorder}, which exists only when metrics and health are both on. */
export const BYMAX_HEALTH_STATUS_RECORDER: unique symbol = Symbol.for(
  '@bymax-one/nest-core:health-status-recorder'
)
