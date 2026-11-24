/**
 * @fileoverview The refusal to boot beside a realm whose `Object.prototype` holds a name a fresh realm's
 * does not hold, or holds one of them changed.
 * Its own answers come from built-ins captured at load. It also watches the collection, string, regular
 * expression and iterator methods the decision paths of this package call (a listed origin, an
 * excluded path, a declared scheme); a path that decides on one of them calls `builtinsAltered` first and
 * refuses when it answers `true`. A built-in not in that list is not watched.
 * @layer Utility
 */
import { runInNewContext } from 'node:vm'

/** A fresh realm's `Object.prototype` descriptors and its own `Function.prototype.toString`. */
interface Pristine {
  readonly descriptors: Readonly<Record<string, PropertyDescriptor>>
  readonly sourceOf: (value: unknown) => string
}

// Captured at load: nothing below reads `Object`, `Reflect`, `Array` or `Error` again.
const ObjectBinding = Object
const ReflectBinding = Reflect
const ArrayBinding = Array
const JsonBinding = JSON
const ErrorConstructor = Error
const FunctionPrototype = Function.prototype
const PromisePrototype = Promise.prototype
const PromiseConstructor = Promise.prototype.constructor
const ObjectPrototype = Object.prototype
const hasOwn = Object.hasOwn
const defineProperty = Object.defineProperty
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor
const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors
const getOwnPropertyNames = Object.getOwnPropertyNames
const getPrototypeOf = Object.getPrototypeOf
const buildRealm = runInNewContext

/** `Function.prototype`'s call, apply and bind, as they were at load. */
const CALL = getOwnPropertyDescriptor(FunctionPrototype, 'call')?.value
const APPLY = getOwnPropertyDescriptor(FunctionPrototype, 'apply')?.value
const BIND = getOwnPropertyDescriptor(FunctionPrototype, 'bind')?.value

/** `Object.prototype` as it was at load, so a name swapped for a function of the same text is caught by identity. */
const loaded = getOwnPropertyDescriptors(ObjectPrototype) as Record<string, PropertyDescriptor>

type Watched = ReadonlyArray<readonly [object, readonly PropertyKey[], unknown[]]>

/** The built-ins the decision paths call, each with the function it was at load: `[owner, names, values]`. */
const WATCHED: Watched = ((): Watched => {
  const proto = (iterator: object): object => getPrototypeOf(iterator)
  return (
    [
      [Set.prototype, ['has', Symbol.iterator]],
      [Map.prototype, ['get', 'has']],
      [String.prototype, ['split', 'indexOf', 'slice', 'replace']],
      [Array.prototype, ['join', 'slice', 'filter', 'includes', Symbol.iterator]],
      [RegExp.prototype, [Symbol.replace]],
      [proto([][Symbol.iterator]()), ['next']],
      [proto(new Set().values()), ['next']],
      [Promise.prototype, ['constructor']]
    ] as ReadonlyArray<readonly [object, readonly PropertyKey[]]>
  ).map(([owner, names]) => [
    owner,
    names,
    names.map((name) => getOwnPropertyDescriptor(owner, name)?.value)
  ])
})()

let pristine: Pristine | undefined

/**
 * A fresh realm's `Object.prototype`, read once, or `undefined` when it cannot be built: `vm` reads its
 * options with inheritance, so a planted `timeout` or `microtaskMode` makes it throw, quoting the value.
 */
function standard(): Pristine | undefined {
  try {
    pristine ??= buildRealm(
      '({ descriptors: Object.getOwnPropertyDescriptors(Object.prototype), ' +
        'sourceOf: (value) => Function.prototype.toString.call(value) })'
    ) as Pristine
  } catch {
    // Left unset: the guard refuses.
  }
  return pristine
}

/** The refusal: a count and nothing a host wrote. Its descriptor has no prototype, so a planted `get` is not read. */
function refusal(count: number): Error {
  const error = new ErrorConstructor(
    'Object.prototype holds names or changes this package cannot run beside'
  )
  defineProperty(error, 'count', {
    __proto__: null,
    value: count,
    enumerable: true,
    writable: true,
    configurable: true
  } as PropertyDescriptor)
  return error
}

/** A field of a descriptor as its own property only: a name planted on `Object.prototype` must never run. */
function field(descriptor: PropertyDescriptor | undefined, key: keyof PropertyDescriptor): unknown {
  return descriptor !== undefined && hasOwn(descriptor, key) ? descriptor[key] : undefined
}

