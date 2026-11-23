/**
 * @fileoverview The request deadline of `applyHttpFloors`: a bound on the whole request, guards
 * included, answered `504` in the error envelope. It runs before Nest routes, so a slow guard, pipe or
 * interceptor is inside it, which the handler timeout (armed in an interceptor) cannot reach.
 * @layer Bootstrap
 */
import { GatewayTimeoutException } from '@nestjs/common'

import { builtinsAltered } from '../object-prototype'
import { checkedBlock, refusal } from '../option-validation'
import { MAX_TIMER_DELAY_MS, positiveSafeInteger } from '../positive-integer'
import { DEADLINE_SIGNAL } from '../request-deadline-signal'

/** The options of the request deadline. */
export interface HttpFloorsRequestDeadline {
  /** The longest a request may take, in milliseconds, from the moment it reaches the floors to its answer. */
  readonly timeoutMs: number
  /**
   * Path prefixes whose requests are not bounded, each starting with `/` (`'/events'` covers `/events` and
   * what is under it). Required, and may be empty: the floors are mounted before the module, so nothing
   * can be taken from `handlerTimeout.excludePaths`; list the same paths in both. A WebSocket upgrade
   * never goes through this middleware.
   */
  readonly excludePaths: readonly string[]
}

/** The options of {@link HttpFloorsRequestDeadline}; the compiler keeps this table complete. */
export const REQUEST_DEADLINE_KEYS = { timeoutMs: 0, excludePaths: 0 } satisfies Record<
  keyof HttpFloorsRequestDeadline,
  0
>

/**
 * The envelope code of a `504`. Written out, not imported from the envelope module, which would carry its whole
 * code table into the `./http` bundle; a spec pins it to `BYMAX_GATEWAY_TIMEOUT`.
 */
const GATEWAY_TIMEOUT_CODE = 'BYMAX_GATEWAY_TIMEOUT'

/** The parts of a request and a response the deadline reads and writes, as Express gives them. */
interface DeadlineRequest {
  readonly originalUrl?: string
  readonly url?: string
}
interface DeadlineResponse {
  readonly headersSent: boolean
  readonly writableEnded: boolean
  readonly writableFinished: boolean
  statusCode: number
  setHeader(name: string, value: string): unknown
  end(body?: string): unknown
  destroy(): unknown
  once(event: 'close' | 'finish', listener: () => void): unknown
}

/**
 * Check the request-deadline block and return it as the settings the middleware uses.
 *
 * @param given - The block, absent for no deadline.
 * @returns The settings, or `undefined` when no deadline is asked for.
 * @throws Error When the timeout is not a timer-safe integer, or `excludePaths` is missing, is not a list,
 *   holds one that is not a path prefix (a list past 1000 entries is refused earlier, when the options are read).
 */
