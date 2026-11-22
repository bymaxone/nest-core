/**
 * @fileoverview `applyHttpFloors`, the HTTP-level protections every backend wants and none should
 * tune per deployment: security headers without HSTS, compressed request bodies refused, and
 * timeouts that bound how long a client may hold a socket, enforced to within a second.
 *
 * Order is part of the contract. Call it before `app.init()`, right after the access log is installed
 * (`applyAccessLog` from `@bymax-one/nest-logger`) and before anything that reads the request:
 * helmet is mounted first so even a request the body parsers refuse carries the headers, and the
 * parsers are registered here so Nest's defaults (which accept gzip) are not. Cookie parsing, the
 * trusted-proxy setting and OpenAPI stay with the caller and go after this call.
 *
 * Express only. `helmet` is an optional peer, loaded when this runs.
 * @layer Bootstrap
 */
import type { INestApplication } from '@nestjs/common'
import type { HelmetOptions } from 'helmet'

import {
  booleanOption,
  checkedBlock,
  describeValue,
  isPlainRecord,
  refusal
} from '../option-validation'
import { MAX_TIMER_DELAY_MS, positiveSafeInteger } from '../positive-integer'
import { readOptions } from '../read-options'
import type { Shape } from '../read-options'
import { CORS_KEYS, resolveCors } from './http-floors.cors'
import type { HttpFloorsCorsOptions } from './http-floors.cors'
import { loadHelmet } from './http.loader'
import type { HelmetFactory } from './http.loader'

/** Longest a client may take to send its complete header block. */
const DEFAULT_HEADERS_TIMEOUT_MS = 15_000

/**
 * Longest the server takes to receive a request, headers and body together. It does not bound the
 * handler or the response: `server.timeout` stays zero so streams are not cut.
 */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

/** The `helmet()` options object; any option `helmet` accepts. */
export type HttpFloorsHelmetOptions = Readonly<Record<string, unknown>>

/** Options for {@link applyHttpFloors}. */
export interface HttpFloorsOptions {
  /**
   * Options handed to `helmet()`, over `{ strictTransportSecurity: false }` (TLS is normally
   * terminated in front of the application, which owns HSTS). A browser-serving backend tunes
   * `contentSecurityPolicy` here. `false` leaves helmet out entirely.
   */
  readonly helmet?: HttpFloorsHelmetOptions | false
  /**
   * Longest a client may take to send its complete header block before the socket is closed.
   * Positive integer, at most `requestTimeoutMs`. Default: `15000`.
   */
  readonly headersTimeoutMs?: number
  /**
   * Longest the server takes to receive a request, headers and body together; the handler and the
   * response are not bounded. Positive integer.
   * Default: `30000`.
   */
  readonly requestTimeoutMs?: number
  /**
   * How often the server sweeps its open connections for expired timeouts. Positive integer.
   * Default: `1000`, or `headersTimeoutMs` when that is shorter. Node enforces both timeouts from
   * this sweep rather than from a timer per connection, and its own default is `30000`, so a
   * `headersTimeoutMs` of 15 s would cut anywhere between 15 and 45 s. The sweep walks every open
   * connection each time, so a server holding very many sockets may set it higher, at the cost
   * of cutting up to that long after the timeout.
   */
  readonly connectionsCheckingIntervalMs?: number
  /**
   * How long an idle keep-alive connection is held open. Positive integer.
   * Default: `65000`. A server that closes an idle connection before the load balancer in front of
   * it does leaves the balancer reusing a socket that is gone, which it reports as a 502; the
   * common balancers idle out at 60 s, so the default is above that. Set it above your balancer's
   * own idle timeout (for example `620000` behind a Google Cloud HTTP(S) balancer, which holds
   * connections for 600 s). Node closes an idle connection about a second after this value, and
   * closing the server drops idle connections at once, so a long value does not delay shutdown.
   */
  readonly keepAliveTimeoutMs?: number
  /**
   * The largest request body each parser accepts, over the limit a larger body is refused with
   * `413` in the error envelope. A byte count (positive integer) or a size string such as `'100kb'`
   * or `'1mb'` (units `b`, `kb`, `mb`, `gb`). Both default to `'100kb'`, which is what Express's
   * parsers apply when nothing is set, stated here so the limit is a decision and not an accident.
   */
  readonly bodyLimit?: HttpFloorsBodyLimit
  /**
   * The CORS allowlist. Cross-origin access is off unless this is given: a browser from another
   * origin is refused by default and nothing is added to the response. See
   * {@link HttpFloorsCorsOptions}. The middleware is mounted right after helmet, ahead of the body
   * parsers, so a preflight and a refusal raised by a parser both carry the CORS headers.
   */
  readonly cors?: HttpFloorsCorsOptions
}

