/**
 * @fileoverview The CORS allowlist of `applyHttpFloors`: its options, and their validation into the
 * options Nest hands the `cors` middleware. Nothing here is applied; the caller registers the result.
 * @layer Bootstrap
 */
import type {
  CorsOptions,
  CorsOptionsDelegate
} from '@nestjs/common/interfaces/external/cors-options.interface'

/** The CORS allowlist. Cross-origin access is off unless this is given. */
export interface HttpFloorsCorsOptions {
  /**
   * The origins allowed to call this application from a browser: each an exact origin as a browser
   * sends it (`'https://app.example.com'`, `'http://localhost:3000'`), with no path, no trailing
   * slash, no user info and a lower-case host. A request from any other origin gets no
   * `Access-Control-Allow-Origin` header. Matching is exact, so `https://app.example.com` does not
   * admit `https://app.example.com.evil.test` or another port. At least one is required.
   *
   * `['*']` alone allows every origin and cannot be combined with `credentials`.
   */
  readonly origins: readonly string[]
  /**
   * Whether a browser may send cookies and `Authorization` with a cross-origin request
   * (`Access-Control-Allow-Credentials: true`). Default: `false`. Refused at boot together with `'*'`.
   */
  readonly credentials?: boolean
  /** Methods allowed on a preflight. Default: the `cors` middleware's own. */
  readonly methods?: readonly string[]
  /** Request headers allowed on a preflight. Default: the ones the preflight asked for. */
  readonly allowedHeaders?: readonly string[]
  /** Response headers a browser may read. Default: none beyond the safelisted ones. */
  readonly exposedHeaders?: readonly string[]
  /** How long a browser may cache a preflight answer, in seconds. Positive integer. Default: unset. */
  readonly maxAgeSeconds?: number
}

const WILDCARD = '*'

/** The keys {@link HttpFloorsCorsOptions} has; anything else is a typo that would silently do nothing. */
const CORS_KEYS: ReadonlySet<string> = new Set([
  'origins',
  'credentials',
  'methods',
  'allowedHeaders',
  'exposedHeaders',
  'maxAgeSeconds'
])

/** The methods `cors.methods` may list, in the exact case a browser compares them. */
const HTTP_METHODS: ReadonlySet<string> = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS'
])

/** The parts of an Express request the delegate reads and writes. */
interface CorsRequest {
  readonly headers: { readonly origin?: string }
  readonly res?: { vary?(field: string): unknown }
}

/** Whether `origin` is a string that equals the origin a browser would send for it. */
function isExactOrigin(origin: unknown): origin is string {
  if (typeof origin !== 'string') return false
  try {
    const url = new URL(origin)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === origin
  } catch {
    return false
  }
}

/** Throws unless `value` is a list of non-blank strings. */
function assertNames(name: string, value: readonly string[]): void {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || item.trim() === '')
  ) {
    throw new Error(`cors.${name} must be a list of non-empty strings`)
  }
}

/**
 * The entries whose value is set. An option left out must stay out, not be present as `undefined`:
 * the `cors` middleware lets a present key override its own default.
 */
function withoutUndefined<T extends object>(
  entries: T
): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>
  }
}

/** Throws unless every origin is an exact origin, listed once, with no wildcard in its host. */
function assertOrigins(origins: readonly string[]): void {
  const bad = origins.find((origin) => !isExactOrigin(origin))
  if (bad !== undefined) {
    throw new Error(
      `cors.origins entry ${JSON.stringify(bad)} is not an exact origin such as "https://app.example.com"`
    )
  }
  const wild = origins.find((origin) => new URL(origin).hostname.includes(WILDCARD))
  if (wild !== undefined) {
    throw new Error(
      `cors.origins entry ${JSON.stringify(wild)} has a wildcard in its host: a pattern is not matched, list each origin`
    )
  }
  if (new Set(origins).size !== origins.length) {
    throw new Error('cors.origins lists an origin more than once')
  }
}

/** Throws on a key that is not an option, a `methods` entry that is not an HTTP method, or a bad max age. */
function assertShape(cors: HttpFloorsCorsOptions): void {
  const unknown = Object.keys(cors).find((key) => !CORS_KEYS.has(key))
  if (unknown !== undefined) {
    throw new Error(`cors has an unknown key ${JSON.stringify(unknown)}`)
  }
  for (const [name, list] of [
    ['methods', cors.methods],
    ['allowedHeaders', cors.allowedHeaders],
    ['exposedHeaders', cors.exposedHeaders]
  ] as const) {
    if (list !== undefined) assertNames(name, list)
  }
  const method = cors.methods?.find((name) => !HTTP_METHODS.has(name))
  if (method !== undefined) {
    throw new Error(
      `cors.methods entry ${JSON.stringify(method)} is not one of ${[...HTTP_METHODS].join(', ')}`
    )
  }
  const age = cors.maxAgeSeconds ?? undefined
  if (age !== undefined && (!Number.isSafeInteger(age) || age < 1)) {
    throw new Error(`cors.maxAgeSeconds must be a positive integer, received ${String(age)}`)
  }
}

/**
 * Check the allowlist and turn it into the options delegate of `app.enableCors`.
 *
 * For a listed origin the delegate offers everything configured. For any other request, one with
 * another origin or none, it offers nothing: no allow-origin, no credentials, no preflight methods,
 * headers or max age, and no exposed headers, and an `OPTIONS` request is left to the application.
 * With a list of origins `Vary: Origin` is set on every response, so a cache does not serve one
 * origin's answer to another.
 *
 * @param cors - The caller's CORS options.
 * @returns The delegate to register.
 * @throws Error When `cors` is not an object, has an unknown key, lists no origin or one twice, an
 *   entry is not an exact origin or has a wildcard in its host, a wildcard is mixed with other
 *   origins or with credentials, `credentials` is not a boolean, `methods` names no HTTP method, or a
 *   list or the max age is unusable.
 */
export function resolveCors(cors: HttpFloorsCorsOptions): CorsOptionsDelegate<CorsRequest> {
  if (typeof cors !== 'object' || cors === null || Array.isArray(cors)) {
    throw new Error('cors must be an object such as { origins: ["https://app.example.com"] }')
  }
  assertShape(cors)
  const { origins } = cors
  const credentials = cors.credentials ?? false
  if (typeof credentials !== 'boolean') {
    throw new Error(`cors.credentials must be true or false, received ${String(credentials)}`)
  }
  if (!Array.isArray(origins) || origins.length === 0) {
    throw new Error('cors.origins must list at least one origin')
  }
  const wildcard = origins.includes(WILDCARD)
  if (wildcard && origins.length > 1) {
    throw new Error(`cors.origins: "${WILDCARD}" must stand alone, not beside listed origins`)
  }
  if (wildcard && credentials) {
    throw new Error(`cors.origins "${WILDCARD}" cannot be combined with cors.credentials: true`)
  }
  if (!wildcard) assertOrigins(origins)
  const offers: CorsOptions = {
    credentials,
    ...withoutUndefined({
      methods: cors.methods?.slice(),
      allowedHeaders: cors.allowedHeaders?.slice(),
      exposedHeaders: cors.exposedHeaders?.slice(),
      maxAge: cors.maxAgeSeconds ?? undefined
    })
  }
  const listed: ReadonlySet<string> = new Set(origins)
  return (request, callback) => {
    if (wildcard) return callback(null, { ...offers, origin: WILDCARD })
    request.res?.vary?.('Origin')
    const origin = request.headers.origin
    callback(
      null,
      origin !== undefined && listed.has(origin) ? { ...offers, origin } : { origin: false }
    )
  }
}
