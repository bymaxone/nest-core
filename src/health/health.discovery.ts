/**
 * @fileoverview Indicator discovery: turn the providers an application already
 * registered into the readiness set, without the application listing them.
 *
 * The scan itself is the shared marker-based one; what lives here is what is
 * specific to readiness — validating the indicator contract, ordering the
 * result, and merging it with what the application registered by hand.
 * @layer Service
 */
import type { Reflector } from '@nestjs/core'

import { findMarkedProviders } from '../discovery'
import type { ProviderScanner } from '../discovery'
import type { IHealthIndicator } from './health.interfaces'
import { BYMAX_HEALTH_INDICATOR_METADATA } from './health.marker'

/**
 * Whether a resolved instance satisfies the indicator contract: a non-empty
 * `name` to report the check under, and a `check` to run.
 *
 * @param instance - The provider instance to test.
 * @returns `true` when the instance can be run as an indicator.
 */
function isIndicator(instance: unknown): instance is IHealthIndicator {
  // Only nullish values need guarding: they are the two things a property read
  // throws on. Everything else answers the questions below on its own.
  if (instance === null || instance === undefined) {
    return false
  }
  const candidate = instance as Partial<IHealthIndicator>
  return (
    typeof candidate.name === 'string' &&
    candidate.name !== '' &&
    typeof candidate.check === 'function'
  )
}

/**
 * Collect every marked indicator registered anywhere in the application.
 *
 * A marked provider that does not satisfy the contract throws rather than being
 * skipped: the marker is an explicit declaration, so ignoring it would hide a
 * readiness check the operator believes is running — the worst possible outcome
 * for a probe. Results are sorted by name so the readiness response is stable
 * across restarts, which the container's own provider order is not.
 *
 * @param discovery - Nest's discovery service, from `DiscoveryModule`.
 * @param reflector - Nest's metadata reader.
 * @returns The discovered indicators, ordered by name.
 * @throws Error When a marked provider does not implement `IHealthIndicator`.
 */
export function discoverIndicators(
  discovery: ProviderScanner,
  reflector: Reflector
): readonly IHealthIndicator[] {
  const discovered: IHealthIndicator[] = []
  for (const marked of findMarkedProviders(discovery, reflector, BYMAX_HEALTH_INDICATOR_METADATA)) {
    if (!isIndicator(marked.instance)) {
      throw new Error(
        `[BymaxCoreModule] "${marked.label}" is marked with @BymaxHealthIndicator() but does not ` +
          'implement IHealthIndicator: it must expose a non-empty "name" and a "check" method.'
      )
    }
    discovered.push(marked.instance)
  }
  return discovered.sort((left, right) => left.name.localeCompare(right.name))
}

/**
 * Merge the explicitly registered indicators with the discovered ones.
 *
 * Explicit registration wins a name collision and keeps its position: an
 * application that already lists an indicator under a name has decided what that
 * check is, and enabling discovery must not reorder or replace it. Discovered
 * indicators follow, in their own stable order.
 *
 * @param explicit - Indicators bound under `BYMAX_HEALTH_INDICATORS`.
 * @param discovered - Indicators found by {@link discoverIndicators}.
 * @returns The full readiness set, explicit entries first.
 */
export function mergeIndicators(
  explicit: readonly IHealthIndicator[],
  discovered: readonly IHealthIndicator[]
): readonly IHealthIndicator[] {
  const claimed = new Set(explicit.map((indicator) => indicator.name))
  return [...explicit, ...discovered.filter((indicator) => !claimed.has(indicator.name))]
}
