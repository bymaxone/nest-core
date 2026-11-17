/**
 * @fileoverview The CORS allowlist of `applyHttpFloors`: its options, and their validation into the
 * options Nest hands the `cors` middleware. Nothing here is applied; the caller registers the result.
 * @layer Bootstrap
 */
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface'

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
  /** Methods allowed on a preflight. Default: the `cors` middleware's own (`GET,HEAD,PUT,PATCH,POST,DELETE`). */
  readonly methods?: readonly string[]
  /** Request headers allowed on a preflight. Default: the ones the preflight asked for. */
  readonly allowedHeaders?: readonly string[]
  /** Response headers a browser may read. Default: none beyond the safelisted ones. */
  readonly exposedHeaders?: readonly string[]
  /** How long a browser may cache a preflight answer, in seconds. Positive integer. Default: unset. */
  readonly maxAgeSeconds?: number
}

const WILDCARD = '*'

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
 * Check the allowlist and turn it into the options of `app.enableCors`.
 *
 * @param cors - The caller's CORS options.
 * @returns The options to register.
 * @throws Error When the list is empty, an entry is not an exact origin, a wildcard is mixed with
 *   other origins or with credentials, or a list or the max age is unusable.
 */
export function resolveCors(cors: HttpFloorsCorsOptions): CorsOptions {
  const { origins, credentials = false, maxAgeSeconds } = cors
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
  const bad = wildcard ? undefined : origins.find((origin) => !isExactOrigin(origin))
  if (bad !== undefined) {
    throw new Error(
      `cors.origins entry ${JSON.stringify(bad)} is not an exact origin such as "https://app.example.com"`
    )
  }
  for (const [name, list] of [
    ['methods', cors.methods],
    ['allowedHeaders', cors.allowedHeaders],
    ['exposedHeaders', cors.exposedHeaders]
  ] as const) {
    if (list !== undefined) assertNames(name, list)
  }
  if (maxAgeSeconds !== undefined && (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 1)) {
    throw new Error(
      `cors.maxAgeSeconds must be a positive integer, received ${String(maxAgeSeconds)}`
    )
  }
  return {
    origin: wildcard ? WILDCARD : [...origins],
    credentials,
    ...(cors.methods === undefined ? {} : { methods: [...cors.methods] }),
    ...(cors.allowedHeaders === undefined ? {} : { allowedHeaders: [...cors.allowedHeaders] }),
    ...(cors.exposedHeaders === undefined ? {} : { exposedHeaders: [...cors.exposedHeaders] }),
    ...(maxAgeSeconds === undefined ? {} : { maxAge: maxAgeSeconds })
  }
}
