/**
 * Integration tests for the `./metrics` public barrel.
 *
 * Layer: integration.
 * Goal: prove a library that only publishes metrics can reach everything it
 * needs through this subpath alone — the contract and the marker — and that the
 * marker reached through the barrel is the one the contribution scan matches.
 * Mocks: none; Nest's own `Reflector` reads the metadata back and the real scan
 * runs over a hand-built provider graph.
 */
import { Reflector } from '@nestjs/core'
import { Counter, Registry } from 'prom-client'

import { discoverContributors } from './metrics.contribution'
import * as barrel from './index'
import { BymaxMetricsContributor, BYMAX_METRICS_CONTRIBUTOR_METADATA } from './index'
import type { IMetricsContributor, MetricsRegistry } from './index'

/**
 * A contributor declared exactly as a sibling library would declare one: the
 * contract and the marker both imported from this subpath, with no reference to
 * `BymaxCoreModule` or to any DI token.
 */
@BymaxMetricsContributor()
class LibraryMetrics implements IMetricsContributor {
  /**
   * Register one collector.
   *
   * @param registry - The shared registry.
   */
  registerMetrics(registry: MetricsRegistry): void {
    new Counter({ name: 'bymax_library_events_total', help: 'events', registers: [registry] })
  }
}

describe('metrics subpath barrel', () => {
  /**
   * The published surface is the contract and its marker, nothing else.
   *
   * The registry factory, the controller, the contribution runner and the timing
   * bridge are implementation details; exporting them would freeze internals a
   * consumer never needs.
   */
  it('exports only the marker and its metadata key at runtime', () => {
    expect(Object.keys(barrel).sort()).toEqual([
      'BYMAX_METRICS_CONTRIBUTOR_METADATA',
      'BymaxMetricsContributor'
    ])
    expect(BYMAX_METRICS_CONTRIBUTOR_METADATA).toBe('bymax-one:metrics-contributor')
  })

  /**
   * A class marked through the barrel is found and run by the scan.
   *
   * This is the seam a per-subpath bundle could break: the marker is bundled
   * into `./metrics` and the scan into the package root, so a generated metadata
   * key would leave the two copies disagreeing and nothing would ever be
   * collected.
   */
  it('marks a class the contribution scan then finds and runs', async () => {
    const registry = new Registry()
    const graph = [{ metatype: LibraryMetrics, instance: new LibraryMetrics() }]

    const found = discoverContributors({ getProviders: () => graph }, new Reflector())
    for (const { contributor } of found) {
      contributor.registerMetrics(registry)
    }

    expect(found.map((entry) => entry.label)).toEqual(['LibraryMetrics'])
    expect(await registry.metrics()).toContain('bymax_library_events_total')
  })
})
