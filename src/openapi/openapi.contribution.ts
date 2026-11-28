/**
 * @fileoverview Collecting what the libraries in an application contribute to
 * the document, and translating it into terms the merge understands.
 *
 * Two translations happen here, and neither belongs in the pure merge module.
 * The first is discovery: reading Nest's provider graph for marked classes,
 * which needs the container. The second is addressing: a contributor writes
 * `'AuthController.login'`, while the generated document identifies that
 * operation by whatever id the scan produced. This module holds the map between
 * them, so the merge stays data-in, data-out and never learns what a controller
 * is.
 *
 * Nothing here loads `@nestjs/swagger`. The map is built from the operation-id
 * factory the bootstrap installs, which the peer calls; this module only records
 * what it is told.
 * @layer Service
 */
import type { Reflector } from '@nestjs/core'

import { bootError } from '../boot-error'
import { findMarkedProviders } from '../discovery'
import type { ProviderScanner } from '../discovery'
import { asHostError, describeUnreadable } from '../host-error'
import { copiedFromProxy, ownCopy } from '../own-copy'
import {
  BYMAX_OPENAPI_CONTRACT_VERSION,
  BYMAX_OPENAPI_CONTRIBUTOR_METADATA
} from './openapi.contract'
import type { IOpenApiContributor, OpenApiFragmentObject } from './openapi.contract'

/**
 * One contributor's fragments, with its handler keys already resolved to the
 * operation ids the document uses.
 */
export interface ResolvedContribution {
  /** The contributing class, named in any error this contribution causes. */
  readonly label: string
  /** Operation fragments, keyed by the operation id the scan produced. */
  readonly operations: Readonly<Record<string, OpenApiFragmentObject>>
  /** Component entries, keyed by member and then by name. */
  readonly components: Readonly<Record<string, Readonly<Record<string, OpenApiFragmentObject>>>>
}

/**
 * Records the operation id the peer assigns to each route handler.
 *
 * The peer asks a factory for that id, so installing one is the only way to
 * learn the mapping without re-deriving it — and the factory this package
 * installs delegates the id string rather than choosing it, so nothing an
 * existing consumer generates changes.
 */
export interface HandlerIdMap {
  /**
   * Record the id assigned to one handler, for one version.
   *
   * @throws Error When the same handler and version is recorded twice, which
   *   means two controller classes in the application share a name.
   */
  record(controllerKey: string, methodKey: string, version: string | undefined, id: string): void
  /**
   * Every id assigned to a handler key — more than one when the application
   * serves that route under several URI versions.
   */
  idsFor(handlerKey: string): readonly string[]
  /** Every handler key seen, for an error that has to say what does exist. */
  keys(): readonly string[]
}

/**
 * Build an empty map to be filled as the peer requests operation ids.
 *
 * @returns The recorder and its reader.
 */
export function createHandlerIdMap(): HandlerIdMap {
  const ids = new Map<string, string[]>()
  // Versions tracked per handler in a `Set`, which holds `undefined` as a value
  // like any other — a composite string key would need a separator that no
  // version can contain, and inventing one is a rule with no way to observe it
  // being wrong.
  const versions = new Map<string, Set<string | undefined>>()
  return {
    record: (controllerKey, methodKey, version, id): void => {
      const handlerKey = `${controllerKey}.${methodKey}`
      // A handler legitimately produces one operation per URI version, so the
      // same key recording twice is only a collision when the version repeats.
      // Two controller classes sharing a name is the case that reaches here,
      // and it is unresolvable rather than merely awkward: the key addresses
      // both, so a fragment for one would document the other too.
      const seen = versions.get(handlerKey) ?? new Set<string | undefined>()
      if (seen.has(version)) {
        throw bootError(
          '[BymaxCoreModule] two route handlers in this application answer to the same handler ' +
            'key, so an OpenAPI fragment addressing it would apply to both. Handler keys are ' +
            '"<ControllerClassName>.<methodName>"; rename one of the controller classes.',
          { handlerKey }
        )
      }
      seen.add(version)
      versions.set(handlerKey, seen)
      ids.set(handlerKey, [...(ids.get(handlerKey) ?? []), id])
    },
    idsFor: (handlerKey) => ids.get(handlerKey) ?? [],
    keys: () => [...ids.keys()]
  }
}

/**
 * Decide whether a marked provider actually implements the contract.
 *
 * Checked structurally rather than with `instanceof`: a library implements the
 * interface, it does not extend a class of ours, and requiring it to would make
 * the contract a runtime dependency instead of a shape.
 *
 * @param instance - The resolved provider instance.
 * @returns Whether it can be called as a contributor.
 */
