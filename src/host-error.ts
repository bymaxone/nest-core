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
 * The error a host threw something other than an `Error` becomes. The thrown value is `cause`
 * and nothing is read from an object, so a hostile getter or `toString` is never run.
 */
export class NonErrorThrownError extends Error {
  /** @param thrown - The value that was thrown. */
  constructor(thrown: unknown) {
    super(
      typeof thrown === 'string'
        ? thrown.slice(0, MAX_THROWN_TEXT)
        : `A value that is not an Error was thrown: ${describeValue(thrown)}`,
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
  return thrown instanceof Error ? thrown : new NonErrorThrownError(thrown)
}
