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

import { MAX_TIMER_DELAY_MS } from '../positive-integer'
import { resolveCors } from './http-floors.cors'
import type { HttpFloorsCorsOptions } from './http-floors.cors'
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
 * Check a timeout is a positive integer.
 *
 * @param name - The option name, for the message.
 * @param value - The configured value.
 * @throws Error When the value is not a positive safe integer.
 */
function assertPositiveInteger(name: string, value: number, max?: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer, received ${String(value)}`)
  }
  if (max !== undefined && value > max) {
    throw new Error(`${name} must be a positive integer of at most ${max}, received ${value}`)
  }
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
function limitInBytes(name: string, value: HttpBodyLimit): number {
  const bytes = typeof value === 'number' ? value : sizeInBytes(value)
  if (!Number.isSafeInteger(bytes) || bytes < 1) {
    throw new Error(
      `${name} must be a positive byte count or a size such as '100kb', received ${String(value)}`
    )
  }
  if (bytes > MAX_BODY_LIMIT_BYTES) {
    throw new Error(`${name} must be at most 256mb, received ${String(value)}`)
  }
  return bytes
}

/** Throws unless `bodyLimit` is an object with only the keys of {@link HttpFloorsBodyLimit}. */
function assertBodyLimitShape(bodyLimit: unknown): void {
  if (typeof bodyLimit !== 'object' || bodyLimit === null) {
    throw new Error("bodyLimit must be an object such as { json: '1mb', urlencoded: '100kb' }")
  }
  const unknown = Object.keys(bodyLimit).find((key) => key !== 'json' && key !== 'urlencoded')
  if (unknown !== undefined) {
    throw new Error(
      `bodyLimit has an unknown key ${JSON.stringify(unknown)}; use json and urlencoded`
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
  assertPositiveInteger('connectionsCheckingIntervalMs', checkingIntervalMs, MAX_TIMER_DELAY_MS)
  const keepAliveTimeoutMs = options.keepAliveTimeoutMs ?? DEFAULT_KEEP_ALIVE_TIMEOUT_MS
  assertPositiveInteger('keepAliveTimeoutMs', keepAliveTimeoutMs, MAX_TIMER_DELAY_MS)
  const bodyLimit = options.bodyLimit ?? undefined
  if (bodyLimit !== undefined) assertBodyLimitShape(bodyLimit)
  const jsonLimit = limitInBytes('bodyLimit.json', bodyLimit?.json ?? DEFAULT_BODY_LIMIT)
  const urlencodedLimit = limitInBytes(
    'bodyLimit.urlencoded',
    bodyLimit?.urlencoded ?? DEFAULT_BODY_LIMIT
  )
  const cors = options.cors === undefined ? undefined : resolveCors(options.cors)
  return {
    cors,
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
