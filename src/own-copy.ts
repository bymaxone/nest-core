/**
 * @fileoverview An own copy of what a host hands over, taken where a throw from the host can be
 * attributed, so nothing read from the copy afterwards runs host code.
 * @layer Utility
 */
import { types } from 'node:util'

/** How deep a value is copied before it is refused as a cycle in all but name. */
const MAX_DEPTH = 64

/** The copies made under the refusal, apart from the ones made without it, for each `done`. */
const strictCaches = new WeakMap<Map<object, unknown>, Map<object, unknown>>()

/** The map of copies made under the refusal that goes with `done`. */
function strictCache(done: Map<object, unknown>): Map<object, unknown> {
  const found = strictCaches.get(done) ?? new Map<object, unknown>()
  strictCaches.set(done, found)
  return found
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
 *   holds under a `security` or `securitySchemes` key, where an empty requirement is anonymous access.
 * @returns The copy.
 * @throws RangeError When `value` holds itself or is deeper than {@link MAX_DEPTH}, or, if `strict`, holds
 *   a proxy that lists no keys.
 */
export function ownCopy(
  value: unknown,
  depth = 0,
  open: readonly object[] = [],
  done: Map<object, unknown> = new Map(),
  strict = false
): unknown {
  if (typeof value !== 'object' || value === null) return value
  if (depth > MAX_DEPTH || open.includes(value)) {
    throw new RangeError('A value holds itself or is nested too deeply')
  }
  const prototype = Object.getPrototypeOf(value) as unknown
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return value
  // A copy made without the refusal is not reused where it applies, so the order a shared object is
  // reached in cannot decide whether it is refused.
  const cache = strict ? strictCache(done) : done
  const made = cache.get(value)
  if (made !== undefined) return made
  const inside = [...open, value]
  if (Array.isArray(value)) {
    const items = value.map((item) => ownCopy(item, depth + 1, inside, done, strict))
    cache.set(value, items)
    return items
  }
  // Every own property, enumerable or not, and every one enumerable in the copy, so the copy is seen
  // whole by `Object.keys`. Defined, not assigned, so a key such as `__proto__` stays an own property.
  const copy: Record<PropertyKey, unknown> = {}
  for (const key of Reflect.ownKeys(value)) {
    // A name a proxy lists but holds no property under is not copied.
    if (Reflect.getOwnPropertyDescriptor(value, key) === undefined) continue
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
  // The copy is judged: a proxy inside an option that lists no keys reads as `{}`, and an empty
  // requirement is anonymous access.
  if (strict && depth > 0 && types.isProxy(value) && Reflect.ownKeys(copy).length === 0) {
    throw new RangeError('A proxy lists no keys')
  }
  cache.set(value, copy)
  return copy
}
