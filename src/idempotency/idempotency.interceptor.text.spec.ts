/**
 * Unit tests of what the interceptor tells a client and what it logs.
 *
 * Layer: unit.
 * Goal: every refusal answers with its whole status, code and message, the in-progress one with its
 * `Retry-After`, each of the four warnings carries its event, message and the error it was caused by, and a
 * non-HTTP call is handed back untouched.
 * Mocks: the execution context, the call handler, the store and the logger's `warn`.
 */
import { Logger } from '@nestjs/common'
import type { CallHandler, ExecutionContext } from '@nestjs/common'
import type { Reflector } from '@nestjs/core'
import { of, throwError } from 'rxjs'
import type { Observable } from 'rxjs'

import {
  BYMAX_IDEMPOTENCY_IN_PROGRESS,
  BYMAX_IDEMPOTENCY_KEY_INVALID,
  BYMAX_IDEMPOTENCY_KEY_REQUIRED,
  BYMAX_IDEMPOTENCY_KEY_REUSED,
  BYMAX_IDEMPOTENCY_NOT_REPLAYABLE,
  BYMAX_IDEMPOTENCY_STORE_UNAVAILABLE
} from './idempotency.codes'
import { IdempotencyInterceptor } from './idempotency.interceptor'
import { InMemoryIdempotencyStore } from './idempotency.memory-store'
import { resolveIdempotentOptions } from './idempotency.options'
import type { IdempotentOptions } from './idempotency.options'

const keyed = { 'idempotency-key': 'k' }
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

/** A raw response whose `end` is the one the interceptor replaces. */
function fakeResponse() {
  return {
    statusCode: 200,
    headersSent: false,
    writableEnded: false,
    destroy: jest.fn(),
    getHeaders: () => ({}),
    removeHeader: () => undefined,
    setHeader: jest.fn(),
    writeHead: jest.fn(),
    write: () => true,
    end: jest.fn()
  }
}

type Response = ReturnType<typeof fakeResponse>

/** An interceptor over a route declared with `declared`, and a context over `request`. */
function build(declared: IdempotentOptions, store: object = new InMemoryIdempotencyStore()) {
  const resolved = resolveIdempotentOptions(declared)
  const reflector = { get: () => resolved } as unknown as Reflector
  const interceptor = new IdempotencyInterceptor(store as InMemoryIdempotencyStore, reflector)
  const response = fakeResponse()
  const context = (request: object, type = 'http'): ExecutionContext =>
    ({
      getType: () => type,
      getHandler: () => () => undefined,
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => response })
    }) as unknown as ExecutionContext
  return { interceptor, response, context }
}

const handler = (source: Observable<unknown> = of({ ok: true })): CallHandler => ({
  handle: () => source
})

/** Subscribe and resolve with the error the call fails with, or `undefined` when it completes. */
function settled(source: Observable<unknown>): Promise<unknown> {
  return new Promise((resolve) =>
    source.subscribe({ complete: () => resolve(undefined), error: resolve })
  )
}

/** A store that holds the key as `record`, under the fingerprint of the request when `same` is set. */
function holding(record: object, same: boolean): object {
  return {
    begin: (_key: string, print: string) =>
      Promise.resolve({
        claimed: false,
        record: { fingerprint: same ? print : 'another', ...record }
      }),
    complete: jest.fn(),
    release: jest.fn()
  }
}

/** A store whose `begin` fails. */
const failing = { begin: () => Promise.reject(new Error('down')), complete: jest.fn() }

const unscoped = { unscoped: true } as const
const refusals: Array<
  [string, IdempotentOptions, object, object, number, string, string, [string, string] | undefined]