/** A body-size limit: bytes, or a size string such as `'100kb'`. */
export type HttpBodyLimit = number | string

/** The body-size limit of each parser; an omitted one keeps `'100kb'`. */
export interface HttpFloorsBodyLimit {
  /** The JSON parser's limit. */
  readonly json?: HttpBodyLimit
  /** The urlencoded parser's limit. */
  readonly urlencoded?: HttpBodyLimit
}

/** What Express's body parsers accept when no limit is configured. */
const DEFAULT_BODY_LIMIT = '100kb'

/** The idle keep-alive default: above the 60 s idle timeout of the common load balancers. */
const DEFAULT_KEEP_ALIVE_TIMEOUT_MS = 65_000

/** A size string: a number, optionally fractional, and one of the units in {@link SIZE_UNITS}. */
const SIZE_STRING = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)$/i

/** The longest the sweep interval defaults to; a shorter header timeout shortens it further. */
const DEFAULT_CONNECTIONS_CHECKING_INTERVAL_MS = 1_000

/** The parts of the Node HTTP server this helper reads or sets. */
interface FloorsServer {
  listening: boolean
  headersTimeout: number
  requestTimeout: number
  keepAliveTimeout: number
  connectionsCheckingInterval: number
}

/** The parts of an Express-backed application this helper touches. */
interface ExpressApplicationShape {
  use(handler: unknown): unknown
  enableCors(options: unknown): unknown
  useBodyParser(type: 'json' | 'urlencoded', options: Record<string, unknown>): unknown
  getHttpServer(): FloorsServer
  getHttpAdapter(): { getType?: () => string }
  isInitialized?: boolean
}

/**
 * The largest body limit accepted: 256 MiB, half of V8's longest string (`MAX_STRING_LENGTH`,
 * 536870888 characters on Node 24). The JSON parser holds the whole body as one string, so a limit
 * beyond that cannot be honoured, and nothing sent as JSON or urlencoded form is meant to be that
 * large: an upload of that size is streamed, not parsed.
 */
const MAX_BODY_LIMIT_BYTES = 256 * 1024 ** 2

/** The units a size string may use, each 1024 times the one before. */
const SIZE_UNITS = ['b', 'kb', 'mb', 'gb']

/**
 * The whole number of bytes a limit comes to, so the parser is handed a number and never reads a
 * string of its own: its reading rounds a fraction down and lets an enormous value through.
 * Throws unless that is a positive safe integer.
 */
function limitInBytes(name: string, value: unknown): number {
  const bytes =
    typeof value === 'number' ? value : typeof value === 'string' ? sizeInBytes(value) : Number.NaN
  if (!Number.isSafeInteger(bytes) || bytes < 1) {
    throw new Error(
      `${name} must be a positive byte count or a size such as '100kb', received ${describeValue(value)}`
    )
  }
  if (bytes > MAX_BODY_LIMIT_BYTES) {
    throw new Error(`${name} must be at most 256mb`)
  }
  return bytes
}

/** The options of {@link HttpFloorsBodyLimit}; the compiler keeps this table complete. */
const BODY_LIMIT_KEYS = { json: 0, urlencoded: 0 } satisfies Record<keyof HttpFloorsBodyLimit, 0>

/** The options of {@link HttpFloorsOptions}; the compiler keeps this table complete. */
const FLOORS_KEYS = {
  helmet: 0,
  headersTimeoutMs: 0,
  requestTimeoutMs: 0,
  connectionsCheckingIntervalMs: 0,
  keepAliveTimeoutMs: 0,
  bodyLimit: 0,
  cors: 0
} satisfies Record<keyof HttpFloorsOptions, 0>

/**
 * The names `helmet` documents as options, aliases included. `helmet` ignores a name it does not
 * know, so a misspelt one would silently leave a header on its default; a test pins this list to
 * the installed `helmet`.
 */
