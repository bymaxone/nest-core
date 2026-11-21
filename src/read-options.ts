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

/** A map read by every name it answers to, once. */
function namedCopy(value: unknown): unknown {
  if (!isBlock(value)) return ownCopy(value)
  const copy: Record<string, unknown> = {}
  const names = new Set<string>()
  const add = (found: readonly PropertyKey[]): void => {
    for (const name of found) if (typeof name === 'string') names.add(name)
  }
  add(Reflect.ownKeys(value))
  for (
    let up = Reflect.getPrototypeOf(value);
    up && up !== Object.prototype;
    up = Reflect.getPrototypeOf(up)
  ) {
    add(Reflect.ownKeys(up))
  }
  if (names.size > MAX_NAMES) throw bootError('a map option holds too many names', {})
  for (const name of names) {
    const held: unknown = Reflect.get(value, name)
    if (typeof held !== 'function')
      Object.defineProperty(copy, name, { value: ownCopy(held), enumerable: true })
  }
  return copy
}

function isUnlisted(value: unknown): boolean {
  return types.isProxy(value) && Reflect.ownKeys(value as object).length === 0
}

/** One value of a block, read as its entry in the shape says. */
function readEntry(value: unknown, entry: Shape | readonly [Shape] | 0 | 1): unknown {
  if (entry === 1) return namedCopy(value)
  if (entry === 0) return ownCopy(value)
  if (Array.isArray(entry)) {
    const shape = entry[0] as Shape
    return Array.isArray(value) ? value.map((item) => readBlock(item, shape)) : ownCopy(value)
  }
  return readBlock(value, entry as Shape)
}

/**
 * A block with each documented option read by name, wherever the host keeps it: an own property, a
 * getter, a class accessor or a proxy that answers only `get`. A key the shape does not document is
 * kept, with no value, so the block's own check can refuse it. Anything that is not a block comes
 * back as it is, for that check to refuse.
 */
function readBlock(given: unknown, shape: Shape): unknown {
  if (!isBlock(given)) return given
  const copy: Record<string, unknown> = {}
  for (const key of Object.keys(shape)) {
    const value: unknown = Reflect.get(given, key)
    if (value !== undefined) {
      const entry = shape[key] as Shape | readonly [Shape] | 0 | 1
      // A proxy that lists no keys would read as empty, and an empty requirement is anonymous access.
      const isMap = entry === 0 || entry === 1
      if (isMap && (isUnlisted(value) || (Array.isArray(value) && value.some(isUnlisted)))) {
        throw bootError('an option is held behind a proxy that lists no keys', { option: key })
      }
      copy[key] = readEntry(value, entry)
    }
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
    return readBlock(given, shape) as T
  } catch (cause) {
    throw bootError('the options could not be read', {}, { cause })
  }
}
