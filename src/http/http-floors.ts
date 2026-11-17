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

import { loadHelmet } from './http.loader'

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

/** The longest idle keep-alive default: above the 60 s idle timeout of the common load balancers. */
const DEFAULT_KEEP_ALIVE_TIMEOUT_MS = 65_000

/** A size string the body parsers read: a number and one of these units. */
const SIZE_STRING = /^(\d+(?:\.\d+)?)\s*(?:b|kb|mb|gb)$/i

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
  useBodyParser(type: 'json' | 'urlencoded', options: Record<string, unknown>): unknown
  getHttpServer(): FloorsServer
  getHttpAdapter(): { getType?: () => string }
  isInitialized?: boolean
}

/**
 * Check a timeout is a positive integer.
 *
 * @param name - The option name, for the message.
 * @param value - The configured value.
 * @throws Error When the value is not a positive safe integer.
 */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer, received ${String(value)}`)
  }
}

/** Throws unless the limit is a positive byte count or a positive size string. */
function assertBodyLimit(name: string, value: HttpBodyLimit): void {
  const size = typeof value === 'string' ? SIZE_STRING.exec(value) : null
  const positive =
    typeof value === 'number'
      ? Number.isSafeInteger(value) && value >= 1
      : size !== null && Number(size[1]) > 0
  if (!positive) {
    throw new Error(
      `${name} must be a positive byte count or a size such as '100kb', received ${String(value)}`
    )
  }
}

/** The settings of one call, every default applied and every value checked. */
interface ResolvedFloors {
  readonly headersTimeoutMs: number
  readonly requestTimeoutMs: number
  readonly checkingIntervalMs: number
  readonly keepAliveTimeoutMs: number
  readonly jsonLimit: HttpBodyLimit
  readonly urlencodedLimit: HttpBodyLimit
}

/** Applies the defaults and checks every value, so nothing is applied on a bad one. */
function resolveFloors(options: HttpFloorsOptions): ResolvedFloors {
  const headersTimeoutMs = options.headersTimeoutMs ?? DEFAULT_HEADERS_TIMEOUT_MS
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  assertPositiveInteger('headersTimeoutMs', headersTimeoutMs)
  assertPositiveInteger('requestTimeoutMs', requestTimeoutMs)
  if (headersTimeoutMs > requestTimeoutMs) {
    throw new Error(
      `headersTimeoutMs (${headersTimeoutMs}) must not exceed requestTimeoutMs (${requestTimeoutMs})`
    )
  }
  const checkingIntervalMs =
    options.connectionsCheckingIntervalMs ??
    Math.min(DEFAULT_CONNECTIONS_CHECKING_INTERVAL_MS, headersTimeoutMs)
  assertPositiveInteger('connectionsCheckingIntervalMs', checkingIntervalMs)
  const keepAliveTimeoutMs = options.keepAliveTimeoutMs ?? DEFAULT_KEEP_ALIVE_TIMEOUT_MS
  assertPositiveInteger('keepAliveTimeoutMs', keepAliveTimeoutMs)
  const jsonLimit = options.bodyLimit?.json ?? DEFAULT_BODY_LIMIT
  const urlencodedLimit = options.bodyLimit?.urlencoded ?? DEFAULT_BODY_LIMIT
  assertBodyLimit('bodyLimit.json', jsonLimit)
  assertBodyLimit('bodyLimit.urlencoded', urlencodedLimit)
  return {
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
  const given = options.helmet ?? {}
  if (given !== false) {
    const helmet = await loadHelmet()
    // helmet accepts `hsts` as an alias of `strictTransportSecurity` and throws when both are
    // present, so the default is left out when the caller used the alias. The caller's own
    // `strictTransportSecurity` needs no such care: it overrides the default by position.
    express.use(helmet('hsts' in given ? given : { strictTransportSecurity: false, ...given }))
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
