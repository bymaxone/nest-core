/**
 * @fileoverview What a host's throw becomes when this package logs or chains it: an `Error` that is
 * the host's own when it already is one, and a typed wrapper that keeps the original as `cause`
 * when it is a string, an object or anything else.
 * @layer Utility
 */
import { types } from 'node:util'

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
 * Marks an instance. Each published entry bundles its own copy of the class, and a class from one
 * copy is not an `instanceof` the other's; the registry key is what they share, as the DI tokens do.
 */
const BRAND = Symbol.for('@bymax-one/nest-core:non-error-thrown')

/**
 * What a thrown value that is not an `Error` becomes. The thrown value is `cause`. Building one
 * reads no property of an object except its type tag, which is guarded. `instanceof` answers for
 * an instance made by any bundled copy of this class.
 */
export class NonErrorThrownError extends Error {
  /** Whether `value` carries this class's mark; a value whose mark cannot be read is not one. */
  static override [Symbol.hasInstance](value: unknown): boolean {
    try {
      return typeof value === 'object' && value !== null && Reflect.get(value, BRAND) === true
    } catch {
      return false
    }
  }

  /** @param thrown - The value that was thrown. */
  constructor(thrown: unknown) {
    super(
      typeof thrown === 'string'
        ? thrown.slice(0, MAX_THROWN_TEXT)
        : `A value that is not an Error was thrown${describeSafely(thrown)}`,
      { cause: thrown }
    )
    this.name = 'NonErrorThrownError'
    Object.defineProperty(this, BRAND, { value: true })
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

/**
 * Whether `thrown` is an `Error`, one from another realm included; a revoked proxy is not one and
 * makes `instanceof` throw.
 */
function isError(thrown: unknown): thrown is Error {
  try {
    return types.isNativeError(thrown) || thrown instanceof Error
  } catch {
    return false
  }
}
