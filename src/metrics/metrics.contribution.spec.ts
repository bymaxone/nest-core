/**
 * Unit tests for metrics contribution.
 *
 * Layer: unit.
 * Goal: prove marked contributors are collected in a stable order, that a marked
 * provider which does not implement the contract fails instead of being skipped,
 * that a registration failure names the contributor and keeps the original
 * error, and that the runner does nothing at all while metrics are disabled.
 * Mocks: the provider graph is expressed as plain objects against the structural
 * `ProviderScanner` contract; metadata is read by the real `Reflector`; the
 * registry is a real `prom-client` registry, so a duplicate metric name fails
 * the way it will in production.
 */
import { ConsoleLogger, Logger } from '@nestjs/common'
import type { LoggerService } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Counter, Registry } from 'prom-client'

import { normalizeCoreOptions } from '../core.options'
import type { ProviderNode, ProviderScanner } from '../discovery'
import {
  applyContributions,
  discoverContributors,
  MetricsContributionRunner
} from './metrics.contribution'
import { BymaxMetricsContributor } from './metrics.contract'
import type { IMetricsContributor, MetricsRegistry } from './metrics.contract'

/** A contributor registering one counter under the name it is built with. */
@BymaxMetricsContributor()
class QueueMetrics implements IMetricsContributor {
  /** The metric name this contributor claims. */
  static metricName = 'bymax_queue_depth'

  /**
   * Register the queue-depth counter.
   *
   * @param registry - The shared registry.
   */
  registerMetrics(registry: MetricsRegistry): void {
    new Counter({ name: QueueMetrics.metricName, help: 'queue depth', registers: [registry] })
  }
}

/** A second contributor, named so it sorts before the first. */
@BymaxMetricsContributor()
class CacheMetrics implements IMetricsContributor {
  /**
   * Register the cache-hits counter.
   *
   * @param registry - The shared registry.
   */
  registerMetrics(registry: MetricsRegistry): void {
    new Counter({ name: 'bymax_cache_hits_total', help: 'cache hits', registers: [registry] })
  }
}

/** A marked class that forgot the contract. */
@BymaxMetricsContributor()
class IncompleteContributor {}

/** An unmarked provider that happens to have the method. */
class UnmarkedService implements IMetricsContributor {
  /**
   * Register nothing observable.
   *
   * @param _registry - Unused.
   */
  registerMetrics(_registry: MetricsRegistry): void {
    // Intentionally empty: this provider must never be called at all.
  }
}

/** Captures what Nest's logger received, message and context alike. */
const logged: LoggerService = {
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn()
}

/** Build a scanner over class providers, as Nest would expose them. */
function scannerOver(classes: ReadonlyArray<new () => object>): ProviderScanner {
  return {
    getProviders: () =>
      classes.map((metatype) => ({ metatype, instance: new metatype(), name: metatype.name }))
  }
}

describe('discoverContributors', () => {
  const reflector = new Reflector()

  /**
   * Only marked providers contribute.
   *
   * A provider that merely exposes `registerMetrics` was never offered to this
   * feature; calling it would be this package reaching into code that did not
   * opt in.
   */
  it('collects marked contributors and ignores everything else', () => {
    const found = discoverContributors(scannerOver([QueueMetrics, UnmarkedService]), reflector)

    expect(found.map((entry) => entry.label)).toEqual(['QueueMetrics'])
  })

  /**
   * The order is stable, not the container's.
   *
   * Registration order decides which contributor wins a colliding metric name,
   * so an order that shifts between restarts would make the resulting failure
   * change identity from boot to boot.
   */
  it('returns contributors sorted by label', () => {
    const found = discoverContributors(scannerOver([QueueMetrics, CacheMetrics]), reflector)

    expect(found.map((entry) => entry.label)).toEqual(['CacheMetrics', 'QueueMetrics'])
  })

  /**
   * A marked provider that is not a contributor fails loudly.
   *
   * Skipping it would leave an operator with a scrape endpoint quietly missing
   * the metrics they declared. The whole message is asserted: it has to name the
   * class, the marker, and the method that is missing.
   */
  it('throws naming the class when a marked provider is not a contributor', () => {
    expect(() => discoverContributors(scannerOver([IncompleteContributor]), reflector)).toThrow(
      '[BymaxCoreModule] "IncompleteContributor" is marked with @BymaxMetricsContributor() but ' +
        'does not implement IMetricsContributor: it must expose a "registerMetrics" method.'
    )
  })

  /**
   * A marked provider resolved to a non-object. Edge case.
   *
   * The contract check must reject it with the descriptive error rather than
   * crashing while inspecting it.
   */
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'nope']
  ])('rejects a marked provider whose instance is %s', (_label, instance) => {
    const nodes: ProviderNode[] = [{ metatype: IncompleteContributor, instance, name: 'TOKEN' }]

    expect(() => discoverContributors({ getProviders: () => nodes }, reflector)).toThrow(
      /does not implement IMetricsContributor/
    )
  })
})

