/**
 * @fileoverview The refusal to boot beside a realm whose `Object.prototype` holds a name it does not
 * hold by default, or holds a default one changed.
 * @layer Utility
 */
import { bootError } from './boot-error'

/** The string keys `Object.prototype` holds in every realm, by their names. */
const STANDARD = new Set([
  'constructor',
  '__defineGetter__',
  '__defineSetter__',
  'hasOwnProperty',
  '__lookupGetter__',
  '__lookupSetter__',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toString',
  'valueOf',
  '__proto__',
  'toLocaleString'
])

/** Each standard name with the descriptor it had when this module loaded. */
const SNAPSHOT: ReadonlyArray<readonly [string, PropertyDescriptor | undefined]> = [
  ...STANDARD
].map((name) => [name, Object.getOwnPropertyDescriptor(Object.prototype, name)])

/** Whether two descriptors describe the same property, down to the functions or value they hold. */
function same(
  left: PropertyDescriptor | undefined,
  right: PropertyDescriptor | undefined
): boolean {
  return (
    left?.value === right?.value &&
    left?.get === right?.get &&
    left?.set === right?.set &&
    left?.writable === right?.writable &&
    left?.enumerable === right?.enumerable &&
    left?.configurable === right?.configurable
  )
}

/**
 * Throws while `Object.prototype` of this realm holds a string key outside the standard ones, or one of
 * the standard ones was replaced. Whatever sits there is inherited by every plain object a dependency
 * reads a name from, and no option can shadow it, so nothing the package serves can be trusted beside it.
 *
 * @throws Error With the number of names or changes, and nothing the host wrote.
 */
export function assertObjectPrototypeClean(): void {
  const names = Object.getOwnPropertyNames(Object.prototype)
  const found =
    names.filter((name) => !STANDARD.has(name)).length +
    SNAPSHOT.filter(
      ([name, was]) => !same(was, Object.getOwnPropertyDescriptor(Object.prototype, name))
    ).length
  if (found > 0) {
    throw bootError('Object.prototype holds names or changes this package cannot run beside', {
      count: found
    })
  }
}
