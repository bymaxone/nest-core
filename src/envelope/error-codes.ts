/**
 * @fileoverview Stable `BYMAX_*` error-code catalog and HTTP-status derivation.
 * These codes are the machine-readable half of the error envelope contract and
 * are shared by the exception filter and the cursor codec, so they live in the
 * foundation rather than in any single feature.
 * @layer Constants
 */

/** Generic malformed-request code for HTTP 400. */
export const BYMAX_BAD_REQUEST = 'BYMAX_BAD_REQUEST'

/** Code emitted when a request fails structured validation. */
export const BYMAX_VALIDATION_FAILED = 'BYMAX_VALIDATION_FAILED'

/** Missing or invalid authentication code for HTTP 401. */
export const BYMAX_UNAUTHORIZED = 'BYMAX_UNAUTHORIZED'

/** Authenticated-but-not-allowed code for HTTP 403. */
export const BYMAX_FORBIDDEN = 'BYMAX_FORBIDDEN'

/** Unknown-resource code for HTTP 404. */
export const BYMAX_NOT_FOUND = 'BYMAX_NOT_FOUND'

/** State-conflict code for HTTP 409. */
export const BYMAX_CONFLICT = 'BYMAX_CONFLICT'

/** Oversized-payload code for HTTP 413. */
export const BYMAX_PAYLOAD_TOO_LARGE = 'BYMAX_PAYLOAD_TOO_LARGE'

/** Unsupported-content-type code for HTTP 415. */
export const BYMAX_UNSUPPORTED_MEDIA_TYPE = 'BYMAX_UNSUPPORTED_MEDIA_TYPE'

/** Semantically-invalid-entity code for HTTP 422. */
export const BYMAX_UNPROCESSABLE_ENTITY = 'BYMAX_UNPROCESSABLE_ENTITY'

/** Rate-limit code for HTTP 429. */
export const BYMAX_TOO_MANY_REQUESTS = 'BYMAX_TOO_MANY_REQUESTS'

/** Generic client-error fallback for any uncatalogued 4xx status. */
export const BYMAX_CLIENT_ERROR = 'BYMAX_CLIENT_ERROR'

/** Internal-failure code for HTTP 500 and any uncatalogued non-4xx status. */
export const BYMAX_INTERNAL_ERROR = 'BYMAX_INTERNAL_ERROR'

/** Unimplemented-handler code for HTTP 501. */
export const BYMAX_NOT_IMPLEMENTED = 'BYMAX_NOT_IMPLEMENTED'

/** Upstream-failure code for HTTP 502. */
export const BYMAX_BAD_GATEWAY = 'BYMAX_BAD_GATEWAY'

/** Temporary-unavailability code for HTTP 503. */
export const BYMAX_SERVICE_UNAVAILABLE = 'BYMAX_SERVICE_UNAVAILABLE'

/** Upstream-timeout code for HTTP 504. */
export const BYMAX_GATEWAY_TIMEOUT = 'BYMAX_GATEWAY_TIMEOUT'

/**
 * Exact status-to-code rows. A `Map` keeps the lookup free of prototype-pollution
 * and object-injection concerns that a plain record indexed by a runtime number
 * would raise.
 */
const STATUS_CODES: ReadonlyMap<number, string> = new Map([
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
])

/** Inclusive lower bound of the HTTP client-error range. */
const CLIENT_ERROR_MIN = 400

/** Exclusive upper bound of the HTTP client-error range. */
const CLIENT_ERROR_MAX = 500

/**
 * Derive the stable `BYMAX_*` code for an HTTP status when a thrown exception
 * carries no explicit `code`.
 *
 * The validation code is never derived here: whether a 400 is a validation
 * failure is a shape decision made by the exception filter, so status 400
 * resolves to {@link BYMAX_BAD_REQUEST}.
 *
 * @param status - The HTTP status code of the response.
 * @returns The catalogued code, or the client/internal fallback for any status
 *   without a dedicated row.
 */
export function codeForStatus(status: number): string {
  const catalogued = STATUS_CODES.get(status)
  if (catalogued !== undefined) {
    return catalogued
  }
  // Stryker disable next-line EqualityOperator: equivalent — the two mutants differ only at `status === 400` and `status === 500`, and both are catalogued rows returned by the `Map` lookup above before this branch is reached. Neither boundary is reachable here, so every status that gets this far resolves to the same code.
  if (status >= CLIENT_ERROR_MIN && status < CLIENT_ERROR_MAX) {
    return BYMAX_CLIENT_ERROR
  }
  return BYMAX_INTERNAL_ERROR
}