export const HELMET_OPTION_NAMES: readonly string[] = [
  'contentSecurityPolicy',
  'crossOriginEmbedderPolicy',
  'crossOriginOpenerPolicy',
  'crossOriginResourcePolicy',
  'dnsPrefetchControl',
  'frameguard',
  'hidePoweredBy',
  'hsts',
  'ieNoOpen',
  'noSniff',
  'originAgentCluster',
  'permittedCrossDomainPolicies',
  'referrerPolicy',
  'strictTransportSecurity',
  'xContentTypeOptions',
  'xDnsPrefetchControl',
  'xDownloadOptions',
  'xFrameOptions',
  'xPermittedCrossDomainPolicies',
  'xPoweredBy',
  'xXssProtection',
  'xssFilter'
]

/** The names of every setting an option of `helmet` takes: what is left of its type once `true` and `false` are taken away. */
type HelmetSettingNames = {
  [Name in keyof HelmetOptions]-?: Exclude<
    NonNullable<HelmetOptions[Name]>,
    boolean
  > extends infer Settings
    ? Settings extends unknown
      ? keyof Settings
      : never
    : never
}[keyof HelmetOptions]

/** The settings `helmet` options take; the compiler keeps it complete. */
const HELMET_SETTINGS = {
  reportOnly: 0,
  useDefaults: 0,
  directives: 1,
  policy: 0,
  maxAge: 0,
  includeSubDomains: 0,
  preload: 0,
  allow: 0,
  action: 0,
  permittedPolicies: 0
} satisfies Record<HelmetSettingNames, 0 | 1>

/** What `applyHttpFloors` reads by name: its options, and the blocks inside them. */
const FLOORS_SHAPE: Shape = {
  ...FLOORS_KEYS,
  helmet: Object.fromEntries(HELMET_OPTION_NAMES.map((name) => [name, HELMET_SETTINGS])),
  bodyLimit: BODY_LIMIT_KEYS,
  cors: CORS_KEYS
}

/**
 * The options handed to `helmet`: an object of helmet's own option names, or `false` to leave it out.
 * An option left `undefined` is dropped, so it reads as unset and not as a value; `null` is refused,
 * because a `null` that comes from configuration must not silently switch a header off.
 *
 * @throws Error When the value is not an object or `false`, or names an option `helmet` does not have.
 */
function resolveHelmet(given: unknown): Record<string, unknown> | false {
  if (given === false) return false
  if (given === undefined || given === null) return withSettings([])
  if (!isPlainRecord(given)) throw refusal('helmet', 'an object or false', given)
  checkedBlock('helmet', given, Object.fromEntries(HELMET_OPTION_NAMES.map((name) => [name, 0])))
  return withSettings(
    HELMET_OPTION_NAMES.flatMap((name) => {
      const value: unknown = Reflect.get(given, name)
      if (value === null) {
        throw new Error(
          `helmet.${name} must not be null: leave it out, or give an object, true or false`
        )
      }
      if (value === undefined) return []
      assertHelmetOption(name, value)
      return [[name, value]]
    })
  )
}

/** Each option of `helmet` that takes settings, with its aliases, and whether it is on when left out. */
const SETTINGS_OPTIONS: ReadonlyArray<readonly [readonly string[], boolean]> = [
  [['contentSecurityPolicy'], true],
  [['crossOriginEmbedderPolicy'], false],
  [['crossOriginOpenerPolicy'], true],
  [['crossOriginResourcePolicy'], true],
  [['referrerPolicy'], true],
  [['strictTransportSecurity', 'hsts'], false],
  [['xDnsPrefetchControl', 'dnsPrefetchControl'], true],
  [['xFrameOptions', 'frameguard'], true],
  [['xPermittedCrossDomainPolicies', 'permittedCrossDomainPolicies'], true]
]

/**
 * The options as `helmet` is handed them, with each one that takes settings and is on holding its own
 * settings object. `helmet` reads a name of the settings it was not given from the object it is handed,
 * and falls back to an object of its own where there is none, which would answer with whatever was
 * planted on `Object.prototype`. An alias given on its own stays as given: `helmet` refuses both.
 */
function withSettings(entries: ReadonlyArray<readonly [string, unknown]>): Record<string, unknown> {
  const options = bare(entries)
  for (const [names, on] of SETTINGS_OPTIONS) {
    const named = names.find((name) => name in options)
    if (named === undefined) {
      if (on) options[names[0] as string] = bare([])
    } else if (options[named] === true) {
      options[named] = bare([])
    }
  }
  return options
}