function isContributor(instance: unknown): instance is IOpenApiContributor {
  // Optional chaining rather than a type-and-null guard: reading a property off
  // a primitive is safe and yields `undefined`, so the only values needing
  // protection are `null` and `undefined`, and `?.` covers both in the
  // expression that has to run anyway. One expression, no branch that some
  // input cannot distinguish.
  return typeof (instance as Partial<IOpenApiContributor> | null)?.contributeOpenApi === 'function'
}

/** A fragment as read once: the version, the operations as entries, and the components. */
interface ReadFragment {
  readonly contractVersion: unknown
  readonly operations: readonly (readonly [string, OpenApiFragmentObject])[]
  readonly components: ResolvedContribution['components']
}

/**
 * A component section as an own copy of its entries, taken under the caller's guard whatever the
 * section is: a class instance is kept as given by `ownCopy`, and its getters must still run here.
 * Anything but an object offers no entries.
 */
function copySection(section: unknown): Readonly<Record<string, OpenApiFragmentObject>> {
  return typeof section === 'object' && section !== null
    ? (ownCopy(Object.fromEntries(Object.entries(section))) as Record<
        string,
        OpenApiFragmentObject
      >)
    : {}
}

/** `value` when it is a plain record of what was copied, or a throw: a refusal is the contributor's failure. */
function plainRecord<T>(value: T): T {
  const prototype = Object.getPrototypeOf(value) as unknown
  if (
    typeof value !== 'object' ||
    value === null ||
    (prototype !== Object.prototype && prototype !== null) ||
    copiedFromProxy(value)
  ) {
    throw new RangeError('An OpenAPI fragment must be a plain object')
  }
  return value
}

/**
 * Ask one contributor for its fragments, failing with its name if it cannot.
 *
 * A contributor that throws fails the document build rather than being skipped:
 * a library that meant to describe its routes and could not is a defect, and
 * swallowing it would produce a document missing exactly the operations someone
 * took the trouble to describe.
 *
 * @param contributor - The provider instance.
 * @param label - How to name it in an error.
 * @returns The fragment it produced.
 * @throws Error When the contributor throws, with its name as `contributor` and what it threw as the cause.
 */
function callContributor(contributor: IOpenApiContributor, label: string): ReadFragment {
  try {
    // Read and copied here, inside the guard, at every depth: a fragment that is not an object, a
    // getter that throws and a proxy that throws or is revoked, anywhere in it, are a contributor's
    // failure like a throw from the method.
    const given = contributor.contributeOpenApi()
    const copied = ownCopy({
      operations: given.operations ?? {},
      components: given.components ?? {}
    }) as { operations: Record<string, OpenApiFragmentObject>; components: Record<string, unknown> }
    // A map that is not plain, one a proxy gave out as empty, and an operation like either, would read as
    // no operation or no security, so they are refused, not served.
    const operations = plainRecord(copied.operations)
    Object.values(operations).forEach(plainRecord)
    const { components } = copied
    return {
      // Left as given: the version is described and never copied, so the error that names a
      // version this package does not speak keeps the declared value as its cause.
      contractVersion: given.contractVersion,
      operations: Object.entries(operations),
      components: Object.fromEntries(
        Object.entries(components).map(([member, entries]) => [member, copySection(entries)])
      ) as ReadFragment['components']
    }
  } catch (cause) {
    throw bootError(
      '[BymaxCoreModule] an OpenAPI contributor failed to contribute to the OpenAPI document',
      { contributor: label },
      { cause: asHostError(cause) }
    )
  }
}

/**
 * Reject a fragment written against a revision of the contract this package
 * does not speak.
 *
 * The check exists because compile-time types cannot make it: a library and the
 * application that installs it each type-check against their own copy of this
 * package, so a shape mismatch between them is invisible until the value
 * arrives. Failing loud names both revisions, which is the difference between
 * "upgrade the library" and an afternoon reading a document that came out
 * subtly wrong.
 *
 * @param fragment - What the contributor returned.
 * @param label - How to name the contributor in an error.
 * @throws Error When the fragment declares an unknown revision.
 */
function assertContractVersion(fragment: ReadFragment, label: string): void {
  if (fragment.contractVersion === BYMAX_OPENAPI_CONTRACT_VERSION) {
    return
  }
  const declared = describeUnreadable(fragment.contractVersion) ?? 'a value that cannot be read'
  throw bootError(
    '[BymaxCoreModule] an OpenAPI contributor contributed a fragment written against OpenAPI ' +
      `contract version ${declared}, and this package speaks version ` +
      `${String(BYMAX_OPENAPI_CONTRACT_VERSION)}. Upgrade whichever of the two is behind; the ` +
      'shapes are not interchangeable.',
    { contributor: label },
    { cause: asHostError(fragment.contractVersion) }
  )
}

