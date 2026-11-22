/**
 * @fileoverview The refusal to boot beside a realm whose `Object.prototype` holds a name a fresh realm's
 * does not hold, or holds one of them changed.
 * @layer Utility
 */
import { runInNewContext } from 'node:vm'

import { bootError } from './boot-error'

/** What a fresh realm holds: the descriptors of its `Object.prototype` and its own `Function.prototype.toString`. */
interface Pristine {
  readonly descriptors: Readonly<Record<string, PropertyDescriptor>>
  readonly sourceOf: (value: unknown) => string
}

/** What this realm's `Object.prototype` held when this module loaded: after that, a name swapped for another function of the same text is caught by identity. */
const loaded = Object.getOwnPropertyDescriptors(Object.prototype) as Record<
  string,
  PropertyDescriptor
>

let pristine: Pristine | undefined

/**
 * A fresh realm's `Object.prototype`, read once. Nothing a host did to this realm, before or after this
 * package loaded, reaches it, so it is the one standard to compare against, and the engine's own list of
 * names is not a list kept here.
 */
function standard(): Pristine {
  pristine ??= runInNewContext(
    '({ descriptors: Object.getOwnPropertyDescriptors(Object.prototype), ' +
      'sourceOf: (value) => Function.prototype.toString.call(value) })'
  ) as Pristine
  return pristine
}

/**
 * A field of a descriptor, as its own property only: a descriptor of this realm inherits from the
 * `Object.prototype` under test, so a name planted there (an accessor called `get`, say) must never run.
 */
function field(descriptor: PropertyDescriptor | undefined, key: keyof PropertyDescriptor): unknown {
  return descriptor !== undefined && Object.hasOwn(descriptor, key) ? descriptor[key] : undefined
}

/** Whether a value or accessor of `now` is the one of `was`: the same text for a function, else the same value. */
function alike(now: unknown, was: unknown, sourceOf: Pristine['sourceOf']): boolean {
  return typeof was === 'function'
    ? typeof now === 'function' && sourceOf(now) === sourceOf(was)
    : now === was
}

/**
 * Throws while `Object.prototype` of this realm holds a string key a fresh realm's does not, lacks one it
 * does, or holds one of them changed (its flags, or a function whose text is not the engine's). Whatever
 * sits there is inherited by every plain object a dependency reads a name from, and no option can shadow
 * it, so nothing the package serves can be trusted beside it.
 *
 * @throws Error With the number of names or changes, and nothing the host wrote.
 */
export function assertObjectPrototypeClean(): void {
  const { descriptors, sourceOf } = standard()
  const now = Object.getOwnPropertyDescriptors(Object.prototype) as Record<
    string,
    PropertyDescriptor
  >
  const names = new Set([
    ...Object.getOwnPropertyNames(now),
    ...Object.getOwnPropertyNames(descriptors)
  ])
  let found = 0
  for (const name of names) {
    const have = Object.hasOwn(now, name) ? now[name] : undefined
    const want = Object.hasOwn(descriptors, name) ? descriptors[name] : undefined
    const same =
      have !== undefined &&
      want !== undefined &&
      field(have, 'enumerable') === field(want, 'enumerable') &&
      // A flag tighter than the engine's (a frozen realm) is safe; a looser one is not.
      !(field(have, 'writable') && !field(want, 'writable')) &&
      !(field(have, 'configurable') && !field(want, 'configurable')) &&
      alike(field(have, 'value'), field(want, 'value'), sourceOf) &&
      alike(field(have, 'get'), field(want, 'get'), sourceOf) &&
      alike(field(have, 'set'), field(want, 'set'), sourceOf) &&
      // And it is the function this module met, not another native one put in its place.
      (!Object.hasOwn(loaded, name) ||
        (field(have, 'value') === field(loaded[name], 'value') &&
          field(have, 'get') === field(loaded[name], 'get') &&
          field(have, 'set') === field(loaded[name], 'set')))
    if (!same) found += 1
  }
  if (found > 0) {
    throw bootError('Object.prototype holds names or changes this package cannot run beside', {
      count: found
    })
  }
}
