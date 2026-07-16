/**
 * @fileoverview Opaque cursor codec and cursor pagination primitives for the
 * `./pagination` subpath. Cursors are `base64url` strings over a JSON payload of
 * ordering keys. They are the pagination contract: consumers never parse a
 * cursor by hand. Cursors are neither encrypted nor signed, so they must encode
 * ordering keys only and never carry sensitive data. `decodeCursor` treats its
 * input as untrusted and rejects anything malformed with a stable validation
 * error, never leaking the underlying parse failure.
 * @layer Utility
 */
import { BadRequestException } from '@nestjs/common'

import { BYMAX_VALIDATION_FAILED } from '../envelope/error-codes'

/** The base64url alphabet: url-safe base64 with no padding. */
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/

/**
 * Fixed rejection message. Detail-free on purpose: echoing the parse error or
 * the offending bytes would leak internal state to the caller.
 */
const CURSOR_REJECTION_MESSAGE = 'Malformed pagination cursor.'

/**
 * Build the stable validation exception thrown for every malformed cursor.
 *
 * @returns A 400 exception whose response carries the shared validation code
 *   and the fixed, detail-free message.
 */
function cursorRejection(): BadRequestException {
  return new BadRequestException({
    code: BYMAX_VALIDATION_FAILED,
    message: CURSOR_REJECTION_MESSAGE
  })
}

/**
 * Narrow an unknown value to an ordering-key record: a plain object whose every
 * value is a string or a number.
 *
 * Rejects `null`, arrays, and any value type outside string/number, which keeps
 * arbitrary, nested, or sensitive shapes out of the codec.
 *
 * @param value - The parsed candidate to validate.
 * @returns `true` when the value is a valid ordering-key record.
 */
function isOrderingKeyRecord(value: unknown): value is Record<string, string | number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  return Object.values(value).every(
    (entry) => typeof entry === 'string' || typeof entry === 'number'
  )
}

/**
 * Encode an ordering-key set into an opaque cursor.
 *
 * The payload must contain ordering keys only and never sensitive data: cursors
 * are opaque but neither encrypted nor signed.
 *
 * @param payload - The ordering keys to encode.
 * @returns A url-safe base64 cursor string.
 */
export function encodeCursor(payload: Record<string, string | number>): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

/**
 * Decode a cursor produced by {@link encodeCursor}.
 *
 * Input is untrusted: non-base64url text, non-JSON bytes, wrong JSON shapes, and
 * disallowed value types all reject with a {@link BYMAX_VALIDATION_FAILED} HTTP
 * 400 exception. The underlying parse error is never surfaced. The payload must
 * carry ordering keys only and never sensitive data.
 *
 * @param cursor - The opaque cursor string from the request.
 * @returns The decoded ordering-key payload.
 * @throws BadRequestException when the cursor is malformed or of the wrong shape.
 */
export function decodeCursor<T extends Record<string, string | number>>(cursor: string): T {
  if (!BASE64URL_PATTERN.test(cursor)) {
    throw cursorRejection()
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
  } catch {
    throw cursorRejection()
  }
  if (!isOrderingKeyRecord(parsed)) {
    throw cursorRejection()
  }
  return parsed as T
}