/**
 * An object of `entries` with no prototype. `helmet` reads a name it was not given (`contentSecurityPolicy`,
 * `reportOnly`, ...) and tests aliases with `in`, so an object that inherits from `Object.prototype` would
 * answer with whatever was planted there.
 */
function bare(entries: ReadonlyArray<readonly [string, unknown]>): Record<string, unknown> {
  return Object.assign(Object.create(null) as Record<string, unknown>, Object.fromEntries(entries))
}

/** The helmet options that are switches and take no settings, aliases included. */
const HELMET_SWITCHES: readonly string[] = [
  'hidePoweredBy',
  'ieNoOpen',
  'noSniff',
  'originAgentCluster',
  'xContentTypeOptions',
  'xDownloadOptions',
  'xPoweredBy',
  'xXssProtection',
  'xssFilter'
]

/**
 * Throws unless a helmet option has the type helmet documents for it: a switch is `true` or `false`,
 * and any other takes those or an object of settings. What is inside an object is `helmet`'s to
 * check; see {@link helmetOrRefusal}.
 */
function assertHelmetOption(name: string, value: unknown): void {
  if (HELMET_SWITCHES.includes(name)) {
    if (typeof value !== 'boolean') throw refusal(`helmet.${name}`, 'true or false', value)
  } else if (typeof value !== 'boolean' && !isPlainRecord(value)) {
    throw refusal(`helmet.${name}`, 'an object, true or false', value)
  }
}

/**
 * Build the helmet middleware, with a refusal of its own in place of `helmet`'s: `helmet` quotes the
 * value it refuses, which may be a secret, so the option is found by trying each on its own and only
 * its name is reported.
 */
function helmetOrRefusal(
  helmet: HelmetFactory,
  options: Record<string, unknown>
): ReturnType<HelmetFactory> {
  try {
    return helmet(options)
  } catch {
    const culprit = Object.entries(options).find(([name, value]) => {
      try {
        helmet(bare([[name, value]]))
        return false
      } catch {
        return true
      }
    })
    throw new Error(
      culprit === undefined
        ? 'helmet refused the options given; see the helmet documentation for the values it accepts'
        : `helmet refused its ${culprit[0]} option; see the helmet documentation for the values it accepts`
    )
  }
}

/** The whole number of bytes a size string comes to, or `NaN` when it is not one. */
function sizeInBytes(value: string): number {
  const size = SIZE_STRING.exec(value)
  // Stryker disable next-line StringLiteral: equivalent — the pattern always captures a unit, and with no match the amount is `NaN` whatever the power, so the fallback is never read and only satisfies the index type.
  const power = SIZE_UNITS.indexOf((size?.[2] ?? '').toLowerCase())
  return Math.floor(Number(size?.[1]) * 1024 ** power)
}

/** The settings of one call, every default applied and every value checked. */
interface ResolvedFloors {
  readonly headersTimeoutMs: number
  readonly requestTimeoutMs: number
  readonly checkingIntervalMs: number
  readonly keepAliveTimeoutMs: number
  readonly jsonLimit: number
  readonly urlencodedLimit: number
  readonly cors: ReturnType<typeof resolveCors> | undefined
  readonly helmet: Record<string, unknown> | false
}

