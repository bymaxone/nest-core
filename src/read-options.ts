/**
 * @fileoverview Taking the options a host passes once, reading each documented option by its name,
 * where a throw from the host can be attributed.
 * @layer Configuration
 */
import { types } from 'node:util'

import { bootError } from './boot-error'
import { ownCopy } from './own-copy'

/**
 * What an options block documents: each key is an option, `0` for a value copied as it is (a number,
 * a string, a list or a map whose keys are the host's own data), a table for a block read by name,
 * and a one-item list holding a table for a list of such blocks. `1` is a map read by every name it
 * answers to, inherited accessors and non-enumerable properties included.
 */
export interface Shape {
  readonly [key: string]: Shape | readonly [Shape] | 0 | 1
}

/** Whether `value` is an object that holds settings, as `isPlainRecord` reads it, a class instance included. */
function isBlock(value: unknown): value is object {
  return Object.prototype.toString.call(value) === '[object Object]'
}

const MAX_NAMES = 1000

/** The options that hold security requirements, whose proxies that list no keys are refused. */
const SECURITY = new Set(['security', 'operationSecurity', 'securitySchemes'])

/** A list read once, by index, and not past the limit: its length first, then each item. */
function snapshot(list: readonly unknown[]): unknown[] {
  const length = Reflect.get(list, 'length') as number
  if (!(Number.isInteger(length) && length >= 0 && length <= MAX_NAMES)) {
    throw bootError('an option is too large', {})
  }
  const items: unknown[] = []
  for (let index = 0; index < length; index += 1) {
    // What `Array.prototype` holds at the index of a hole is not an item: a hole stays one.
    items.push(Object.hasOwn(list, index) ? Reflect.get(list, index) : undefined)
  }
  return items
}

/** A map read by every name it answers to, once. */
function namedCopy(value: unknown, done: Map<object, unknown>): unknown {
  if (!isBlock(value)) return ownCopy(value, 0, [], done)
  const copy: Record<string, unknown> = {}
  const names = new Set<string>()
  const add = (found: readonly PropertyKey[]): void => {
    for (const name of found) if (typeof name === 'string') names.add(name)
  }
  const own = Reflect.ownKeys(value)
  add(own)
  let links = 0
  for (
    let up = Reflect.getPrototypeOf(value);
    up && up !== Object.prototype;
    up = Reflect.getPrototypeOf(up)
  ) {
    // A proxy can answer its own prototype for ever.
    if (++links > MAX_NAMES) throw bootError('an option is too large', {})
    add(Reflect.ownKeys(up))
  }
  if (names.size > MAX_NAMES) throw bootError('an option is too large', {})
  for (const name of names) {
    const held: unknown = Reflect.get(value, name)
    // A method on a prototype is not a setting; one a directive holds itself is refused, not dropped.
    if (typeof held === 'function') {
      if (own.includes(name)) throw bootError('a directive holds a function', { option: name })
      continue
    }
    Object.defineProperty(copy, name, { value: ownCopy(held, 0, [], done), enumerable: true })
  }
  return copy
}

/** Whether `value` is a map with no keys, a copy of one that listed none. */
function isEmptyMap(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  )
}

/** One value of a block, read as its entry in the shape says. */
function readEntry(
  value: unknown,
  entry: Shape | readonly [Shape] | 0 | 1,
  strict: boolean,
  done: Map<object, unknown>
): unknown {
  if (entry === 1) return namedCopy(value, done)
  if (entry === 0) return ownCopy(value, 0, [], done, strict)
  if (Array.isArray(entry)) {
    const shape = entry[0] as Shape
    if (types.isProxy(value)) throw bootError('an option is held behind a proxy', {})
    return Array.isArray(value)
      ? snapshot(value).map((item) => readBlock(item, shape, done))
      : ownCopy(value, 0, [], done)
  }
  return readBlock(value, entry as Shape, done)
}

/**
 * What `given` holds under `key`, unless the first holder of the key is a root: an object with no
 * prototype that is not `given` itself, of any realm. Whatever a root holds is never read, however it is
 * held, so a proxy that forwards to it is not asked either. Any other name is asked as it always was,
 * a proxy included, which may hold it or answer it by itself.
 */
function heldBy(given: object, key: string): unknown {
  let holder: object | null = given
  for (let links = 0; holder !== null && !Object.hasOwn(holder, key); links += 1) {
    // A proxy can answer its own prototype for ever.
    if (links > MAX_NAMES) throw bootError('an option is too large', {})
    holder = Reflect.getPrototypeOf(holder)
  }
  const root = holder !== null && holder !== given && Reflect.getPrototypeOf(holder) === null
  return root ? undefined : Reflect.get(given, key)
}

/**
 * A block with each documented option read by name, wherever the host keeps it: an own property, a
 * getter, a class accessor or a proxy that answers only `get`. A key the shape does not document is
 * kept, with no value, so the block's own check can refuse it. Anything that is not a block comes
 * back as it is, for that check to refuse.
 */
function readBlock(given: unknown, shape: Shape, done: Map<object, unknown>): unknown {
  if (!isBlock(given)) return given
  // No prototype: the resolvers cannot inherit a planted name from the copy.
  const copy = Object.create(null) as Record<string, unknown>
  for (const key of Object.keys(shape)) {
    const entry = shape[key] as Shape | readonly [Shape] | 0 | 1
    const isMap = entry === 0 || entry === 1
    const strict = SECURITY.has(key)
    let value: unknown
    let made: unknown
    try {
      value = heldBy(given, key)
      if (value === undefined) continue
      // The items are read once, here, so the one checked is the one copied.
      // A requirement list is read once, by the strict copy itself, which refuses a proxy before any read.
      if (isMap && Array.isArray(value)) {
        if (!strict) value = snapshot(value)
        else if (!types.isProxy(value) && value.length > MAX_NAMES) {
          throw bootError('an option is too large', {})
        }
      }
      made = readEntry(value, entry, strict, done)
    } catch (cause) {
      // Whatever stops a security option from being copied (a getter of its own that throws, a refusal, a
      // list too long, a revoked proxy) names the option it came from.
      if (!strict) throw cause
      throw bootError(
        'an option holds what cannot be copied as plain data',
        { option: key },
        { cause }
      )
    }
    // The copy is judged, not the original: a proxy that lists no keys reads as an empty map, and an
    // empty requirement is anonymous access.
    if (isMap && types.isProxy(value) && isEmptyMap(made)) {
      throw bootError('an option is held behind a proxy that lists no keys', { option: key })
    }
    copy[key] = made
  }
  for (const key of Object.keys(given)) {
    if (!Object.hasOwn(shape, key)) {
      Object.defineProperty(copy, key, { value: undefined, enumerable: true })
    }
  }
  return copy
}

/**
 * The options a host passed, taken once: each documented option is read by name from `shape`, and a
 * getter that throws, or a proxy that throws or is revoked, anywhere in them is refused here, with
 * what was thrown as the cause and no host text.
 *
 * @param given - The options.
 * @param shape - The options the block documents.
 * @returns The copy, or `given` itself when it is not a block.
 * @throws Error When reading the options throws.
 */
export function readOptions<T>(given: T, shape: Shape): T {
  try {
    return readBlock(given, shape, new Map()) as T
  } catch (cause) {
    throw bootError('the options could not be read', {}, { cause })
  }
}
