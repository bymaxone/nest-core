/**
 * @fileoverview The one read of the `Symbol.toStringTag` of a host's object: whatever it answered the
 * first time is what every later check sees.
 * @layer Utility
 */

/** The tag each object answered when it was first asked. */
const answered = new WeakMap<object, string>()

/**
 * `Object.prototype.toString` of `value`, read once per object. A tag is a getter a host can make
 * answer differently on a second read, so a value refused as not plain must stay refused, and one
 * accepted must stay accepted, whichever check reads it next.
 *
 * @param value - Any value.
 * @returns The `[object Tag]` text it answered the first time.
 */
export function tagOf(value: unknown): string {
  if (typeof value !== 'object' || value === null) return Object.prototype.toString.call(value)
  const known = answered.get(value)
  if (known !== undefined) return known
  const tag = Object.prototype.toString.call(value)
  answered.set(value, tag)
  return tag
}
