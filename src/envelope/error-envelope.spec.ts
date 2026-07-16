/**
 * Unit tests for the error-envelope builder.
 *
 * Layer: unit.
 * Goal: prove the builder assembles the exact contract shape, stamps the
 * timestamp from the injected clock, and omits absent optional fields from the
 * serialized JSON (never emitting `undefined` keys).
 * Mocks: a fixed clock closure; no framework or timers.
 */
import { buildErrorEnvelope } from './error-envelope'

/** A deterministic clock so timestamp assertions are exact. */
const fixedClock = (): Date => new Date('2026-07-06T12:00:00.000Z')

describe('buildErrorEnvelope', () => {
  /**
   * Full envelope with every optional present.
   *
   * When details and correlationId are supplied, all seven contract fields must
   * appear with the exact values, protecting the versioned public shape.
   */
  it('assembles every field when all optionals are supplied', () => {
    const envelope = buildErrorEnvelope({
      statusCode: 404,
      code: 'BYMAX_NOT_FOUND',
      message: 'Invoice inv_123 was not found',
      details: [{ field: 'id', issue: 'unknown identifier' }],
      correlationId: '8f14e45f-ceea-4677-a9de-6ec3f1f0a1b2',
      path: '/invoices/inv_123',
      now: fixedClock
    })

    expect(envelope).toEqual({
      statusCode: 404,
      code: 'BYMAX_NOT_FOUND',
      message: 'Invoice inv_123 was not found',
      details: [{ field: 'id', issue: 'unknown identifier' }],
      correlationId: '8f14e45f-ceea-4677-a9de-6ec3f1f0a1b2',
      timestamp: '2026-07-06T12:00:00.000Z',
      path: '/invoices/inv_123'
    })
  })

  /**
   * Minimal envelope, optionals omitted from serialized JSON.
   *
   * With no details and no correlationId, the serialized body must contain
   * neither key, proving optionals are omitted rather than set to `undefined`.
   */
  it('omits absent optional fields from the serialized JSON', () => {
    const envelope = buildErrorEnvelope({
      statusCode: 500,
      code: 'BYMAX_INTERNAL_ERROR',
      message: 'Internal server error',
      path: '/orders',
      now: fixedClock
    })

    // Assert absence on the RAW object first: a builder that spread
    // `{ details: undefined }` unconditionally would still round-trip clean
    // through JSON (stringify drops undefined-valued keys), so the raw `in`
    // check is what proves the optional was omitted rather than set to
    // undefined.
    expect('details' in envelope).toBe(false)
    expect('correlationId' in envelope).toBe(false)
    expect(Object.keys(envelope).sort()).toEqual([
      'code',
      'message',
      'path',
      'statusCode',
      'timestamp'
    ])

    // Serialize to prove the keys are absent, not merely undefined-valued.
    const serialized = JSON.parse(JSON.stringify(envelope)) as Record<string, unknown>

    expect(Object.keys(serialized).sort()).toEqual([
      'code',
      'message',
      'path',
      'statusCode',
      'timestamp'
    ])
    expect('details' in serialized).toBe(false)
    expect('correlationId' in serialized).toBe(false)
  })

  /**
   * Timestamp comes from the injected clock.
   *
   * The builder must call `now` for the timestamp so tests and callers control
   * time deterministically; the value must be the ISO 8601 form of that instant.
   */
  it('stamps the ISO 8601 timestamp from the injected clock', () => {
    const now = jest.fn(() => new Date('2030-01-02T03:04:05.678Z'))

    const envelope = buildErrorEnvelope({
      statusCode: 400,
      code: 'BYMAX_BAD_REQUEST',
      message: 'Bad Request',
      path: '/x',
      now
    })

    expect(now).toHaveBeenCalledTimes(1)
    expect(envelope.timestamp).toBe('2030-01-02T03:04:05.678Z')
  })
})
