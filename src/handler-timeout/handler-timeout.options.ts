/**
 * @fileoverview The options of the handler timeout and their resolution against the defaults.
 * @layer Configuration
 */
import { MAX_TIMER_DELAY_MS, positiveSafeInteger } from '../positive-integer'

/** The default {@link HandlerTimeoutOptions.timeoutMs}. */
const DEFAULT_HANDLER_TIMEOUT_MS = 30_000

/** Handler-timeout configuration: a bound on how long one request's handler may run. */
export interface HandlerTimeoutOptions {
  /**
   * Bound the handler of every request. Default: `false`, because a default bound would cut an
   * upload, a long poll or a report that legitimately runs long; an application turns it on and
   * excludes those routes.
   *
   * Node's `requestTimeout` and `headersTimeout` bound only the receiving of the request, so a
   * handler that stalls, or a client that reads the response slowly, holds the connection and
   * whatever the handler holds with it until this bound is hit.
   */
  enabled?: boolean
  /**
   * How long a handler may run before the request is answered `504` in the error envelope, in
   * milliseconds. Positive integer up to `2147483647`. Default: `30000`.
   *
   * The bound is the handler's whole duration, not the time to its first value: an `Observable` that
   * emits and never completes is answered `504` too.
   *
   * The `504` frees the client and the connection. A handler that returns a promise (an `async`
   * method) cannot be cancelled: it runs to its end unless it takes the abort signal
   * (`@HandlerSignal()`) and stops on it, and a database connection it holds is released only when it
   * does. Either kind of handler is held for one more `timeoutMs` after the `504`, so that an error it
   * throws meanwhile is logged and not lost; an `Observable` is then unsubscribed, so its teardown
   * runs; a client that goes away before the `504` releases it at once.
   *
   * The bound covers every route the interceptor sees, the health and metrics endpoints included: a
   * `timeoutMs` below `health.indicatorTimeoutMs` or `metrics.scrapeTimeoutMs` makes a slow probe or
   * scrape answer `504` in place of its own `503`. Keep it above them, or list those paths in
   * `excludePaths`.
   */
  timeoutMs?: number
  /**
   * Path prefixes whose requests are not bounded, each starting with `/`: `'/uploads'` covers
   * `/uploads` and everything under it, but not `/uploads-old`. The path is the request's own, global
   * prefix included. A route can also opt out with `@NoHandlerTimeout()`, and an SSE route
   * (`@Sse()`) is never bounded. Default: none.
   */
  excludePaths?: readonly string[]
}

/** Fully-resolved handler-timeout options. */
export interface ResolvedHandlerTimeoutOptions {
  readonly enabled: boolean
  readonly timeoutMs: number
  readonly excludePaths: readonly string[]
}

/** Throws unless `path` is a path prefix: a string that starts with `/` and has no query or fragment. */
function assertPathPrefix(path: unknown): asserts path is string {
  if (typeof path !== 'string' || !path.startsWith('/') || /[?#\s]/.test(path)) {
    throw new Error(
      `handlerTimeout.excludePaths entry ${JSON.stringify(path)} must be a path starting with "/", with no query, fragment or space`
    )
  }
}

/**
 * Resolve the handler-timeout options against their defaults.
 *
 * @param raw - The consumer's handler-timeout block, if any.
 * @returns The fully-populated options.
 * @throws Error When the timeout is not a positive timer-safe integer or an excluded path is not a
 *   path prefix.
 */
export function resolveHandlerTimeout(raw?: HandlerTimeoutOptions): ResolvedHandlerTimeoutOptions {
  const excludePaths = [...(raw?.excludePaths ?? [])]
  excludePaths.forEach(assertPathPrefix)
  return {
    enabled: raw?.enabled ?? false,
    timeoutMs: positiveSafeInteger(
      'handlerTimeout.timeoutMs',
      raw?.timeoutMs ?? DEFAULT_HANDLER_TIMEOUT_MS,
      MAX_TIMER_DELAY_MS
    ),
    excludePaths
  }
}
