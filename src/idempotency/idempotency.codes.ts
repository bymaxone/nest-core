/**
 * @fileoverview The error codes of HTTP idempotency keys. Each is the `code` of an error the interceptor
 * throws, so the envelope filter passes it through with the status it was thrown with.
 * @layer Constants
 */

/** `400`: the `Idempotency-Key` header is present but is not 1 to 255 visible ASCII characters. */
export const BYMAX_IDEMPOTENCY_KEY_INVALID = 'BYMAX_IDEMPOTENCY_KEY_INVALID'

/** `400`: the route requires an `Idempotency-Key` header and the request carries none. */
export const BYMAX_IDEMPOTENCY_KEY_REQUIRED = 'BYMAX_IDEMPOTENCY_KEY_REQUIRED'

/** `409` with `Retry-After`: the first request holding the key has not answered yet. */
export const BYMAX_IDEMPOTENCY_IN_PROGRESS = 'BYMAX_IDEMPOTENCY_IN_PROGRESS'

/** `422`: the key was used by a request that differs in method, path, query or body. */
export const BYMAX_IDEMPOTENCY_KEY_REUSED = 'BYMAX_IDEMPOTENCY_KEY_REUSED'

/** `409` without `Retry-After`: the first request completed, but its answer was too large to keep. */
export const BYMAX_IDEMPOTENCY_NOT_REPLAYABLE = 'BYMAX_IDEMPOTENCY_NOT_REPLAYABLE'

/** `503`: the store could not be reached and the route does not run unprotected. */
export const BYMAX_IDEMPOTENCY_STORE_UNAVAILABLE = 'BYMAX_IDEMPOTENCY_STORE_UNAVAILABLE'
