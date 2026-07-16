/**
 * Unit tests for the opaque cursor codec.
 *
 * Layer: unit.
 * Goal: prove `encodeCursor`/`decodeCursor` round-trip ordering-key payloads and
 * that `decodeCursor` rejects every malformed input with a stable
 * `BYMAX_VALIDATION_FAILED` HTTP 400 exception, never leaking the underlying
 * parse error or the offending bytes. The codec parses untrusted client input,
 * so its rejection discipline is a security boundary.
 * Mocks: none; the codec is pure.
 */
import { BadRequestException } from '@nestjs/common'

import { BYMAX_VALIDATION_FAILED } from '../envelope/error-codes'

import { buildCursorResult, decodeCursor, encodeCursor, normalizeCursorQuery } from './cursor'

/** The fixed, detail-free message every rejection must carry. */
const REJECTION_MESSAGE = 'Malformed pagination cursor.'

/** Encode an arbitrary raw string as base64url to forge malformed cursors. */
const toBase64url = (raw: string): string => Buffer.from(raw, 'utf8').toString('base64url')

/**
 * Assert that decoding a cursor rejects with the stable validation envelope and
 * does not echo any parser-internal wording.
 */
function expectRejection(cursor: string): void {
  let thrown: unknown
  try {
    decodeCursor(cursor)
  } catch (error) {
    thrown = error
  }

  expect(thrown).toBeInstanceOf(BadRequestException)
  const exception = thrown as BadRequestException
  expect(exception.getStatus()).toBe(400)
  expect(exception.getResponse()).toEqual({
    code: BYMAX_VALIDATION_FAILED,
    message: REJECTION_MESSAGE
  })
  // No parser wording ("Unexpected", "token", "JSON") may reach the caller.
  expect(REJECTION_MESSAGE).not.toMatch(/unexpected|token|json/i)
}

