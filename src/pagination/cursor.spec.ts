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

import { decodeCursor, encodeCursor } from './cursor'

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
})
