/**
 * @fileoverview The options of an idempotent route and their boot-time validation.
 * @layer Configuration
 */
import { positiveSafeInteger } from '../positive-integer'

/** The longest a completed answer may be kept: seven days. */
export const MAX_IDEMPOTENCY_TTL_SECONDS = 7 * 24 * 60 * 60

/** What a store does when it cannot answer. */
export type IdempotencyStoreErrorMode = 'fail-open' | 'fail-closed'

/** The part of a request the scope function reads. */
export interface IdempotencyRequest {
  readonly headers?: Readonly<Record<string, unknown>>
  readonly user?: unknown
  readonly [name: string]: unknown
}

/** Options shared by every idempotent route. */
interface IdempotentCommon {
  /** Fail with `400` when the header is missing; default `false`, which runs the handler unprotected. */
  readonly required?: boolean
  /** How long an unfinished claim lives; must exceed the longest handler. Default 60. */
  readonly leaseSeconds?: number
  /** How long a completed answer is kept. Default 86 400 (24 h), at most 604 800 (7 d). */
  readonly ttlSeconds?: number
  /** The largest answer body kept for replay, in bytes. Default 65 536. */
  readonly maxBodyBytes?: number
  /** Whether a replayable `4xx` answer is stored. Default `true`. */
  readonly storeClientErrors?: boolean
  /** What happens when the store cannot answer. Default `'fail-open'`; `required` always fails closed. */
  readonly onStoreError?: IdempotencyStoreErrorMode
}

/** A route whose keys are namespaced by the caller `scope` returns. */
export interface ScopedIdempotentOptions extends IdempotentCommon {
  /** The caller's identity, non-empty; a result that is not, or a throw, fails the request closed. */
  readonly scope: (request: IdempotencyRequest) => string
  readonly unscoped?: undefined
}

/** A route whose keys are one namespace shared by every caller; unsafe for per-user data. */
export interface UnscopedIdempotentOptions extends IdempotentCommon {
  readonly unscoped: true
  readonly scope?: undefined
}

/** Options of `@Idempotent`: a `scope`, or `unscoped: true` spelled out. */
export type IdempotentOptions = ScopedIdempotentOptions | UnscopedIdempotentOptions

/** The options with every default applied. */
export interface ResolvedIdempotentOptions {
  readonly scope: ((request: IdempotencyRequest) => string) | undefined
  readonly required: boolean
  readonly leaseSeconds: number
  readonly ttlSeconds: number
  readonly maxBodyBytes: number
  readonly storeClientErrors: boolean
  readonly onStoreError: IdempotencyStoreErrorMode
}

/**
 * Validate `options` and apply the defaults.
 *
 * @param options - What the route declared.
 * @returns The resolved options.
 * @throws Error When a duration or size is not a positive integer in range, the lease outlives the
 *   answer's lifetime, or the scope is neither a function nor `unscoped: true`.
 */
export function resolveIdempotentOptions(options: IdempotentOptions): ResolvedIdempotentOptions {
  const { scope, unscoped } = options
  if (scope === undefined && unscoped !== true) {
    throw new Error('@Idempotent needs a `scope` function, or `unscoped: true` spelled out')
  }
  if (scope !== undefined && (typeof scope !== 'function' || unscoped !== undefined)) {
    throw new Error('@Idempotent takes `scope` as a function and never together with `unscoped`')
  }
  const leaseSeconds = positiveSafeInteger(
    'idempotent.leaseSeconds',
    options.leaseSeconds ?? 60,
    MAX_IDEMPOTENCY_TTL_SECONDS
  )
  const ttlSeconds = positiveSafeInteger(
    'idempotent.ttlSeconds',
    options.ttlSeconds ?? 86_400,
    MAX_IDEMPOTENCY_TTL_SECONDS
  )
  if (leaseSeconds > ttlSeconds) {
    throw new Error('idempotent.leaseSeconds must not exceed idempotent.ttlSeconds')
  }
  const onStoreError = options.onStoreError ?? 'fail-open'
  if (onStoreError !== 'fail-open' && onStoreError !== 'fail-closed') {
    throw new Error("idempotent.onStoreError must be 'fail-open' or 'fail-closed'")
  }
  return {
    scope,
    required: options.required === true,
    leaseSeconds,
    ttlSeconds,
    maxBodyBytes: positiveSafeInteger('idempotent.maxBodyBytes', options.maxBodyBytes ?? 65_536),
    storeClientErrors: options.storeClientErrors !== false,
    onStoreError
  }
}