export function resolveRequestDeadline(
  given: unknown
): { timeoutMs: number; excludePaths: readonly string[] } | undefined {
  if (given === undefined || given === null) return undefined
  const block = checkedBlock<HttpFloorsRequestDeadline>(
    'requestDeadline',
    given,
    REQUEST_DEADLINE_KEYS
  )
  const timeoutMs = positiveSafeInteger(
    'requestDeadline.timeoutMs',
    block?.timeoutMs,
    MAX_TIMER_DELAY_MS
  )
  const listed: unknown = block?.excludePaths
  if (!Array.isArray(listed)) {
    throw refusal(
      'requestDeadline.excludePaths',
      'a list of path prefixes (it may be empty)',
      listed
    )
  }
  const excludePaths = Array.from(listed as readonly unknown[]).map((path, index) => {
    if (typeof path !== 'string' || !path.startsWith('/') || /[?#\s]/.test(path)) {
      throw new Error(
        `requestDeadline.excludePaths entry ${index + 1} must be a path starting with "/", with no query, fragment or space`
      )
    }
    return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
  })
  return { timeoutMs, excludePaths }
}

/** The methods that write to a response, which Nest's router calls once the guards and the handler are done. */
const WRITERS = [
  'send',
  'json',
  'jsonp',
  'sendStatus',
  'sendFile',
  'redirect',
  'render',
  'status',
  'set',
  'header',
  'type',
  'append',
  'cookie',
  'setHeader',
  'write',
  'end'
]

/**
 * Make every later write to the answered response a no-op: the request goes on through Nest after the
 * `504` (a guard cannot be stopped), and its reply would otherwise throw `ERR_HTTP_HEADERS_SENT` into the
 * log. The answer was already sent, and it is the only one.
 */
function silence(response: DeadlineResponse): void {
  const target = response as unknown as Record<string, unknown>
  for (const name of WRITERS) {
    Object.defineProperty(target, name, {
      __proto__: null,
      value: () => response,
      configurable: true,
      writable: true
    } as PropertyDescriptor)
  }
}

/**
 * Whether the path of `request` is under a prefix, at a segment boundary; never once a built-in the match
 * calls was replaced. A prefix longer than the longest configured one cannot match, so the walk stops there
 * and a path of many slashes costs no more than a short one.
 */
function excluded(
  request: DeadlineRequest,
  prefixes: ReadonlySet<string>,
  longest: number
): boolean {
  if (builtinsAltered()) return false
  const path = (request.originalUrl ?? request.url)?.split('?', 1)[0]
  if (path === undefined) return false
  if (prefixes.has('/')) return true
  for (let at = path.indexOf('/', 1); ; at = path.indexOf('/', at + 1)) {
    const end = at === -1 ? path.length : at
    if (end > longest) return false
    if (prefixes.has(path.slice(0, end))) return true
    if (at === -1) return false
  }
}

/** The `504` envelope from a template: `JSON.stringify` would call a planted `toJSON` on every value. */
function timeoutBody(request: DeadlineRequest): string {
  const path = (request.originalUrl ?? request.url ?? '').split('?', 1)[0] as string
  const quoted = path.replace(
    /["\\]|[^ -\uffff]/g,
    (c) => `\\u${(c.charCodeAt(0) + 0x10000).toString(16).slice(1)}`
  )
  return (
    `{"statusCode":504,"code":"${GATEWAY_TIMEOUT_CODE}","message":"The request took too long to answer",` +
    `"timestamp":"${new Date().toISOString()}","path":"${quoted}"}`
  )
}

/**
 * The middleware that bounds a request. On expiry the deadline signal is aborted, and when nothing was
 * written yet the response is the `504` envelope; when the answer has begun the connection is closed.
 *
 * @param settings - The resolved request deadline.
 * @returns An Express middleware.
 */
export function requestDeadline(settings: {
  timeoutMs: number
  excludePaths: readonly string[]
}): (request: DeadlineRequest, response: DeadlineResponse, next: () => void) => void {
  const prefixes = new Set(settings.excludePaths)
  let longest = 0
  for (const prefix of prefixes) longest = prefix.length > longest ? prefix.length : longest
  return (request, response, next) => {
    if (excluded(request, prefixes, longest)) {
      next()
      return
    }
    const controller = new AbortController()
    Object.defineProperty(request, DEADLINE_SIGNAL, {
      __proto__: null,
      value: controller.signal,
      configurable: true
    } as PropertyDescriptor)
    const timer = setTimeout(() => {
      controller.abort(new GatewayTimeoutException('Request deadline exceeded'))
      if (response.headersSent || response.writableEnded) {
        response.destroy()
        return
      }
      response.statusCode = 504
      response.setHeader('content-type', 'application/json; charset=utf-8')
      response.end(timeoutBody(request))
      silence(response)
    }, settings.timeoutMs)
    timer.unref()
    const clear = (): void => clearTimeout(timer)
    response.once('close', () => {
      clear()
      if (!response.writableFinished) controller.abort()
    })
    response.once('finish', clear)
    next()
  }
}