describe('encodeCursor / decodeCursor', () => {
  /**
   * Round-trip with a mixed string/number payload.
   *
   * The codec is the ordering-key contract: whatever `encodeCursor` produces
   * must decode back to an identical payload so consumers page deterministically.
   */
  it('round-trips a payload of mixed string and number values', () => {
    const payload = { createdAt: '2026-07-16T00:00:00.000Z', id: 42 }

    const decoded = decodeCursor(encodeCursor(payload))

    expect(decoded).toEqual(payload)
  })

  /**
   * Opaque output edge case.
   *
   * The encoded cursor must be url-safe base64 (no `+`, `/`, or `=`), so it can
   * ride in a query string without further escaping.
   */
  it('emits a url-safe base64 string', () => {
    const cursor = encodeCursor({ id: 1, name: 'a/b+c=' })

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  /**
   * Empty-payload boundary.
   *
   * An empty ordering-key set is a valid (if unusual) cursor and must round-trip
   * rather than reject, since the shape is still `Record<string, ...>`.
   */
  it('round-trips an empty payload', () => {
    expect(decodeCursor(encodeCursor({}))).toEqual({})
  })

  /**
   * Non-finite numbers are rejected at encode time.
   *
   * `JSON.stringify` turns `NaN`/`Infinity` into `null`, which would produce a
   * cursor that could never decode; encoding must fail loudly instead of
   * emitting a self-invalidating cursor.
   */
  it('throws when a payload value is a non-finite number', () => {
    expect(() => encodeCursor({ id: Number.NaN })).toThrow()
    expect(() => encodeCursor({ id: Number.POSITIVE_INFINITY })).toThrow()
  })

  /**
   * Non-base64url input.
   *
   * Characters outside the base64url alphabet mark a hand-tampered cursor and
   * must reject before any decode is attempted.
   */
  it('rejects a cursor with non-base64url characters', () => {
    expectRejection('not a cursor!!')
  })

  /**
   * Empty-string input.
   *
   * An empty cursor carries no payload and must reject rather than decode to a
   * surprising value.
   */
  it('rejects an empty string', () => {
    expectRejection('')
  })

  /**
   * Valid base64url that is not JSON.
   *
   * A cursor can decode to bytes that are not JSON; the parse failure must be
   * swallowed and mapped to the stable rejection, never surfaced verbatim.
   */
  it('rejects base64url that does not decode to JSON', () => {
    expectRejection(toBase64url('plain text, not json'))
  })

  /**
   * Truncated cursor.
   *
   * A cursor cut mid-payload decodes to broken JSON and must reject without
   * leaking the parser error.
   */
  it('rejects a truncated cursor', () => {
    const full = encodeCursor({ id: 100, cursorKey: 'value' })

    expectRejection(full.slice(0, full.length - 3))
  })

  /**
   * JSON of the wrong container type.
   *
   * A JSON array is valid JSON but not an ordering-key record, so the shape
   * guard must reject it.
   */
  it('rejects a JSON array payload', () => {
    expectRejection(toBase64url('[1,2,3]'))
  })

  /**
   * JSON null.
   *
   * `null` is valid JSON and `typeof null === "object"`, so the guard must
   * special-case it and reject.
   */
  it('rejects a JSON null payload', () => {
    expectRejection(toBase64url('null'))
  })

  /**
   * Disallowed value type.
   *
   * Cursors encode ordering keys only; a boolean (or any non string/number)
   * value must reject so no arbitrary shape sneaks through the codec.
   */
  it('rejects a payload with a boolean value', () => {
    expectRejection(toBase64url('{"active":true}'))
  })

  /**
   * Disallowed nested value.
   *
   * A nested object is neither a string nor a number and must reject, guarding
   * the never-sensitive-data invariant against structured payloads.
   */
  it('rejects a payload with a nested object value', () => {
    expectRejection(toBase64url('{"range":{"from":1}}'))
  })

  /**
   * Non-finite ordering key from a crafted cursor.
   *
   * A JSON numeric literal that overflows (`1e309`) parses to `Infinity`, which
   * is not a finite ordering key; a hand-crafted cursor carrying one must reject
   * so decode stays symmetric with encode's finite-number guard.
   */
  it('rejects a hand-crafted cursor whose number overflows to Infinity', () => {
    expectRejection(toBase64url('{"id":1e309}'))
  })
})

describe('normalizeCursorQuery', () => {
  // Rows exercise the shared limit clamp plus the cursor pass-through rule.
  const cases: ReadonlyArray<{
    readonly name: string
    readonly raw: { cursor?: unknown; limit?: unknown }
    readonly options?: { defaultLimit?: number; maxLimit?: number }
    readonly expected: { cursor?: string; limit: number }
  }> = [
    {
      name: 'applies the default limit and omits an absent cursor',
      raw: {},
      expected: { limit: 20 }
    },
    {
      name: 'passes a string cursor through untouched',
      raw: { cursor: 'abc', limit: 10 },
      expected: { cursor: 'abc', limit: 10 }
    },
    {
      name: 'caps the limit at the default maximum',
      raw: { cursor: 'abc', limit: 500 },
      expected: { cursor: 'abc', limit: 100 }
    },
    {
      name: 'floors a zero limit up to the default',
      raw: { limit: 0 },
      expected: { limit: 20 }
    },
    {
      name: 'honors per-call default and max overrides',
      raw: { limit: 999 },
      options: { defaultLimit: 5, maxLimit: 25 },
      expected: { limit: 25 }
    },
    {
      name: 'omits a non-string cursor',
      raw: { cursor: 12345, limit: 10 },
      expected: { limit: 10 }
    }
  ]

  it.each(cases)('$name', ({ raw, options, expected }) => {
    /**
     * Cursor-query clamping matrix.
     *
     * Confirms the limit clamps identically to the offset path and that only a
     * string cursor survives normalization; content validation is deferred to
     * decode time.
     */
    expect(normalizeCursorQuery(raw, options)).toEqual(expected)
  })
})

describe('buildCursorResult', () => {
  /** Maps a row to its ordering keys for cursor derivation. */
  const toCursor = (row: { id: number }): { id: number } => ({ id: row.id })

  /**
   * Fetch-one-extra with a further page.
   *
   * Given `limit + 1` rows, the builder must trim to `limit` items and derive
   * `nextCursor` from the last RETURNED item (not the discarded extra row), so
   * the next page resumes exactly after the boundary.
   */
  it('trims the extra row and derives nextCursor from the last returned item', () => {
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }]

    const result = buildCursorResult(rows, 2, toCursor)

    expect(result.items).toEqual([{ id: 1 }, { id: 2 }])
    expect(result.nextCursor).not.toBeNull()
    expect(decodeCursor(result.nextCursor as string)).toEqual({ id: 2 })
  })

  /**
   * Exact-limit boundary.
   *
   * With exactly `limit` rows there is no extra row, so this is the last page
   * and `nextCursor` is null.
   */
  it('yields a null nextCursor when exactly limit rows are returned', () => {
    const result = buildCursorResult([{ id: 1 }, { id: 2 }], 2, toCursor)

    expect(result.items).toEqual([{ id: 1 }, { id: 2 }])
    expect(result.nextCursor).toBeNull()
  })

  /**
   * Under-limit case.
   *
   * Fewer rows than the limit is unambiguously the last page.
   */
  it('yields a null nextCursor when fewer than limit rows are returned', () => {
    const result = buildCursorResult([{ id: 1 }], 5, toCursor)

    expect(result.items).toEqual([{ id: 1 }])
    expect(result.nextCursor).toBeNull()
  })

  /**
   * Empty-result boundary.
   *
   * No rows means an empty page and no next cursor.
   */
  it('yields an empty page and null cursor for no items', () => {
    const result = buildCursorResult<{ id: number }>([], 10, toCursor)

    expect(result.items).toEqual([])
    expect(result.nextCursor).toBeNull()
  })

  /**
   * Zero-limit defensive case.
   *
   * A misused zero limit trims to an empty page; with no last item there is no
   * ordering key to encode, so the builder returns a null cursor instead of
   * crashing on the empty slice.
   */
  it('yields a null cursor when the limit is zero despite extra rows', () => {
    const result = buildCursorResult([{ id: 1 }, { id: 2 }], 0, toCursor)

    expect(result.items).toEqual([])
    expect(result.nextCursor).toBeNull()
  })

  /**
   * Negative-limit defensive case.
   *
   * A negative limit is a misuse: `slice` with a negative end would otherwise
   * return all-but-last, a non-empty page with a bogus cursor. The builder must
   * deterministically return an empty page and a null cursor instead.
   */
  it('yields an empty page and null cursor for a negative limit', () => {
    const result = buildCursorResult([{ id: 1 }, { id: 2 }], -1, toCursor)

    expect(result.items).toEqual([])
    expect(result.nextCursor).toBeNull()
  })
})
