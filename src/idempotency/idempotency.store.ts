/**
 * @fileoverview The storage port of HTTP idempotency keys: the contract a store implements and the
 * token it is injected under. The port is types and one token only, so nothing here reaches a bundle
 * beyond the token's registry key.
 * @layer Port
 */

/**
 * Injection token of the application's {@link IIdempotencyStore}.
 *
 * Minted with `Symbol.for`: every bundle of this package resolves the same identity, so a store
 * registered from one module is reachable from the interceptor in another. The registry key is as
 * binding as the export name.
 */
export const BYMAX_IDEMPOTENCY_STORE: unique symbol = Symbol.for(
  '@bymax-one/nest-core:idempotency-store'
)

/** The headers a stored response may carry; everything else is dropped before it is stored. */
export interface StoredResponseHeaders {
  readonly [name: string]: string
}

/**
 * The answer of a completed request, as stored and replayed.
 *
 * `body` is absent when the original answer exceeded the size limit: the request is then known to
 * have completed but cannot be replayed.
 */
export interface IdempotencyStoredResponse {
  /** The HTTP status of the original answer. */
  readonly status: number
  /** The allow-listed headers of the original answer, lower-cased. */
  readonly headers: StoredResponseHeaders
  /** The JSON body serialised once, exactly as it was sent; absent when it was too large to keep. */
  readonly body?: string
}

/** What a store holds under a key. */
export interface IdempotencyRecord {
  /** Whether the first request is still running or has answered. */
  readonly state: 'in_progress' | 'completed'
  /** The fingerprint of the request that claimed the key. */
  readonly fingerprint: string
  /** The stored answer; present only when `state` is `completed`. */
  readonly response?: IdempotencyStoredResponse
}

/** The outcome of {@link IIdempotencyStore.begin}. */
export type IdempotencyBeginResult =
  | {
      /** The key was free and is now claimed by the caller. */
      readonly claimed: true
      /** Proof of the claim, handed back to `complete` and `release`. */
      readonly token: string
    }
  | {
      /** The key was already held. */
      readonly claimed: false
      /** What the holder stored. */
      readonly record: IdempotencyRecord
    }

/**
 * The store of idempotency claims and answers.
 *
 * **Keys.** Every method is addressed by an already-hashed key: lower-case hexadecimal, 64
 * characters (SHA-256). The raw `Idempotency-Key` header never reaches a store, so a store may use
 * the key verbatim as a storage key.
 *
 * **Atomicity.** A store shared by several processes must make `begin` one atomic set-if-absent
 * carrying the lease as its expiry, and `complete` and `release` one compare-and-set on the token:
 * without that, two callers can both claim a key, or a late caller can overwrite a newer holder's
 * record.
 *
 * **Durations.** `leaseSeconds` and `ttlSeconds` are positive integers (a Redis `EX` argument
 * needs one); the interceptor validates them at boot, so a store may rely on it.
 *
 * **Failure.** A store that cannot answer REJECTS. It never returns `claimed: true` or an invented
 * record for a key it could not check. The interceptor maps a rejection to
 * `503 BYMAX_IDEMPOTENCY_STORE_UNAVAILABLE`, or runs the handler unprotected when the route opted
 * into `fail-open`. A store that refuses a new key because it is full is the same case, and
 * rejects.
 *
 * **Bounds.** The interceptor owns the size bounds and checks them before it calls `complete`: the
 * stored body is at most `maxBodyBytes` (default 64 KiB) and the serialised headers at most 65,536
 * bytes. A response over either bound is stored without its body and headers, so the record reads as
 * completed but not replayable, and a store never receives an oversized value. A store may still
 * enforce its own limit; its `complete` then rejects.
 *
 * **A rejected `complete`.** The claim is not released: it stays until its lease ends, so the key
 * never runs twice at once, and the client receives the handler's own response. The interceptor
 * logs a warning. A retry in that window is told the request is in progress.
 *
 * **Lease.** A claim whose holder never answers, or whose answer was lost after the handler
 * succeeded, stays `in_progress` until its lease ends: a retry in that window is told the request
 * is in progress. Choose the lease with that wait in mind.
 */
export interface IIdempotencyStore {
  /**
   * Claim `key` for `fingerprint`, or report what already holds it.
   *
   * @param key - The hashed storage key.
   * @param fingerprint - The fingerprint of the request claiming the key.
   * @param leaseSeconds - How long the claim lives if the holder never completes or releases it.
   * @returns The new claim's token, or the record that holds the key.
   */
  begin(key: string, fingerprint: string, leaseSeconds: number): Promise<IdempotencyBeginResult>

  /**
   * Turn the claim into a completed record, only while `token` still holds the key and the record
   * is still `in_progress`.
   *
   * @param key - The hashed storage key.
   * @param token - The token `begin` returned.
   * @param response - The answer to store.
   * @param ttlSeconds - How long the completed record lives.
   * @returns `true` when the record was written. `false` when nothing was written: the claim
   *   expired, another holder took the key over, or the record is already completed.
   */
  complete(
    key: string,
    token: string,
    response: IdempotencyStoredResponse,
    ttlSeconds: number
  ): Promise<boolean>

  /**
   * Drop the claim so the request can be retried, only while `token` still holds the key and the
   * record is still `in_progress`. A completed record is never dropped, so a late release on an
   * error path cannot make finished work run twice.
   *
   * @param key - The hashed storage key.
   * @param token - The token `begin` returned.
   * @returns `true` when the claim was dropped. `false` when nothing was dropped: the claim
   *   expired, another holder took the key over, or the record is already completed.
   */
  release(key: string, token: string): Promise<boolean>
}
