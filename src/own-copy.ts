/**
 * @fileoverview An own copy of what a host hands over, taken where a throw from the host can be
 * attributed, so nothing read from the copy afterwards runs host code.
 * @layer Utility
 */

/** How deep a value is copied before it is refused as a cycle in all but name. */
const MAX_DEPTH = 64

/**
 * An own copy of the plain objects and lists in `value`, at every depth, so nothing read from the
 * copy runs host code. Anything else (a number, a string, a `Date`, a function) is kept as it is.
 *
 * @param value - What the host handed over.
 * @param depth - How deep the copy is; callers leave it at its start.
 * @param open - The objects being copied above this one, to tell a cycle from a shared object.
 * @returns The copy.
 * @throws RangeError When `value` holds itself or is deeper than {@link MAX_DEPTH}.
 */
export function ownCopy(value: unknown, depth = 0, open: readonly object[] = []): unknown {
  if (typeof value !== 'object' || value === null) return value
  if (depth > MAX_DEPTH || open.includes(value)) {
    throw new RangeError('A value holds itself or is nested too deeply')
  }
  const prototype = Object.getPrototypeOf(value) as unknown
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return value
  const inside = [...open, value]
  return Array.isArray(value)
    ? value.map((item) => ownCopy(item, depth + 1, inside))
    : Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, ownCopy(item, depth + 1, inside)])
      )
}