describe('applyContributions', () => {
  /**
   * Every contributor gets the registry, and its metrics reach a scrape.
   *
   * The contract's whole promise: a collector registered here appears at the
   * endpoint the application already serves.
   */
  it('registers every contributor collector on the shared registry', async () => {
    const registry = new Registry()
    const contributors = discoverContributors(
      scannerOver([QueueMetrics, CacheMetrics]),
      new Reflector()
    )

    applyContributions(contributors, registry)
    const scraped = await registry.metrics()

    expect(scraped).toContain('bymax_queue_depth')
    expect(scraped).toContain('bymax_cache_hits_total')
  })

  /**
   * A colliding metric name names the contributor that failed.
   *
   * `prom-client` reports the metric name but not who registered it, which in an
   * application composing several libraries is the hard half of the question.
   */
  it('names the contributor when its registration fails', () => {
    const registry = new Registry()
    const contributors = discoverContributors(scannerOver([QueueMetrics]), new Reflector())
    applyContributions(contributors, registry)

    expect(() => applyContributions(contributors, registry)).toThrow(
      /"QueueMetrics" failed to register its metrics: .*bymax_queue_depth/
    )
  })

  /**
   * The original failure survives. Edge case: chained cause.
   *
   * The wrapper replaces the message, so without chaining the cause the actual
   * `prom-client` error — the only thing that says what went wrong — would be
   * lost.
   */
  it('chains the underlying registration error as the cause', () => {
    const registry = new Registry()
    const boom = new Error('collector exploded')
    const contributors = [
      {
        label: 'ExplodingContributor',
        contributor: {
          registerMetrics: (): void => {
            throw boom
          }
        }
      }
    ]

    expect(() => applyContributions(contributors, registry)).toThrow(
      expect.objectContaining({ cause: boom })
    )
  })

  /**
   * A non-Error rejection is still reported. Edge case: thrown string.
   *
   * Nothing guarantees a contributor throws an `Error`; the wrapper must still
   * produce a legible message instead of `[object Object]`.
   */
  it('reports a thrown non-error value', () => {
    const registry = new Registry()
    const contributors = [
      {
        label: 'RudeContributor',
        contributor: {
          registerMetrics: (): void => {
            throw 'just a string'
          }
        }
      }
    ]

    expect(() => applyContributions(contributors, registry)).toThrow(
      '[BymaxCoreModule] "RudeContributor" failed to register its metrics: just a string'
    )
  })
})

describe('MetricsContributionRunner', () => {
  const reflector = new Reflector()

  afterEach(() => {
    // Restored explicitly: neither `clearMocks` nor `restoreMocks` reaches Nest's
    // global logger override.
    Logger.overrideLogger(new ConsoleLogger())
  })

  /**
   * Disabled metrics run nothing at all.
   *
   * The runner is registered on the asynchronous path whatever the options say,
   * so its gate is what keeps a disabled application from scanning the container
   * and from touching the registry placeholder bound in its place.
   */
  it('does nothing while metrics are disabled', () => {
    const getProviders = jest.fn(() => [])
    const runner = new MetricsContributionRunner(
      normalizeCoreOptions({ metrics: { enabled: false } }),
      new Registry(),
      { getProviders },
      reflector
    )

    runner.onApplicationBootstrap()

    expect(getProviders).not.toHaveBeenCalled()
  })

  /**
   * Enabled metrics run the contributors once.
   *
   * This is the feature: a library's metrics appear on the scrape endpoint with
   * nothing registered by the application.
   */
  it('registers contributor metrics when metrics are enabled', async () => {
    const registry = new Registry()
    const runner = new MetricsContributionRunner(
      normalizeCoreOptions({ metrics: { enabled: true } }),
      registry,
      scannerOver([CacheMetrics]),
      reflector
    )

    runner.onApplicationBootstrap()

    expect(await registry.metrics()).toContain('bymax_cache_hits_total')
  })

  /**
   * The boot line names how many contributors ran, and which.
   *
   * It is the only feedback an operator gets that a library's metrics were
   * picked up; a scrape endpoint missing a metric is otherwise indistinguishable
   * from a library that never published one.
   */
  it('logs the contributors it ran, by name, under the module context', () => {
    const runner = new MetricsContributionRunner(
      normalizeCoreOptions({ metrics: { enabled: true } }),
      new Registry(),
      scannerOver([QueueMetrics, CacheMetrics]),
      reflector
    )
    Logger.overrideLogger(logged)

    runner.onApplicationBootstrap()

    expect(logged.log).toHaveBeenCalledWith(
      'Registered metrics from 2 contributor(s): CacheMetrics, QueueMetrics',
      'BymaxCoreModule'
    )
  })

  /**
   * Nothing to report means nothing logged.
   *
   * An application with metrics on and no contributing library must boot without
   * a line about it; a log entry that always appears carries no information.
   */
  it('logs nothing when no contributor was found', () => {
    const runner = new MetricsContributionRunner(
      normalizeCoreOptions({ metrics: { enabled: true } }),
      new Registry(),
      scannerOver([UnmarkedService]),
      reflector
    )
    Logger.overrideLogger(logged)

    runner.onApplicationBootstrap()

    expect(logged.log).not.toHaveBeenCalled()
  })

  /**
   * Enabled metrics without Nest's scanner fail loudly. Edge case.
   *
   * Reachable only when the runner is constructed outside `BymaxCoreModule`,
   * which is the one case where `DiscoveryModule` has not been imported. A
   * silent skip would leave the endpoint quietly missing every library metric.
   */
  it('throws when metrics are enabled but the scanner is unavailable', () => {
    const runner = new MetricsContributionRunner(
      normalizeCoreOptions({ metrics: { enabled: true } }),
      new Registry()
    )

    expect(() => runner.onApplicationBootstrap()).toThrow(
      "[BymaxCoreModule] metrics are enabled but Nest's DiscoveryService is not available. " +
        'Register the metrics feature through BymaxCoreModule, which imports DiscoveryModule for it.'
    )
  })
})