> = [
  [
    'a missing header on a required route',
    { ...unscoped, required: true },
    {},
    new InMemoryIdempotencyStore(),
    400,
    BYMAX_IDEMPOTENCY_KEY_REQUIRED,
    'The Idempotency-Key header is required',
    undefined
  ],
  [
    'an invalid header',
    unscoped,
    { headers: { 'idempotency-key': 'has a space' } },
    new InMemoryIdempotencyStore(),
    400,
    BYMAX_IDEMPOTENCY_KEY_INVALID,
    'The Idempotency-Key header is invalid',
    undefined
  ],
  [
    'a scope that is not a string',
    { scope: () => '' },
    { headers: keyed },
    new InMemoryIdempotencyStore(),
    503,
    BYMAX_IDEMPOTENCY_STORE_UNAVAILABLE,
    'The idempotency scope is unavailable',
    undefined
  ],
  [
    'a body that is not JSON',
    unscoped,
    { headers: keyed, method: 'POST', body: Buffer.from('x') },
    new InMemoryIdempotencyStore(),
    400,
    BYMAX_IDEMPOTENCY_KEY_INVALID,
    'The request body cannot be fingerprinted',
    undefined
  ],
  [
    'a store that fails on a required route',
    { ...unscoped, required: true },
    { headers: keyed },
    failing,
    503,
    BYMAX_IDEMPOTENCY_STORE_UNAVAILABLE,
    'The idempotency store is unavailable',
    undefined
  ],
  [
    'a store that fails on a fail-closed route',
    { ...unscoped, onStoreError: 'fail-closed' },
    { headers: keyed },
    failing,
    503,
    BYMAX_IDEMPOTENCY_STORE_UNAVAILABLE,
    'The idempotency store is unavailable',
    undefined
  ],
  [
    'a key used by a different request',
    unscoped,
    { headers: keyed },
    holding({ state: 'completed', response: { status: 200, headers: {}, body: '{}' } }, false),
    422,
    BYMAX_IDEMPOTENCY_KEY_REUSED,
    'The Idempotency-Key was used by a different request',
    undefined
  ],
  [
    'a key that is in progress',
    unscoped,
    { headers: keyed },
    holding({ state: 'in_progress' }, true),
    409,
    BYMAX_IDEMPOTENCY_IN_PROGRESS,
    'A request with this key is in progress',
    ['Retry-After', '1']
  ],
  [
    'a first answer with no body',
    unscoped,
    { headers: keyed },
    holding({ state: 'completed', response: { status: 200, headers: {} } }, true),
    409,
    BYMAX_IDEMPOTENCY_NOT_REPLAYABLE,
    'The first answer cannot be replayed',
    undefined
  ]
]

describe('IdempotencyInterceptor, what a refusal says', () => {
  it.each(refusals)(
    'answers %s with its status, code and message',
    async (_name, declared, request, store, status, code, message, header) => {
      const { interceptor, response, context } = build(declared, store)

      const refusal = (await settled(interceptor.intercept(context(request), handler()))) as {
        getStatus(): number
        getResponse(): unknown
      }

      expect(refusal.getStatus()).toBe(status)
      expect(refusal.getResponse()).toEqual({ code, message })
      if (header === undefined) expect(response.setHeader).not.toHaveBeenCalled()
      else expect(response.setHeader).toHaveBeenCalledWith(...header)
    }
  )
})

describe('IdempotencyInterceptor, what a warning says', () => {
  const cause = new Error('cause')
  let warn: jest.SpyInstance

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => warn.mockRestore())

  /** Run one request to the end of its work, `response.end` included. */
  async function drive(
    declared: IdempotentOptions,
    store: object,
    source: Observable<unknown>,
    ended = true,
    status = 200
  ): Promise<Response> {
    const { interceptor, response, context } = build(declared, store)
    response.statusCode = status
    await settled(interceptor.intercept(context({ headers: keyed }), handler(source)))
    if (ended) response.end('{"ok":true}')
    await tick()
    await tick()
    return response
  }

  const real = (): InMemoryIdempotencyStore => new InMemoryIdempotencyStore()

  it.each([
    [
      'CORE_IDEMPOTENCY_SCOPE_FAILED',
      'The scope function threw',
      () =>
        drive(
          {
            scope: () => {
              throw cause
            }
          },
          real(),
          of(1),
          false
        )
    ],
    [
      'CORE_IDEMPOTENCY_STORE_FAILED',
      'The store failed; the handler runs unprotected',
      () => drive(unscoped, { ...failing, begin: () => Promise.reject(cause) }, of(1), false)
    ],
    [
      'CORE_IDEMPOTENCY_COMPLETE_FAILED',
      'The answer could not be stored',
      () => {
        const store = real()
        jest.spyOn(store, 'complete').mockRejectedValue(cause)
        return drive(unscoped, store, of(1))
      }
    ],
    [
      'CORE_IDEMPOTENCY_RELEASE_FAILED',
      'The claim could not be released',
      () => {
        const store = real()
        jest.spyOn(store, 'release').mockRejectedValue(cause)
        return drive(
          unscoped,
          store,
          throwError(() => new Error('handler')),
          true,
          500
        )
      }
    ]
  ])('logs %s with its message and the error behind it', async (event, message, run) => {
    await run()

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith({ event, message, err: cause })
  })
})

describe('IdempotencyInterceptor, a call that is not HTTP', () => {
  it('hands the handler back untouched, and never claims a key', () => {
    const store = new InMemoryIdempotencyStore()
    const begin = jest.spyOn(store, 'begin')
    const { interceptor, context } = build(unscoped, store)
    const source = of({ ok: true })

    const result = interceptor.intercept(context({ headers: keyed }, 'rpc'), handler(source))

    expect(result).toBe(source)
    expect(begin).not.toHaveBeenCalled()
  })
})
