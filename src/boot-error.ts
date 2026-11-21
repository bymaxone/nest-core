/**
 * @fileoverview The error a boot throws about something a host declared: a message that is this
 * package's own text, and the host's names as properties of the error.
 * @layer Utility
 */
import { escapeUnseen } from './escape-unseen'

/** A field value as it is kept: a string, or each string of a list, written out so nothing in it breaks a log line. */
function shown(value: unknown): unknown {
  if (typeof value === 'string') return escapeUnseen(value)
  return Array.isArray(value) ? value.map(shown) : value
}

/**
 * Build a boot error whose message holds no text the host wrote.
 *
 * @param message - Library text only.
 * @param fields - What the host declared (a contributor's class name, an operation key, a scheme
 *   name), kept as own properties so a stack dump shows them and code can match on them. A string,
 *   or each string of a list, is escaped and cut as {@link escapeUnseen} does.
 * @param options - The `cause`, when the error wraps something the host threw.
 * @returns The error, with `fields` assigned to it.
 */
export function bootError(
  message: string,
  fields: Readonly<Record<string, unknown>>,
  options?: ErrorOptions
): Error {
  const kept = Object.fromEntries(
    Object.entries(fields).map(([name, value]) => [name, shown(value)])
  )
  return Object.assign(new Error(message, options), kept)
}
