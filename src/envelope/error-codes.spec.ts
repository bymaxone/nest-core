/**
 * Unit tests for the BYMAX_* error-code catalog and status derivation.
 *
 * Layer: unit.
 * Goal: prove `codeForStatus` maps every catalogued HTTP status to its stable
 * code and falls back correctly for uncatalogued client and server statuses,
 * protecting the machine-readable contract shared by the exception filter and
 * the cursor codec.
 * Mocks: none (pure function).
 */
import {
  BYMAX_BAD_GATEWAY,
  BYMAX_BAD_REQUEST,
  BYMAX_CLIENT_ERROR,
  BYMAX_CONFLICT,
  BYMAX_FORBIDDEN,
  BYMAX_GATEWAY_TIMEOUT,
  BYMAX_INTERNAL_ERROR,
  BYMAX_NOT_FOUND,
  BYMAX_NOT_IMPLEMENTED,
  BYMAX_PAYLOAD_TOO_LARGE,
  BYMAX_SERVICE_UNAVAILABLE,
  BYMAX_TOO_MANY_REQUESTS,
  BYMAX_UNAUTHORIZED,
  BYMAX_UNPROCESSABLE_ENTITY,
  BYMAX_UNSUPPORTED_MEDIA_TYPE,
  BYMAX_VALIDATION_FAILED,
  codeForStatus
} from './error-codes'

describe('codeForStatus', () => {
  /**
   * Exhaustive mapping table (spec section 10).
   *
   * Each catalogued status must derive its exact stable code; a drift here is a
   * breaking change to the public error contract, so every row is asserted.
   */
  const cases: ReadonlyArray<readonly [number, string]> = [
    [400, BYMAX_BAD_REQUEST],
    [401, BYMAX_UNAUTHORIZED],
    [403, BYMAX_FORBIDDEN],
    [404, BYMAX_NOT_FOUND],
    [409, BYMAX_CONFLICT],
    [413, BYMAX_PAYLOAD_TOO_LARGE],
    [415, BYMAX_UNSUPPORTED_MEDIA_TYPE],
    [422, BYMAX_UNPROCESSABLE_ENTITY],
    [429, BYMAX_TOO_MANY_REQUESTS],
    [500, BYMAX_INTERNAL_ERROR],
    [501, BYMAX_NOT_IMPLEMENTED],
    [502, BYMAX_BAD_GATEWAY],
    [503, BYMAX_SERVICE_UNAVAILABLE],
    [504, BYMAX_GATEWAY_TIMEOUT]
  ]

  it.each(cases)('maps status %i to its catalogued code', (status, expected) => {
    // Every explicitly catalogued status resolves to its own stable code.
    expect(codeForStatus(status)).toBe(expected)
  })

  /**
   * Uncatalogued 4xx fallback.
   *
   * A client status without a dedicated row must collapse to the generic
   * client-error code rather than leaking through as a server error.
   */
  it.each([402, 405, 418, 451, 499])(
    'falls back to BYMAX_CLIENT_ERROR for uncatalogued 4xx status %i',
    (status) => {
      expect(codeForStatus(status)).toBe(BYMAX_CLIENT_ERROR)
    }
  )

  /**
   * Uncatalogued 5xx fallback.
   *
   * Any server status without a dedicated row must report the generic internal
   * error code, matching the "other 5xx" row of the catalog.
   */
  it.each([505, 507, 511, 599])(
    'falls back to BYMAX_INTERNAL_ERROR for uncatalogued 5xx status %i',
    (status) => {
      expect(codeForStatus(status)).toBe(BYMAX_INTERNAL_ERROR)
    }
  )

  /**
   * Non-error status boundary.
   *
   * Statuses below 400 are never error responses; they must resolve to the
   * internal-error fallback rather than the client-error branch, proving the
   * derivation gates on the 4xx range and not merely on "not a 5xx".
   */
  it.each([100, 200, 204, 301, 399])(
    'falls back to BYMAX_INTERNAL_ERROR for non-error status %i',
    (status) => {
      expect(codeForStatus(status)).toBe(BYMAX_INTERNAL_ERROR)
    }
  )

  /**
   * Validation code is catalog-only, never status-derived.
   *
   * The validation shape is a decision made by the filter, so status 400 must
   * derive BYMAX_BAD_REQUEST and never BYMAX_VALIDATION_FAILED.
   */
  it('does not derive BYMAX_VALIDATION_FAILED from status 400', () => {
    expect(codeForStatus(400)).not.toBe(BYMAX_VALIDATION_FAILED)
    expect(BYMAX_VALIDATION_FAILED).toBe('BYMAX_VALIDATION_FAILED')
  })
})
