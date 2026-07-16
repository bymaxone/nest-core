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

import { clampLimit, type PaginationLimitOptions } from './internal'
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
 * Rejects `null`, arrays, non-finite numbers, and any value type outside
 * string/number, which keeps arbitrary, nested, or sensitive shapes out of the
 * codec and matches encode's finite-number guard.
 *
 * @param value - The parsed candidate to validate.
 * @returns `true` when the value is a valid ordering-key record.
 */
function isOrderingKeyRecord(value: unknown): value is Record<string, string | number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  return Object.values(value).every(
    (entry) => typeof entry === 'string' || (typeof entry === 'number' && Number.isFinite(entry))
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
 * @throws Error when a payload value is not a string or a finite number. This
 *   covers non-finite numbers (which would encode as `null` and never decode)
 *   as well as any non-string, non-number value reaching the function through an
 *   `any`-typed payload.
 */
export function encodeCursor(payload: Record<string, string | number>): string {
  const encodable = Object.values(payload).every(
    (value) => typeof value === 'string' || Number.isFinite(value)
  )
  if (!encodable) {
    throw new Error('encodeCursor payload values must each be a string or a finite number.')
  }
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

/** A safe, clamped cursor query. The cursor is validated only at decode time. */
export interface CursorQuery {
  /** Opaque cursor from a prior page, or absent for the first page. */
  cursor?: string
  /** Page size, always within `[1, maxLimit]`. */
  limit: number
}

/** A page of items plus the cursor for the next page, if any. */
export interface CursorResult<T> {
  /** The items on this page, trimmed to the requested limit. */
  items: T[]
  /** The cursor for the next page, or `null` when this is the last page. */
  nextCursor: string | null
}

/**
 * Clamp raw request input into a safe {@link CursorQuery}.
 *
 * The limit is clamped exactly as the offset path clamps it. The cursor is
 * passed through untouched when it is a string and omitted otherwise; its
 * contents are validated later by {@link decodeCursor}, not here.
 *
 * @param raw - The untrusted cursor and limit values from the request.
 * @param options - Per-call `defaultLimit` (default `20`) and `maxLimit`
 *   (default `100`) overrides.
 * @returns A clamped, safe cursor query.
 */
export function normalizeCursorQuery(
  raw: { cursor?: unknown; limit?: unknown },
  options?: PaginationLimitOptions
): CursorQuery {
  const limit = clampLimit(raw.limit, options)
  if (typeof raw.cursor === 'string') {
    return { cursor: raw.cursor, limit }
  }
  return { limit }
}

/**
 * Assemble a {@link CursorResult} using the fetch-one-extra convention.
 *
 * The repository fetches `limit + 1` rows. A count beyond the limit signals a
 * further page: the extra row is trimmed and `nextCursor` is derived from the
 * last returned item. With `limit` rows or fewer, `nextCursor` is `null`.
 *
 * @param items - The fetched rows, expected to be up to `limit + 1` long.
 * @param limit - The requested page size that bounds the returned items.
 * @param toCursor - Maps the last returned item to its ordering keys.
 * @returns The trimmed page and the next cursor, or `null` on the last page.
 */
export function buildCursorResult<T>(
  items: T[],
  limit: number,
  toCursor: (lastItem: T) => Record<string, string | number>
): CursorResult<T> {
  if (items.length <= limit) {
    return { items, nextCursor: null }
  }
  const page = items.slice(0, Math.max(0, limit))
  const lastItem = page.at(-1)
  // A zero or negative limit trims to an empty page (Math.max floors the slice
  // end at 0, avoiding negative-index semantics), leaving no key to encode.
  if (lastItem === undefined) {
    return { items: page, nextCursor: null }
  }
  return { items: page, nextCursor: encodeCursor(toCursor(lastItem)) }
}
