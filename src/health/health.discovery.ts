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

import { bootError } from '../boot-error'
import { findMarkedProviders } from '../discovery'
import type { ProviderScanner } from '../discovery'
import { asHostError } from '../host-error'
import type { IHealthIndicator } from './health.interfaces'
import { BYMAX_HEALTH_INDICATOR_METADATA } from './health.marker'

/**
 * A marked provider as an indicator with the name it was read under: its `name` and `check` are
 * read once each, and a failure of reading them is refused as a boot error that names the provider
 * and keeps what was thrown as the cause.
 *
 * @param instance - The provider instance to read.
 * @param label - The provider's label for an error message.
 * @returns The indicator, or `undefined` when it has no non-empty `name` and `check` method.
 * @throws Error When reading the provider throws.
 */
function readIndicator(instance: unknown, label: string): NamedIndicator | undefined {
  // Only nullish values need guarding against: they are the two things a destructuring read throws
  // on without a host getter being involved.
  if (instance === null || instance === undefined) {
    return undefined
  }
  try {
    const { name, check } = instance as Partial<IHealthIndicator>
    return typeof name === 'string' && name !== '' && typeof check === 'function'
      ? { name, indicator: instance as IHealthIndicator }
      : undefined
  } catch (cause) {
    throw bootError(
      '[BymaxCoreModule] a provider marked @BymaxHealthIndicator() could not be read',
      { provider: label },
      { cause: asHostError(cause) }
    )
  }
}

/**
 * An indicator's name, read once: a failure of reading it, or a value that is not a non-empty
 * string, is refused as a boot error, so what is sorted and compared afterwards cannot change.
 *
 * @param indicator - The indicator to read.
 * @throws Error When reading the name throws, or it is not a non-empty string.
 */
function nameOf(indicator: IHealthIndicator): string {
  let name: unknown
  try {
    name = indicator.name
  } catch (cause) {
    throw bootError(
      '[BymaxCoreModule] a health indicator name could not be read',
      {},
      {
        cause: asHostError(cause)
      }
    )
  }
  if (typeof name !== 'string' || name === '') {
    throw bootError('[BymaxCoreModule] a health indicator name must be a non-empty string', {})
  }
  return name
}

/** An indicator with the name it was read under, which is the name every later use serves. */
export interface NamedIndicator {
  readonly name: string
  readonly indicator: IHealthIndicator
}

/**
 * Read the name of each indicator once.
 *
 * @param indicators - The indicators to name.
 * @returns Each indicator with its name, in the order given.
 * @throws Error When a name cannot be read or is not a non-empty string.
 */
export function nameIndicators(indicators: readonly IHealthIndicator[]): readonly NamedIndicator[] {
  return indicators.map((indicator) => ({ name: nameOf(indicator), indicator }))
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
 * @returns The discovered indicators with their names, ordered by name.
 * @throws Error When a marked provider does not implement `IHealthIndicator`.
 */
export function discoverIndicators(
  discovery: ProviderScanner,
  reflector: Reflector
): readonly NamedIndicator[] {
  const named: NamedIndicator[] = []
  for (const marked of findMarkedProviders(discovery, reflector, BYMAX_HEALTH_INDICATOR_METADATA)) {
    const found = readIndicator(marked.instance, marked.label)
    if (found === undefined) {
      throw bootError(
        '[BymaxCoreModule] a provider marked @BymaxHealthIndicator() does not implement ' +
          'IHealthIndicator: it must expose a non-empty "name" and a "check" method.',
        { provider: marked.label }
      )
    }
    named.push(found)
  }
  return named.sort((left, right) => left.name.localeCompare(right.name))
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
 * @param discovered - Indicators found by {@link discoverIndicators}, with the names they were read under.
 * @returns The full readiness set with each name, explicit entries first.
 */
export function mergeIndicators(
  explicit: readonly IHealthIndicator[],
  discovered: readonly NamedIndicator[]
): readonly NamedIndicator[] {
  const registered = nameIndicators(explicit)
  const claimed = new Set(registered.map((entry) => entry.name))
  return [...registered, ...discovered.filter((entry) => !claimed.has(entry.name))]
}
