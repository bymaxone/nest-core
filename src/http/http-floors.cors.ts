/**
 * @fileoverview The CORS allowlist of `applyHttpFloors`: its options, and their validation into the
 * options Nest hands the `cors` middleware. Nothing here is applied; the caller registers the result.
 * @layer Bootstrap
 */
import type {
  CorsOptions,
  CorsOptionsDelegate
} from '@nestjs/common/interfaces/external/cors-options.interface'

import { builtinsAltered } from '../object-prototype'
import { booleanOption, checkedBlock, refusal } from '../option-validation'
import { positiveSafeInteger } from '../positive-integer'

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

/** The options of {@link HttpFloorsCorsOptions}; the compiler keeps this table complete. */
export const CORS_KEYS = {
  origins: 0,
  credentials: 0,
  methods: 0,
  allowedHeaders: 0,
  exposedHeaders: 0,
  maxAgeSeconds: 0
} satisfies Record<keyof HttpFloorsCorsOptions, 0>

/** The methods `cors` answers a preflight with when the host lists none. */
const CORS_DEFAULT_METHODS = 'GET,HEAD,PUT,PATCH,POST,DELETE'

/** The methods `cors.methods` may list, in the exact case a browser compares them. */
const HTTP_METHODS: readonly string[] = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']

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

/** What an HTTP header name may be made of: a token, with no space, colon, line break or control character. */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

/**
 * A copy of the list an option holds, or `undefined` when it is unset. An empty slot of a sparse list counts as
 * an entry that is not a string: `some` and `find` would skip it and let it become an empty item of a
 * header. An entry is named by its position and never shown.
 *
 * @throws Error When the value is set and is not a list of non-empty strings.
 */
function namesOf(name: string, value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) throw refusal(`cors.${name}`, 'a list of strings', value)
  const list = Array.from(value as readonly unknown[])
  list.forEach((entry, index) => {
    if (typeof entry !== 'string' || entry.trim() === '') {
      throw new Error(`cors.${name} entry ${index + 1} must be a non-empty string`)
    }
  })
  return list as string[]
}

/** Throws at the first entry of `list` that `isValid` refuses, naming the entry by position. */
function assertEntries(
  name: string,
  list: readonly string[] | undefined,
  isValid: (entry: string) => boolean,
  expected: string
): void {
  const bad = list?.findIndex((entry) => !isValid(entry)) ?? -1
  if (bad >= 0) throw new Error(`cors.${name} entry ${bad + 1} is not ${expected}`)
}

/** Throws unless every origin is an exact origin, listed once, with no wildcard in its host. */
function assertOrigins(origins: readonly unknown[]): void {
  origins.forEach((origin, index) => {
    if (!isExactOrigin(origin)) {
      throw new Error(
        `cors.origins entry ${index + 1} is not an exact origin such as "https://app.example.com"`
      )
    }
    if (new URL(origin).hostname.includes(WILDCARD)) {
      throw new Error(
        `cors.origins entry ${index + 1} has a wildcard in its host: a pattern is not matched, list each origin`
      )
    }
  })
  if (new Set(origins).size !== origins.length) {
    throw new Error('cors.origins lists an origin more than once')
  }
}

/** The origins of the allowlist as a list, or throws when there is none or it is not a list. */
function originsOf(value: unknown): readonly unknown[] {
  if (value === undefined || (Array.isArray(value) && value.length === 0)) {
    throw new Error('cors.origins must list at least one origin')
  }
  if (!Array.isArray(value)) throw refusal('cors.origins', 'a list of origins', value)
  return Array.from(value as readonly unknown[])
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
 * @param given - The caller's CORS options.
 * @returns The delegate to register.
 * @throws Error When `cors` is not an object, has an unknown key, lists no origin or one twice, an
 *   entry is not an exact origin or has a wildcard in its host, a wildcard is mixed with other
 *   origins or with credentials, `credentials` is not a boolean, `methods` names no HTTP method, or a
 *   list or the max age is unusable.
 */
export function resolveCors(given: unknown): CorsOptionsDelegate<CorsRequest> {
  const cors = checkedBlock<HttpFloorsCorsOptions>('cors', given, CORS_KEYS)
  if (cors === undefined) {
    throw new Error('cors must be an object such as { origins: ["https://app.example.com"] }')
  }
  const origins = originsOf(cors.origins)
  const credentials = booleanOption('cors.credentials', cors.credentials, false)
  const methods = namesOf('methods', cors.methods)
  const allowedHeaders = namesOf('allowedHeaders', cors.allowedHeaders)
  const exposedHeaders = namesOf('exposedHeaders', cors.exposedHeaders)
  assertEntries('allowedHeaders', allowedHeaders, (name) => HEADER_NAME.test(name), 'a header name')
  assertEntries('exposedHeaders', exposedHeaders, (name) => HEADER_NAME.test(name), 'a header name')
  assertEntries(
    'methods',
    methods,
    (name) => HTTP_METHODS.includes(name),
    `one of ${HTTP_METHODS.join(', ')}`
  )
  const maxAge = cors.maxAgeSeconds ?? undefined
  if (maxAge !== undefined) positiveSafeInteger('cors.maxAgeSeconds', maxAge)
  const wildcard = origins.includes(WILDCARD)
  if (wildcard && origins.length > 1) {
    throw new Error(`cors.origins: "${WILDCARD}" must stand alone, not beside listed origins`)
  }
  if (wildcard && credentials) {
    throw new Error(`cors.origins "${WILDCARD}" cannot be combined with cors.credentials: true`)
  }
  if (!wildcard) assertOrigins(origins)
  // Every name `cors` reads is an own property, `undefined` when the host gave none, so a name planted on
  // `Object.prototype` afterwards answers none of them. `headers` is the alias `cors` falls back to.
  const offers = {
    credentials,
    methods: methods ?? CORS_DEFAULT_METHODS,
    allowedHeaders,
    headers: undefined,
    exposedHeaders,
    maxAge
  } as CorsOptions
  const listed: ReadonlySet<string> = new Set(origins as readonly string[])
  return (request, callback) => {
    if (builtinsAltered()) return callback(null, { origin: false }) // `listed.has` is not trusted
    if (wildcard) return callback(null, { ...offers, origin: WILDCARD })
    request.res?.vary?.('Origin')
    const origin = request.headers.origin
    callback(
      null,
      origin !== undefined && listed.has(origin) ? { ...offers, origin } : { origin: false }
    )
  }
}
