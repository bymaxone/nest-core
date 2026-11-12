/**
 * @fileoverview `applyHttpFloors`, the HTTP-level protections every backend wants and none should
 * tune per deployment: security headers without HSTS, compressed request bodies refused, and
 * timeouts that bound how long a client may hold a socket, enforced to within a second.
 *
 * Order is part of the contract. Call it right after the access log is installed
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

/** Longest a single request, headers and body together, may take end to end. */
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
   * Longest a single request may take, headers and body together. Positive integer.
   * Default: `30000`.
   */
  readonly requestTimeoutMs?: number
}

/**
 * How often the server sweeps its connections for expired timeouts, at most. Node enforces
 * `headersTimeout` and `requestTimeout` from that sweep and not from a timer per connection, and
 * its default is thirty seconds, so a 15 s floor would cut anywhere between 15 and 45 s.
 */
const CONNECTIONS_CHECKING_INTERVAL_MS = 1_000

/** The parts of an Express-backed application this helper touches. */
interface ExpressApplicationShape {
  use(handler: unknown): unknown
  useBodyParser(type: 'json' | 'urlencoded', options: Record<string, unknown>): unknown
  getHttpServer(): {
    headersTimeout: number
    requestTimeout: number
    connectionsCheckingInterval: number
  }
  getHttpAdapter(): { getType?: () => string }
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

/**
 * Apply the HTTP floors to an Express application. Call it before `app.init()` or `listen`.
 *
 * @param app - The Nest application, created on the Express adapter.
 * @param options - Overrides for the helmet options and the two timeouts.
 * @throws Error When a timeout is unusable, the application is not on Express, or `helmet` is
 * needed and not installed. Nothing is applied in those cases.
 */
export async function applyHttpFloors(
  app: INestApplication,
  options: HttpFloorsOptions = {}
): Promise<void> {
  const headersTimeoutMs = options.headersTimeoutMs ?? DEFAULT_HEADERS_TIMEOUT_MS
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  assertPositiveInteger('headersTimeoutMs', headersTimeoutMs)
  assertPositiveInteger('requestTimeoutMs', requestTimeoutMs)
  if (headersTimeoutMs > requestTimeoutMs) {
    throw new Error(
      `headersTimeoutMs (${headersTimeoutMs}) must not exceed requestTimeoutMs (${requestTimeoutMs})`
    )
  }
  const express = app as unknown as ExpressApplicationShape
  if (express.getHttpAdapter().getType?.() !== 'express') {
    throw new Error('applyHttpFloors supports the Express adapter only')
  }
  const helmet = options.helmet === false ? undefined : await loadHelmet()
  if (helmet !== undefined) {
    express.use(helmet({ strictTransportSecurity: false, ...options.helmet }))
  }
  // A compressed body is refused with 415 on every route and before routing; the size limits and
  // the extended form syntax keep the parsers' defaults.
  express.useBodyParser('json', { inflate: false })
  express.useBodyParser('urlencoded', { inflate: false, extended: true })
  const server = express.getHttpServer()
  server.headersTimeout = headersTimeoutMs
  server.requestTimeout = requestTimeoutMs
  // Node reads this when the server starts listening, hence before `listen`. Its typings do not
  // declare it; the end-to-end suite fails if a Node release stops honouring it.
  server.connectionsCheckingInterval = Math.min(CONNECTIONS_CHECKING_INTERVAL_MS, headersTimeoutMs)
}
