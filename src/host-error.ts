/**
 * @fileoverview What a host's throw becomes when this package logs or chains it: an `Error` that is
 * the host's own when it already is one, and a typed wrapper that keeps the original as `cause`
 * when it is a string, an object or anything else.
 * @layer Utility
 */
import { describeValue } from './option-validation'

/** The longest a thrown string is carried into the wrapper's message. */
const MAX_THROWN_TEXT = 500

/**
 * What a thrown value is, in a phrase, or `''` when inspecting it throws: a getter on the value's
 * type tag or a revoked proxy must not stop the wrapper from being built.
 */
function describeSafely(thrown: unknown): string {
  try {
    return `: ${describeValue(thrown)}`
  } catch {
    return ''
  }
}

/**
 * The error a host threw something other than an `Error` becomes. The thrown value is `cause`,
 * and a property of an object is never read except its type tag, which is guarded.
 */
export class NonErrorThrownError extends Error {
  /** @param thrown - The value that was thrown. */
  constructor(thrown: unknown) {
    super(
      typeof thrown === 'string'
        ? thrown.slice(0, MAX_THROWN_TEXT)
        : `A value that is not an Error was thrown${describeSafely(thrown)}`,
      { cause: thrown }
    )
    this.name = 'NonErrorThrownError'
  }
}

/**
 * The `Error` to log or chain for something a host threw.
 *
 * @param thrown - Whatever was thrown or rejected.
 * @returns `thrown` itself when it is an `Error`, so its name, code and stack survive; otherwise a
 *   {@link NonErrorThrownError} holding it as `cause`.
 */
export function asHostError(thrown: unknown): Error {
  return isError(thrown) ? thrown : new NonErrorThrownError(thrown)
}

/** Whether `thrown` is an `Error`; a revoked proxy throws on the test and is not one. */
function isError(thrown: unknown): thrown is Error {
  try {
    return thrown instanceof Error
  } catch {
    return false
  }
}
