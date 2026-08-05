/**
 * @fileoverview Marker-based provider discovery, shared by every feature that
 * lets a provider opt into something by declaring it.
 *
 * Two features use it — readiness indicators and metrics contributors — and both
 * need the same three things: read Nest's provider graph, keep the classes
 * carrying a given metadata key, and name the survivors well enough that an
 * error message points at something the reader can find.
 *
 * Metadata is read through `Reflector`, and every marker in this package uses a
 * literal key rather than one from `DiscoveryService.createDecorator()`. That
 * helper mints a random key each time the module holding it is loaded, and this
 * package ships several bundles: a library decorating a class through a subpath
 * would get a different key than the scan running from the package root, so
 * nothing would ever be discovered.
 * @layer Utility
 */
import type { Reflector } from '@nestjs/core'

/**
 * The part of a provider entry a scan reads. Declared structurally rather than
 * as Nest's `InstanceWrapper`, which lives behind a deep import and carries
 * private members: this way the contract is exactly what is used, and a test can
 * express a provider graph as plain objects.
 */
export interface ProviderNode {
  /** The provider's class, when it has one. */
  readonly metatype?: unknown
  /** The resolved instance. */
  readonly instance?: unknown
  /** The provider token, used to name a provider that has no class. */
  readonly name?: unknown
}

/** The part of `DiscoveryService` a scan needs. */
export interface ProviderScanner {
  /**
   * List every provider registered in the application.
   *
   * @returns The provider graph, one entry per registered provider.
   */
  getProviders(): readonly ProviderNode[]
}

/** A provider that carries a marker, with the identity to report it by. */
export interface MarkedProvider {
  /** The resolved instance, still unvalidated: each feature checks its own contract. */
  readonly instance: unknown
  /**
   * How to name this provider in an error: its class name, or its token when the
   * class is anonymous.
   */
  readonly label: string
}

/**
 * Name a provider using whatever identity the container has.
 *
 * @param className - The class's name, which an anonymous class expression
 *   leaves empty.
 * @param token - The provider token, which always identifies something.
 * @returns A human-readable identifier for an error message.
 */
function labelFor(className: string, token: unknown): string {
  return className === '' ? String(token) : className
}

/**
 * Collect every provider in the application carrying `metadataKey`.
 *
 * Providers with no class are skipped: `useValue` and `useFactory` bindings have
 * no metatype to carry metadata, so they can never be marked. The result keeps
 * the container's order; a caller that needs a stable order sorts by whatever
 * identity its own contract defines.
 *
 * @param discovery - Nest's discovery service, from `DiscoveryModule`.
 * @param reflector - Nest's metadata reader.
 * @param metadataKey - The marker key to match.
 * @returns Every marked provider, unvalidated.
 */
export function findMarkedProviders(
  discovery: ProviderScanner,
  reflector: Reflector,
  metadataKey: string
): readonly MarkedProvider[] {
  const marked: MarkedProvider[] = []
  for (const wrapper of discovery.getProviders()) {
    const metatype = wrapper.metatype
    if (typeof metatype !== 'function') {
      continue
    }
    if (reflector.get<boolean>(metadataKey, metatype) !== true) {
      continue
    }
    marked.push({ instance: wrapper.instance, label: labelFor(metatype.name, wrapper.name) })
  }
  return marked
}