/** Whether a function of `now` has the text of the one of `was`; where `was` holds none, `now` needs none. */
function alike(now: unknown, was: unknown, sourceOf: Pristine['sourceOf']): boolean {
  return typeof was !== 'function' || (typeof now === 'function' && sourceOf(now) === sourceOf(was))
}

/** Whether `Function.prototype[name]` is no longer the function captured at load. */
function moved(name: string, captured: unknown): boolean {
  return field(getOwnPropertyDescriptor(FunctionPrototype, name), 'value') !== captured
}

/** How many of the bindings and functions this module relies on are not the ones it captured. */
function replacedBindings(): number {
  const global = globalThis as unknown as Record<string, unknown>
  let replaced = 0
  if (global['Object'] !== ObjectBinding) replaced += 1
  if (global['Reflect'] !== ReflectBinding) replaced += 1
  if (global['Array'] !== ArrayBinding) replaced += 1
  if (global['JSON'] !== JsonBinding) replaced += 1
  if (moved('call', CALL)) replaced += 1
  if (moved('apply', APPLY)) replaced += 1
  if (moved('bind', BIND)) replaced += 1
  for (let index = 0; index < WATCHED.length; index += 1) {
    const entry = WATCHED[index] as (typeof WATCHED)[number]
    const owner = entry[0]
    const names = entry[1]
    const captured = entry[2]
    for (let at = 0; at < names.length; at += 1) {
      const key = names[at] as PropertyKey
      if (field(getOwnPropertyDescriptor(owner, key), 'value') !== captured[at]) replaced += 1
    }
  }
  return replaced
}

/**
 * Whether a built-in a decision path of this package calls was replaced since load,. Cheap enough for every request; a caller that answers `true` must refuse.
 */
export function builtinsAltered(): boolean {
  return replacedBindings() > 0
}

/** Whether `Promise.prototype.constructor` is not the one captured at load; `await` reads it. */
export function promiseAltered(): boolean {
  return (
    field(getOwnPropertyDescriptor(PromisePrototype, 'constructor'), 'value') !== PromiseConstructor
  )
}

/** Whether `name` of `now` is as a fresh realm holds it, and the function this module met. */
function same(
  name: string,
  now: Record<string, PropertyDescriptor>,
  descriptors: Record<string, PropertyDescriptor>,
  sourceOf: Pristine['sourceOf']
): boolean {
  const have = hasOwn(now, name) ? now[name] : undefined
  const want = hasOwn(descriptors, name) ? descriptors[name] : undefined
  return (
    // Only `enumerable` is compared as a flag: a frozen realm is tighter, and no standard name is looser.
    field(have, 'enumerable') === field(want, 'enumerable') &&
    alike(field(have, 'value'), field(want, 'value'), sourceOf) &&
    alike(field(have, 'get'), field(want, 'get'), sourceOf) &&
    alike(field(have, 'set'), field(want, 'set'), sourceOf) &&
    (!hasOwn(loaded, name) ||
      (field(have, 'value') === field(loaded[name], 'value') &&
        field(have, 'get') === field(loaded[name], 'get') &&
        field(have, 'set') === field(loaded[name], 'set')))
  )
}

/**
 * Throws while this realm's `Object.prototype` holds a string key a fresh realm's does not, lacks one it
 * does, or holds one changed (a flag, or a function whose text is not the engine's), or while a built-in
 * this module relies on was replaced: every plain object a dependency reads inherits from it.
 *
 * @throws Error With a count, and nothing the host wrote.
 */
export function assertObjectPrototypeClean(): void {
  const fresh = standard()
  if (fresh === undefined) throw refusal(1)
  const { descriptors, sourceOf } = fresh
  const now = getOwnPropertyDescriptors(ObjectPrototype) as Record<string, PropertyDescriptor>
  let found = replacedBindings()
  const mine = getOwnPropertyNames(now)
  for (let index = 0; index < mine.length; index += 1) {
    if (!same(mine[index] as string, now, descriptors, sourceOf)) found += 1
  }
  const theirs = getOwnPropertyNames(descriptors)
  for (let index = 0; index < theirs.length; index += 1) {
    const name = theirs[index] as string
    if (!hasOwn(now, name) && !same(name, now, descriptors, sourceOf)) found += 1
  }
  if (found > 0) throw refusal(found)
}