/** Applies the defaults and checks every value, so nothing is applied on a bad one. */
function resolveFloors(given: unknown): ResolvedFloors {
  const options = checkedBlock<HttpFloorsOptions>(
    'options',
    readOptions(given, FLOORS_SHAPE) ?? {},
    FLOORS_KEYS
  ) as HttpFloorsOptions
  const headersTimeoutMs = options.headersTimeoutMs ?? DEFAULT_HEADERS_TIMEOUT_MS
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  positiveSafeInteger('headersTimeoutMs', headersTimeoutMs)
  positiveSafeInteger('requestTimeoutMs', requestTimeoutMs)
  if (headersTimeoutMs > requestTimeoutMs) {
    throw new Error(
      `headersTimeoutMs (${headersTimeoutMs}) must not exceed requestTimeoutMs (${requestTimeoutMs})`
    )
  }
  const checkingIntervalMs =
    options.connectionsCheckingIntervalMs ??
    Math.min(DEFAULT_CONNECTIONS_CHECKING_INTERVAL_MS, headersTimeoutMs)
  positiveSafeInteger('connectionsCheckingIntervalMs', checkingIntervalMs, MAX_TIMER_DELAY_MS)
  const keepAliveTimeoutMs = options.keepAliveTimeoutMs ?? DEFAULT_KEEP_ALIVE_TIMEOUT_MS
  positiveSafeInteger('keepAliveTimeoutMs', keepAliveTimeoutMs, MAX_TIMER_DELAY_MS)
  const bodyLimit = checkedBlock<HttpFloorsBodyLimit>(
    'bodyLimit',
    options.bodyLimit,
    BODY_LIMIT_KEYS
  )
  const jsonLimit = limitInBytes('bodyLimit.json', bodyLimit?.json ?? DEFAULT_BODY_LIMIT)
  const urlencodedLimit = limitInBytes(
    'bodyLimit.urlencoded',
    bodyLimit?.urlencoded ?? DEFAULT_BODY_LIMIT
  )
  const cors =
    options.cors === undefined || options.cors === null ? undefined : resolveCors(options.cors)
  return {
    cors,
    helmet: resolveHelmet(options.helmet),
    headersTimeoutMs,
    requestTimeoutMs,
    checkingIntervalMs,
    keepAliveTimeoutMs,
    jsonLimit,
    urlencodedLimit
  }
}

/**
 * Check the application can still take the floors, and return its HTTP server.
 *
 * @param express - The application, viewed as the Express-backed shape this helper uses.
 * @returns The underlying HTTP server.
 * @throws Error When the adapter is not Express, the server is listening, or the application is
 * already initialised.
 */
function assertBootstrapState(express: ExpressApplicationShape): FloorsServer {
  if (express.getHttpAdapter().getType?.() !== 'express') {
    throw new Error('applyHttpFloors supports the Express adapter only')
  }
  const server = express.getHttpServer()
  if (server.listening) {
    throw new Error('applyHttpFloors must run before listen(): the server is already listening')
  }
  if (express.isInitialized === true) {
    // Nest registers its own parsers and the routes during init, ahead of anything mounted later,
    // so a late call would apply only the timeouts.
    throw new Error(
      'applyHttpFloors must run before app.init(): the application is already initialised'
    )
  }
  return server
}

/**
 * Apply the HTTP floors to an Express application. Call it before `app.init()` or `listen`.
 *
 * @param app - The Nest application, created on the Express adapter.
 * @param options - Overrides for the helmet options, the timeouts and the body-size limits.
 * @throws Error When a timeout is unusable, the application is not on Express, or `helmet` is
 * needed and not installed. Nothing is applied in those cases.
 */
export async function applyHttpFloors(
  app: INestApplication,
  options: HttpFloorsOptions = {}
): Promise<void> {
  const floors = resolveFloors(options)
  const express = app as unknown as ExpressApplicationShape
  const server = assertBootstrapState(express)
  const given = floors.helmet
  if (given !== false) {
    const helmet = await loadHelmet()
    // helmet accepts `hsts` as an alias of `strictTransportSecurity` and throws when both are
    // present, so the default is left out when the caller used the alias. The caller's own
    // `strictTransportSecurity` needs no such care: it overrides the default by position.
    express.use(
      helmetOrRefusal(
        helmet,
        'hsts' in given
          ? given
          : bare([['strictTransportSecurity', false], ...Object.entries(given)])
      )
    )
  }
  if (floors.cors !== undefined) {
    express.enableCors(floors.cors)
  }
  // A compressed body is refused with 415 on every route and before routing; the extended form
  // syntax is kept, and each parser has its own explicit size limit.
  express.useBodyParser('json', { inflate: false, limit: floors.jsonLimit })
  express.useBodyParser('urlencoded', {
    inflate: false,
    extended: true,
    limit: floors.urlencodedLimit
  })
  server.headersTimeout = floors.headersTimeoutMs
  server.requestTimeout = floors.requestTimeoutMs
  server.keepAliveTimeout = floors.keepAliveTimeoutMs
  // Node stores this property when the server is built and reads it when the server emits
  // 'listening' (`setupConnectionsTracking` in `lib/_http_server.js`, Node 24), which is why the
  // helper must run before `listen`. Its typings do not declare it; the end-to-end suite fails if
  // a Node release stops honouring it.
  server.connectionsCheckingInterval = floors.checkingIntervalMs
}
