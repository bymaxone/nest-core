/**
 * @fileoverview Boot-time checks shared by every option block: what a value is, whether a block has
 * only the options it documents, and a refusal that names the option and the type of the value but
 * never the value, since a value may be a secret and a message reaches logs.
 * @layer Configuration
 */

/** The built-in objects that are named when one is given where a block was expected. */
const BUILT_IN_OBJECTS = ['Date', 'Map', 'Set', 'RegExp', 'Promise', 'Error']

/**
 * Whether `value` is an object that holds settings: not `null`, a list, or a built-in such as a
 * `Date` or a `Map`, which would otherwise pass as an empty set of options.
 */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.prototype.toString.call(value) === '[object Object]'
  )
}

/** The longest an unknown option's name is shown, so a hostile key cannot fill a log line. */
const MAX_KEY_SHOWN = 40

/**
 * What a value is, for a message: its type, and a number as itself. Nothing else is shown,
 * because the text of a string, a symbol's description or a function's name may be a secret.
 *
 * @param value - Any value.
 * @returns A short phrase such as `a string`, `an array` or `1.5`.
 */
export function describeValue(value: unknown): string {
  if (typeof value === 'number') return String(value)
  if (value === null || value === undefined) return String(value)
  if (Array.isArray(value)) return 'an array'
  if (typeof value === 'object') {
    const tag = Object.prototype.toString.call(value).slice(8, -1)
    return BUILT_IN_OBJECTS.includes(tag) ? `a ${tag}` : 'an object'
  }
  return `a ${typeof value}`
}

/** The error a refused option throws: `<name> must be <expected>, received <type>`. */
export function refusal(name: string, expected: string, value: unknown): Error {
  return new Error(`${name} must be ${expected}, received ${describeValue(value)}`)
}

/**
 * A boolean option: `undefined` and `null` read as unset and give `fallback`.
 *
 * @throws Error When the value is set and is not `true` or `false`: a string such as `'false'` is
 *   truthy, and would silently switch on what the consumer meant to leave off.
 */
export function booleanOption(name: string, value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'boolean') throw refusal(name, 'true or false', value)
  return value
}

/** A string option: `undefined` and `null` read as unset and give `fallback`; any other type is refused. */
export function stringOption<T extends string | undefined>(
  name: string,
  value: unknown,
  fallback: T
): string | T {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'string') throw refusal(name, 'a string', value)
  return value
}

/**
 * Check a block of options is an object that has only the options it documents.
 *
 * A key the block does not have is a typo that would otherwise do nothing. Only the block's own
 * enumerable keys are listed; an option defined as a getter on a class is read by name where it is
 * used, so it needs no listing here.
 *
 * @param name - The block's name, for the message.
 * @param raw - What the consumer gave.
 * @param known - The block's documented options, as the keys of a table the compiler checks is complete.
 * @returns `raw` as an object, or `undefined` when it is unset.
 * @throws Error When `raw` is set and is not an object, or has a key that is not in `known`.
 */
export function checkedBlock<T extends object>(
  name: string,
  raw: unknown,
  known: Readonly<Record<string, unknown>>
): T | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!isPlainRecord(raw)) throw refusal(name, 'an object', raw)
  const stray = Object.keys(raw).find((key) => !Object.hasOwn(known, key))
  if (stray !== undefined) {
    const shown = stray.length > MAX_KEY_SHOWN ? `${stray.slice(0, MAX_KEY_SHOWN)}…` : stray
    throw new Error(`${name} has an unknown option ${JSON.stringify(shown)}`)
  }
  return raw as T
}

/**
 * A route option: a non-empty string with no space, query or fragment. `undefined` and `null` read
 * as unset and give `fallback`.
 */
export function routeOption(name: string, value: unknown, fallback: string): string {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'string' || value === '' || /[\s?#]/.test(value)) {
    throw refusal(name, 'a route such as "docs", with no space, query or fragment', value)
  }
  return value
}
