/**
 * @fileoverview An own copy of what a host hands over, taken where a throw from the host can be
 * attributed, so nothing read from the copy afterwards runs host code.
 * @layer Utility
 */
import { types } from 'node:util'

/** The longest list copied: a proxy can answer any length. */
const MAX_LENGTH = 100_000

/** The most work one copy does, whatever the shape of what it copies. */
const MAX_WORK = 1_000_000

/** How deep a value is copied before it is refused as a cycle in all but name. */
const MAX_DEPTH = 64

/** The work a copy may still do, for each `done`: every list item and every key counts one. */
const budgets = new WeakMap<Map<object, unknown>, { left: number }>()

/** Counts `units` of work against the copy that `done` belongs to, refusing it past the limit. */
function spend(done: Map<object, unknown>, units: number): void {
  const budget = budgets.get(done) ?? { left: MAX_WORK }
  budgets.set(done, budget)
  budget.left -= units
  if (budget.left < 0) throw new RangeError('A value is too large')
}

/** The copies that were made of a proxy, so a copy of one is still judged as one. */
const proxies = new WeakSet<object>()

/** The copies made under the refusal, apart from the ones made without it, for each `done`. */
const strictCaches = new WeakMap<Map<object, unknown>, Map<object, unknown>>()

/** The map of copies made under the refusal that goes with `done`. */
function strictCache(done: Map<object, unknown>): Map<object, unknown> {
  const found = strictCaches.get(done) ?? new Map<object, unknown>()
  strictCaches.set(done, found)
  return found
}

/**
 * A plain list built by index, not by `map`, which would build what the list's species names. A real
 * list has an integer length from 0 up; anything else is a proxy, and a list it gives out as empty
 * would read as no security at all.
 */
function copyList(
  value: readonly unknown[],
  depth: number,
  inside: readonly object[],
  done: Map<object, unknown>,
  strict: boolean
): unknown[] {
  const items: unknown[] = []
  const length = value.length as unknown
  if (!Number.isInteger(length) || (length as number) < 0 || (length as number) > MAX_LENGTH) {
    throw new RangeError('A list is too long')
  }
  const count = length as number
  spend(done, count)
  for (let index = 0; index < count; index += 1) {
    items.push(ownCopy(Reflect.get(value, index), depth + 1, inside, done, strict))
  }
  return items
}

/**
 * The own properties of `value` copied, enumerable or not and every one enumerable in the copy, so the
 * copy is seen whole by `Object.keys`. Defined, not assigned, so a key such as `__proto__` stays an own
 * property.
 */
function copyProperties(
  value: object,
  depth: number,
  inside: readonly object[],
  done: Map<object, unknown>,
  strict: boolean
): Record<PropertyKey, unknown> {
  const copy: Record<PropertyKey, unknown> = {}
  const keys = Reflect.ownKeys(value)
  spend(done, keys.length)
  for (const key of keys) {
    // A name a proxy lists but holds no property under is refused, not dropped.
    if (Reflect.getOwnPropertyDescriptor(value, key) === undefined) {
      throw new RangeError('A proxy lists a name it holds no property under')
    }
    const held: unknown = Reflect.get(value, key)
    Object.defineProperty(copy, key, {
      value: ownCopy(
        held,
        depth + 1,
        inside,
        done,
        strict || (key === 'security' && Array.isArray(held))
      ),
      enumerable: true,
      writable: true,
      configurable: true
    })
  }
  return copy
}

/**
 * A copy already made of `value`, if any. One snapshot of the host object serves both kinds of copy: a
 * copy made without the refusal is judged again, as data, where the refusal applies, and one made under
 * it serves where it does not. So the host is read once, whatever order a shared object is reached in.
 */
function reuse(
  value: object,
  depth: number,
  open: readonly object[],
  done: Map<object, unknown>,
  strict: boolean
): unknown {
  const made = (strict ? strictCache(done) : done).get(value)
  if (made !== undefined) return made
  const other = strict ? done.get(value) : strictCache(done).get(value)
  return strict ? ownCopy(other, depth, open, done, true) : other
}

/**
 * Refuses the copy of a proxy that lists no keys, where the copy is strict: it reads as `{}`, and an empty
 * requirement is anonymous access.
 */
function judge(value: object, copy: object, depth: number, strict: boolean): void {
  const proxied = types.isProxy(value)
  if (proxied) proxies.add(copy)
  if (strict && depth > 0 && (proxied || proxies.has(value)) && Object.keys(copy).length === 0) {
    throw new RangeError('A proxy lists no keys')
  }
}

/**
 * An own copy of the plain objects and lists in `value`, at every depth, with every own property of an object (a non-enumerable one included, made enumerable), so nothing read from the
 * copy runs host code. Anything else (a number, a string, a `Date`, a function) is kept as it is.
 *
 * @param value - What the host handed over.
 * @param depth - How deep the copy is; callers leave it at its start.
 * @param open - The objects being copied above this one, to tell a cycle from a shared object.
 * @param done - The copies already made in this call, so an object reached twice is copied once
 *   and the copy is shared as the original was.
 * @param strict - Whether a proxy below the root that lists no keys is refused instead of copied as `{}`; it
 *   holds for the items of a `security` list, where an empty requirement is anonymous access.
 * @returns The copy.
 * @throws RangeError When `value` holds itself, is deeper than {@link MAX_DEPTH}, holds a list that is
 *   too long or more than {@link MAX_WORK} values, or, if `strict`, holds a proxy that lists no keys or
 *   an object that is not plain.
 */
export function ownCopy(
  value: unknown,
  depth = 0,
  open: readonly object[] = [],
  done: Map<object, unknown> = new Map(),
  strict = false
): unknown {
  if (typeof value !== 'object' || value === null) {
    // Where the copy is strict, nothing that cannot be cloned is kept: a method (a `toJSON` among them)
    // would change what the document serializes after the checks passed.
    if (strict && depth > 0 && (typeof value === 'function' || typeof value === 'symbol')) {
      throw new RangeError('A requirement must be plain data')
    }
    return value
  }
  if (depth > MAX_DEPTH || open.includes(value)) {
    throw new RangeError('A value holds itself or is nested too deeply')
  }
  // A proxy is never handed back as itself, whatever prototype it answers: it is copied like a plain
  // object, so what is judged and kept is the copy and not a value that can answer differently later.
  if (!types.isProxy(value) && !Array.isArray(value)) {
    const prototype = Object.getPrototypeOf(value) as unknown
    if (prototype !== Object.prototype && prototype !== null) {
      // Where the copy is strict, nothing is kept by reference: an object that is not plain could answer
      // differently to the check and to the document, whatever its tag says.
      if (strict) throw new RangeError('A requirement must be a plain object')
      return value
    }
  }
  const reused = reuse(value, depth, open, done, strict)
  if (reused !== undefined) return reused
  const cache = strict ? strictCache(done) : done
  const inside = [...open, value]
  if (Array.isArray(value)) {
    const items = copyList(value, depth, inside, done, strict)
    cache.set(value, items)
    return items
  }
  const copy = copyProperties(value, depth, inside, done, strict)
  // The copy is judged: a proxy inside an option that lists no keys reads as `{}`, and an empty
  // requirement is anonymous access.
  judge(value, copy, depth, strict)
  cache.set(value, copy)
  return copy
}
