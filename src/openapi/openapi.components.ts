/**
 * @fileoverview Placing offered entries — this package's catalogue and every
 * library contribution — into a document's `components`, and reporting what a
 * contributor could not place.
 *
 * A module of its own because the rule here is not the document's rule: everywhere else the merge is "the existing side wins", and this is the
 * one place that asks whether the existing side says anything at all. Keeping
 * the question and its narrow carve-out together makes the exception legible as
 * an exception.
 * @layer internal
 */
import type { ResolvedContribution } from './openapi.contribution'
import { asRecord } from './openapi.shape'

/**
 * One component entry a contributor offered and the document already declared.
 *
 * Carries the contributor's label because a collision is only actionable if you
 * know who lost it: an application with several contributing libraries would
 * otherwise be told a name was dropped without being told whose it was.
 */
export interface DiscardedComponent {
  /** The contributing class, as {@link ResolvedContribution.label} names it. */
  readonly contributor: string
  /** The component member, such as `schemas` or `parameters`. */
  readonly member: string
  /** The entry's name within that member. */
  readonly name: string
}

/**
 * Whether this key is a `required` list that requires nothing.
 *
 * The peer emits `required: []` for a DTO whose members are all optional, so
 * treating the key's mere presence as a constraint would put every such schema
 * back in the case this carve-out exists to fix. A non-empty list is a real
 * constraint and is not ignorable.
 *
 * @param key - The schema key under test.
 * @param value - The value it carries.
 * @returns Whether the pair constrains nothing.
 */
function isEmptyRequired(key: string, value: unknown): boolean {
  return key === 'required' && Array.isArray(value) && value.length === 0
}

/**
 * The keys a schema may carry and still describe nothing.
 *
 * An allow-list rather than a list of constraining keywords, and the direction
 * matters: JSON Schema's vocabulary is open, so any enumeration of what
 * constrains is a list that is wrong later. Naming what is ignorable instead
 * makes an unrecognised keyword count as a declaration, which is the safe
 * default — the cost of being wrong that way is that a contribution is reported
 * as discarded, while the other way silently overwrites a real contract.
 *
 * Every member is a key whose loss is not silent: `type` and `properties` are
 * what the contributed schema replaces by definition, and `description` is
 * carried across by the merge. A key that would simply disappear does not
 * belong here: `title` is not carried across, so admitting it would drop a
 * consumer's title without a word.
 */
const IGNORABLE_KEYS = new Set(['type', 'properties', 'description'])

/**
 * Whether a schema occupies its name without describing a shape.
 *
 * Applies to the `schemas` member alone; the caller enforces that. Every other
 * component member has its own shape — a parameter carries `name` and `in`, not
 * `properties` — so this predicate would read them all as empty.
 *
 * The peer emits `{"type":"object","properties":{}}` for every DTO in a package
 * built without its plugin, so a schema name is never actually missing and a
 * contributed schema under that name would never be written — the same reason
 * the response merge in `openapi.document.ts` exists, arriving through a different
 * placeholder. A
 * schema in that state constrains nothing a validator could check, so filling
 * it in is additive rather than destructive.
 *
 * Deliberately narrow, and narrow by construction rather than by enumeration.
 * `type` must be absent or `object`, because `{"type":"string"}` carries no
 * properties and is nonetheless a complete declaration; treating it as empty
 * would discard a real schema, which is the failure this whole path exists to
 * avoid. Beyond that the entry may carry only keys that describe nothing — see
 * {@link IGNORABLE_KEYS} — so `required`, `minProperties`, `not`, `const` and
 * every keyword a later draft adds each make the entry a declaration without
 * this predicate needing to know what they mean.
 *
 * @param entry - The entry the document already declares under this name.
 * @returns Whether it may be replaced by a contributed entry.
 */
