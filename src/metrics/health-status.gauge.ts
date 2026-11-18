/**
 * @fileoverview The `bymax_core_health_status` gauge: one series per readiness check, `1` while its
 * dependency answers healthy and `0` while it does not. Fed by the readiness aggregator each time it
 * observes a check, so a check that is up from the first probe reads `1` without a transition. The
 * only label is the check's name, which the application's own indicators declare, so its cardinality
 * is the number of indicators. `prom-client` is passed in by the registry seam and never imported
 * here.
 * @layer Provider
 */
import type { Gauge } from 'prom-client'

import type { ResolvedCoreOptions } from '../core.options'
import { loadPromClient } from './metrics.registry'
import type { MetricsRegistry, PromClientModule } from './metrics.registry'
import type { IHealthStatusRecorder } from '../health/health.status-recorder'

/** The gauge's metric name. */
export const HEALTH_STATUS_METRIC = 'bymax_core_health_status'

/** Records each readiness check's state on a gauge of the metrics registry. */
export class HealthStatusGauge implements IHealthStatusRecorder {
  private readonly gauge: Gauge<'indicator'>

  /**
   * @param registry - The registry the gauge is registered against.
   * @param promClient - The lazily loaded `prom-client` module.
   */
  constructor(registry: MetricsRegistry, promClient: PromClientModule) {
    this.gauge = new promClient.Gauge({
      name: HEALTH_STATUS_METRIC,
      help: 'Readiness state of each health check: 1 while its dependency is up, 0 while it is down.',
      labelNames: ['indicator'],
      registers: [registry]
    })
  }

  /** Set the check's series to `1` when up and `0` when down. */
  record(name: string, isUp: boolean): void {
    this.gauge.set({ indicator: name }, isUp ? 1 : 0)
  }
}

/**
 * Resolve the recorder the readiness aggregator is given: the gauge when metrics and health are both
 * enabled, and nothing otherwise, so a disabled combination never loads the optional peer.
 *
 * @param options - The resolved core options.
 * @param registry - The resolved metrics registry.
 * @returns The gauge, or `undefined` when metrics or health is off.
 * @throws Error When metrics are enabled but the optional peer is not installed.
 */
export async function resolveHealthStatusRecorder(
  options: ResolvedCoreOptions,
  registry: MetricsRegistry
): Promise<IHealthStatusRecorder | undefined> {
  if (!options.metrics.enabled || !options.health.enabled) return undefined
  return new HealthStatusGauge(registry, await loadPromClient())
}
