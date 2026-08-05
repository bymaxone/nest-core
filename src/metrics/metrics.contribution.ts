/**
 * @fileoverview Running the metrics contributors: find the marked providers,
 * check they implement the contract, and hand each one the registry exactly
 * once, at bootstrap.
 *
 * Nothing here loads `prom-client`. The registry arrives already resolved, and a
 * contributor's own collectors are its business; when metrics are disabled the
 * runner returns before touching anything, so a disabled application never
 * reaches the peer through this path either.
 * @layer Service
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import type { OnApplicationBootstrap } from '@nestjs/common'
import { DiscoveryService, Reflector } from '@nestjs/core'

import type { ResolvedCoreOptions } from '../core.options'
import { BYMAX_CORE_OPTIONS, BYMAX_METRICS_REGISTRY } from '../core.tokens'
import { findMarkedProviders } from '../discovery'
import type { ProviderScanner } from '../discovery'
import { BYMAX_METRICS_CONTRIBUTOR_METADATA } from './metrics.contract'
import type { IMetricsContributor, MetricsRegistry } from './metrics.contract'

/** A contributor paired with the identity to report it by. */
interface LabeledContributor {
  /** The contributor instance. */
  readonly contributor: IMetricsContributor
  /** Its class name, or its provider token when the class is anonymous. */
  readonly label: string
}

/**
 * Whether a resolved instance satisfies the contributor contract.
 *
 * @param instance - The provider instance to test.
 * @returns `true` when the instance can be handed the registry.
 */
function isContributor(instance: unknown): instance is IMetricsContributor {
  // Only nullish values need guarding: they are the two things a property read
  // throws on. Everything else answers the question below on its own.
  if (instance === null || instance === undefined) {
    return false
  }
  return typeof (instance as Partial<IMetricsContributor>).registerMetrics === 'function'
}

/**
 * Collect every marked contributor registered anywhere in the application.
 *
 * Sorted by label so contributors run in the same order on every boot: metric
 * registration is order-sensitive in one visible way — whichever contributor
 * claims a colliding name first is the one that succeeds — and an error that
 * changes identity between restarts is far harder to chase.
 *
 * @param discovery - Nest's discovery service, from `DiscoveryModule`.
 * @param reflector - Nest's metadata reader.
 * @returns The discovered contributors, ordered by label.
 * @throws Error When a marked provider does not implement `IMetricsContributor`.
 */
export function discoverContributors(
  discovery: ProviderScanner,
  reflector: Reflector
): readonly LabeledContributor[] {
  const found: LabeledContributor[] = []
  for (const marked of findMarkedProviders(
    discovery,
    reflector,
    BYMAX_METRICS_CONTRIBUTOR_METADATA
  )) {
    if (!isContributor(marked.instance)) {
      throw new Error(
        `[BymaxCoreModule] "${marked.label}" is marked with @BymaxMetricsContributor() but does ` +
          'not implement IMetricsContributor: it must expose a "registerMetrics" method.'
      )
    }
    found.push({ contributor: marked.instance, label: marked.label })
  }
  return found.sort((left, right) => left.label.localeCompare(right.label))
}

/**
 * Hand the registry to every contributor, in order.
 *
 * A failure is rethrown with the contributor named and the original error
 * chained. `prom-client` rejects a duplicate metric name with a message that
 * names the metric but not who registered it, which in an application composing
 * several libraries is the hard half of the question.
 *
 * @param contributors - The discovered contributors.
 * @param registry - The registry the scrape endpoint serves.
 * @throws Error When a contributor's registration fails.
 */
export function applyContributions(
  contributors: readonly LabeledContributor[],
  registry: MetricsRegistry
): void {
  for (const { contributor, label } of contributors) {
    try {
      contributor.registerMetrics(registry)
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause)
      throw new Error(`[BymaxCoreModule] "${label}" failed to register its metrics: ${reason}`, {
        cause
      })
    }
  }
}

/**
 * Runs the contributors once the container is fully instantiated.
 *
 * Bound to `onApplicationBootstrap`, not `onModuleInit`: module-init hooks run
 * concurrently across modules, so a contributor may not exist yet. Running at
 * bootstrap also means a name collision or a misdeclared contributor fails the
 * boot rather than the first scrape.
 */
@Injectable()
export class MetricsContributionRunner implements OnApplicationBootstrap {
  /** Nest's logger, scoped to the module, for the one line this feature writes. */
  private readonly logger = new Logger('BymaxCoreModule')

  /**
   * @param options - Resolved core options; the metrics gate is read from here.
   * @param registry - The registry the scrape endpoint serves. On the async path
   *   this resolves to a guarded placeholder while metrics are disabled, which is
   *   why the gate below runs before the registry is ever passed on.
   * @param discovery - Nest's provider-graph reader, present when
   *   `DiscoveryModule` is imported. Optional so this service stays constructible
   *   without it.
   * @param reflector - Nest's metadata reader, used to match the marker.
   */
  constructor(
    @Inject(BYMAX_CORE_OPTIONS) private readonly options: ResolvedCoreOptions,
    @Inject(BYMAX_METRICS_REGISTRY) private readonly registry: MetricsRegistry,
    @Optional() @Inject(DiscoveryService) private readonly discovery?: ProviderScanner,
    @Optional() @Inject(Reflector) private readonly reflector?: Reflector
  ) {}

  /**
   * Find the contributors and let each register its collectors.
   *
   * @throws Error When a marked provider is not a contributor, when one fails to
   *   register, or when metrics are enabled without Nest's discovery services —
   *   which means this runner was constructed outside `BymaxCoreModule`, and a
   *   silent skip would leave an operator with an endpoint quietly missing every
   *   metric a library publishes.
   */
  onApplicationBootstrap(): void {
    if (!this.options.metrics.enabled) {
      return
    }
    if (this.discovery === undefined || this.reflector === undefined) {
      throw new Error(
        "[BymaxCoreModule] metrics are enabled but Nest's DiscoveryService is not available. " +
          'Register the metrics feature through BymaxCoreModule, which imports DiscoveryModule for it.'
      )
    }
    const contributors = discoverContributors(this.discovery, this.reflector)
    applyContributions(contributors, this.registry)
    if (contributors.length > 0) {
      this.logger.log(
        `Registered metrics from ${contributors.length} contributor(s): ${contributors
          .map(({ label }) => label)
          .join(', ')}`
      )
    }
  }
}