/**
 * Resolve one fragment's handler keys into the operation ids the document uses.
 *
 * A key addressing a handler the application does not have is a configuration
 * error and fails the build, listing the handlers that do exist. Staying quiet
 * would leave a library's description silently unapplied — a check that stopped
 * running rather than one that failed, which is the harder failure to notice and
 * the easier one to introduce, since renaming a method is a refactor nobody
 * thinks of as a documentation change.
 *
 * @param fragment - What the contributor returned.
 * @param label - How to name the contributor in an error.
 * @param handlers - The handler-to-id map built during the scan.
 * @returns The operation fragments, keyed by operation id.
 * @throws Error When a key addresses no handler in the application.
 */
function resolveOperations(
  fragment: ReadFragment,
  label: string,
  handlers: HandlerIdMap
): Readonly<Record<string, OpenApiFragmentObject>> {
  const entries = fragment.operations
  const unmatched = entries.filter(([handlerKey]) => handlers.idsFor(handlerKey).length === 0)
  if (unmatched.length > 0) {
    const known = handlers.keys()
    throw bootError(
      `[BymaxCoreModule] an OpenAPI contributor contributed fragments for ${unmatched.length} ` +
        'handler(s) this application does not have. Keys are "<ControllerClassName>.<methodName>"; ' +
        'handlerKeys lists the ones it addressed and knownHandlers the ones the application has.',
      { contributor: label, handlerKeys: unmatched.map(([key]) => key), knownHandlers: known }
    )
  }

  // Expanded across every id the handler produced: under URI versioning the
  // same handler answers at `/v1/...` and `/v2/...`, and a fragment describing
  // it describes both. Resolving to one would leave the other undocumented.
  return Object.fromEntries(
    entries.flatMap(([handlerKey, operation]) =>
      handlers.idsFor(handlerKey).map((id) => [id, operation] as const)
    )
  )
}

/**
 * Collect every contribution in the application, resolved and ready to merge.
 *
 * Contributors run sorted by class name so a collision between two of them
 * resolves the same way on every boot; an order that depends on the container's
 * traversal would make one library win on Monday and the other on Tuesday.
 *
 * @param discovery - Nest's discovery service.
 * @param reflector - Nest's metadata reader.
 * @param handlers - The handler-to-id map built during the scan.
 * @returns One entry per contributor, in a stable order.
 * @throws Error When a marked provider is not a contributor, when one throws,
 *   when a fragment declares a contract revision this package does not speak, or
 *   when one addresses a handler the application does not have.
 */
export function collectContributions(
  discovery: ProviderScanner,
  reflector: Reflector,
  handlers: HandlerIdMap
): readonly ResolvedContribution[] {
  const marked = [...findMarkedProviders(discovery, reflector, BYMAX_OPENAPI_CONTRIBUTOR_METADATA)]
  // Two contributors sharing a class name would sort equal, leaving the winner
  // of any collision between them decided by the container's traversal order —
  // stable-looking until a refactor moves a provider. Unresolvable for the same
  // reason a duplicate handler key is: the label is the only identity a report
  // can name, so a duplicate is refused rather than ordered arbitrarily.
  const labels = marked.map(({ label }) => label)
  const duplicated = labels.filter((label, index) => labels.indexOf(label) !== index)
  if (duplicated.length > 0) {
    throw bootError(
      '[BymaxCoreModule] more than one OpenAPI contributor shares a class name, so the order ' +
        'they merge in would depend on the container rather than on anything stated. Rename one ' +
        'of the contributor classes; duplicates lists the names.',
      { duplicates: [...new Set(duplicated)] }
    )
  }
  marked.sort((left, right) => left.label.localeCompare(right.label))

  return marked.map(({ instance, label }) => {
    if (!isContributor(instance)) {
      throw bootError(
        '[BymaxCoreModule] a provider marked @BymaxOpenApiContributor() does not implement ' +
          'IOpenApiContributor: it must expose a "contributeOpenApi" method.',
        { contributor: label }
      )
    }
    const fragment = callContributor(instance, label)
    assertContractVersion(fragment, label)
    return {
      label,
      operations: resolveOperations(fragment, label, handlers),
      components: fragment.components
    }
  })
}