function describesNoShape(entry: Readonly<Record<string, unknown>>): boolean {
  const type = entry['type']
  if (type !== undefined && type !== 'object') {
    return false
  }
  // The key must be present, not merely empty. `{"type":"object"}` is the
  // OpenAPI idiom for an unconstrained object and `{}` for an unconstrained
  // value; both declare something deliberate and neither is what the peer
  // emits, which always writes `properties` explicitly. Reading an absent key
  // as an empty one would replace both — and, because the merge treats a
  // placeholder as vacant, replace them without reporting it.
  //
  // And it must be an object: `asRecord` reads `null`, an array or a scalar as
  // empty, which would let a malformed schema the document authored pass for
  // the placeholder and be overwritten unreported.
  const properties = entry['properties']
  if (!Object.hasOwn(entry, 'properties') || asRecord(properties) !== properties) {
    return false
  }
  if (Object.keys(asRecord(properties)).length > 0) {
    return false
  }
  // Walks the entry's own keys rather than reading the entry at each keyword: a
  // computed read on a plain object also answers for inherited members, so a
  // schema named `constructor` would report a key it does not carry.
  return Object.entries(entry).every(
    ([key, value]) => IGNORABLE_KEYS.has(key) || isEmptyRequired(key, value)
  )
}

/**
 * Place one member's offered entries beneath what that member already holds.
 *
 * The existing side wins, because whoever holds a name authored it on purpose
 * and an offer overwriting it is the worse defect wearing the other sign. What
 * a name occupied by a placeholder does not do is count as authorship; see
 * `describesNoShape`. The same rule serves this package's catalogue and every
 * contributor, so a placeholder yields to the first of them to offer a shape
 * and the precedence between them is the order of the calls.
 *
 * @param existing - The member as the document holds it so far.
 * @param member - The member's name, such as `schemas` or `parameters`.
 * @param offered - The entries offered for it; anything but an object offers
 *   none, so a JavaScript contributor's `null` member cannot stop the boot.
 * @param onKept - Told the name of every offered entry the existing side kept.
 * @returns The member with every placeable entry in it.
 */
export function placeComponentEntries(
  existing: unknown,
  member: string,
  offered: unknown,
  onKept: (name: string) => void
): Readonly<Record<string, unknown>> {
  // Read through a `Map`. `Object.entries` yields own enumerable keys only, so
  // an entry named `__proto__` or `constructor` cannot resolve to something the
  // document never declared — which a computed read on the plain record would do.
  const next = new Map(Object.entries(asRecord(existing)))
  for (const [name, contributed] of Object.entries(asRecord(offered))) {
    const declared = next.get(name)
    const held = asRecord(declared)
    // The placeholder carve-out is `schemas` only. It exists because the peer
    // emits an empty object schema per DTO, and no other member has an analogue
    // — a parameter carries `name` and `in` rather than `properties`, so a
    // predicate written for schemas reads every parameter as empty and would
    // let an offer overwrite one the consumer wrote.
    const replaceable = member === 'schemas' && describesNoShape(held)
    if (declared !== undefined && !replaceable) {
      onKept(name)
      continue
    }
    // A description the document authored survives being filled in: it is the
    // one part of a placeholder a consumer can have written, and the same
    // carve-out the response merge makes for the same reason.
    const described = held['description']
    next.set(
      name,
      described === undefined || described === ''
        ? contributed
        : { ...asRecord(contributed), description: described }
    )
  }
  return Object.fromEntries(next)
}

/**
 * Merge every contributor's components into the document's, in order.
 *
 * Every genuine collision is recorded rather than dropped in silence. A
 * contributor cannot observe that its entry lost, and a consumer cannot observe
 * that something was offered, so without this the failure is indistinguishable
 * from success at both ends.
 *
 * @param merged - The document's components, accumulated so far, with this
 *   package's catalogue already placed. Mutated in place: it is the same map
 *   the caller goes on to build the document from, and copying it here would
 *   leave two answers to the same question.
 * @param contributions - The contributions, in the order the collector fixed.
 * @returns Every entry a contributor offered that the document already declared
 *   with a shape of its own.
 */
export function mergeContributedComponents(
  merged: Map<string, unknown>,
  contributions: readonly ResolvedContribution[]
): readonly DiscardedComponent[] {
  const discarded: DiscardedComponent[] = []
  for (const contribution of contributions) {
    for (const [member, entries] of Object.entries(contribution.components)) {
      const placed = placeComponentEntries(merged.get(member), member, entries, (name) => {
        discarded.push({ contributor: contribution.label, member, name })
      })
      merged.set(member, placed)
    }
  }
  return discarded
}
