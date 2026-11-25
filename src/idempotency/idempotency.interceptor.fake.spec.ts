/**
 * Unit tests of the interceptor against hand-built execution contexts.
 *
 * Layer: unit.
 * Goal: a non-HTTP or unmarked call passes through, a Fastify-shaped request is read as well as an Express
 * one, a subscriber that leaves keeps the claim, and a failed release after a handler error is logged.
 * Mocks: the execution context, the call handler and the store.
 */
import type { CallHandler, ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { of, Subject, throwError } from 'rxjs'
import type { Observable } from 'rxjs'

import { BYMAX_IDEMPOTENCY_IN_PROGRESS } from './idempotency.codes'
import { IdempotencyInterceptor } from './idempotency.interceptor'
import { fingerprint } from './idempotency.key'
import { resolveIdempotentOptions } from './idempotency.options'
import { InMemoryIdempotencyStore } from './idempotency.memory-store'
import { IDEMPOTENT_OPTIONS } from './idempotency.support'

const options = resolveIdempotentOptions({ unscoped: true })

/** An interceptor whose reflector answers `metadata` for every key. */
function build(metadata: Record<string | symbol, unknown>, store = new InMemoryIdempotencyStore()) {
  const reflector = {
    get: (key: string | symbol) => metadata[key]
  } as unknown as Reflector
  return { interceptor: new IdempotencyInterceptor(store, reflector), store }
}

/** A raw response whose writers record nothing and whose `end` is the one the interceptor replaces. */
function fakeResponse(): { end: jest.Mock; [key: string]: unknown } {
  return {
    statusCode: 500,
    headersSent: false,
    writableEnded: false,
    destroy: jest.fn(),
    getHeaders: () => ({}),
    removeHeader: () => undefined,
    writeHead: jest.fn(),
    write: () => true,
    end: jest.fn()
  }
}

/** An HTTP context over `request`. */
function context(
  request: object,
  type = 'http',
  response: object = fakeResponse()
): ExecutionContext {
  return {
    getType: () => type,
    getHandler: () => () => undefined,
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response })
  } as unknown as ExecutionContext
}

const handler = (source: Observable<unknown> = of({ ok: true })): CallHandler => ({
  handle: () => source
})

describe('IdempotencyInterceptor, outside the route it was made for', () => {
  it('passes a call without the route metadata straight through', (done) => {
    const { interceptor } = build({})

    interceptor.intercept(context({}), handler()).subscribe((value) => {
      expect(value).toEqual({ ok: true })
      done()
    })
  })

  it('passes a non-HTTP call straight through', (done) => {
    const { interceptor } = build({ [IDEMPOTENT_OPTIONS]: options })

    interceptor.intercept(context({}, 'rpc'), handler()).subscribe((value) => {
      expect(value).toEqual({ ok: true })
      done()
    })
  })
})

describe('IdempotencyInterceptor, request shapes', () => {
  it('reads the url of a Fastify request, and survives one with no url or method', async () => {
    const { interceptor, store } = build({ [IDEMPOTENT_OPTIONS]: options })
    const begin = jest.spyOn(store, 'begin')

    for (const request of [
      { headers: { 'idempotency-key': 'k1' }, url: '/a?x=1', method: 'POST' },
      { headers: { 'idempotency-key': 'k2' } }
    ]) {
      await new Promise<void>((resolve) =>
        interceptor.intercept(context(request), handler()).subscribe({ complete: resolve })
      )
    }

    expect(begin).toHaveBeenCalledTimes(2)
    expect(begin.mock.calls[0]?.[1]).not.toBe(begin.mock.calls[1]?.[1])
  })
})

describe('IdempotencyInterceptor, a subscriber that leaves', () => {
  it('keeps the claim when it unsubscribes, and stops the handler it subscribed', async () => {
    const { interceptor, store } = build({ [IDEMPOTENT_OPTIONS]: options })
    const release = jest.spyOn(store, 'release')
    const pending = new Subject<unknown>()

    const subscription = interceptor
      .intercept(context({ headers: { 'idempotency-key': 'k' } }), handler(pending))
      .subscribe()
    await new Promise((resolve) => setImmediate(resolve))
    subscription.unsubscribe()
    await new Promise((resolve) => setImmediate(resolve))

    expect(release).not.toHaveBeenCalled()
    expect(pending.observed).toBe(false)
  })

  it('logs and goes on when the release after a handler error fails', async () => {
    const { interceptor, store } = build({ [IDEMPOTENT_OPTIONS]: options })
    jest.spyOn(store, 'release').mockRejectedValue(new Error('down'))

    const response = fakeResponse()
    const realEnd = response.end
    const outcome = await new Promise<unknown>((resolve) =>
      interceptor
        .intercept(
          context({ headers: { 'idempotency-key': 'k' } }, 'http', response),
          handler(throwError(() => new Error('boom')))
        )
        .subscribe({ error: resolve })
    )
    response.end()
    await new Promise((resolve) => setImmediate(resolve))

    expect(store.release).toHaveBeenCalledTimes(1)
    expect(realEnd).toHaveBeenCalledTimes(1)
    expect((outcome as Error).message).toBe('boom')
  })
})

/** Subscribe to the call and wait for the stream to end or fail; resolves with the error, if any. */
function settled(source: Observable<unknown>): Promise<unknown> {
  return new Promise((resolve) =>
    source.subscribe({ complete: () => resolve(undefined), error: resolve })
  )
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))
const keyed = { 'idempotency-key': 'k' }

describe('IdempotencyInterceptor, the fingerprint of the request', () => {
  it.each([
    ['no method', { url: '/p' }, { method: '', path: '/p', query: '' }],
    [
      'the original url over the url',
      { method: 'POST', originalUrl: '/o?x=1', url: '/u?y=2' },
      { method: 'POST', path: '/o', query: 'x=1' }
    ],
    [
      'the url alone',
      { method: 'POST', url: '/u?y=2' },
      { method: 'POST', path: '/u', query: 'y=2' }
    ],
    ['no url', { method: 'POST' }, { method: 'POST', path: '', query: '' }],
    [
      'a query with no path',
      { method: 'POST', url: '?z=3' },
      { method: 'POST', path: '', query: 'z=3' }
    ],
    ['an empty query', { method: 'POST', url: '/p?' }, { method: 'POST', path: '/p', query: '' }]
  ])('is taken from %s', async (_name, request, parts) => {
    const { interceptor, store } = build({ [IDEMPOTENT_OPTIONS]: options })
    const begin = jest.spyOn(store, 'begin')

    await settled(interceptor.intercept(context({ headers: keyed, ...request }), handler()))

    expect(begin.mock.calls[0]?.[1]).toBe(fingerprint({ ...parts, body: undefined }))
  })
})

describe('IdempotencyInterceptor, the answer it stores', () => {
  it('stores the answer for ttlSeconds, not for the lease', async () => {
    const lease = resolveIdempotentOptions({ unscoped: true, leaseSeconds: 10, ttlSeconds: 100 })
    const { interceptor, store } = build({ [IDEMPOTENT_OPTIONS]: lease })
    const complete = jest.spyOn(store, 'complete')
    const response = fakeResponse()
    response.statusCode = 200

    await settled(interceptor.intercept(context({ headers: keyed }, 'http', response), handler()))
    response.end('{"ok":true}')
    await tick()

    expect(complete).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ status: 200, body: '{"ok":true}' }),
      100
    )
  })

  it.each([
    ['started', { writableEnded: false, headersSent: true }],
    ['ended and started', { writableEnded: true, headersSent: true }]
  ])('keeps the claim without a body when the answer was already %s', async (_name, state) => {
    const { interceptor, store } = build({ [IDEMPOTENT_OPTIONS]: options })
    const complete = jest.spyOn(store, 'complete')
    const response = Object.assign(fakeResponse(), { statusCode: 504 }, state)
    const writer = response.end

    await settled(interceptor.intercept(context({ headers: keyed }, 'http', response), handler()))
    await tick()

    expect(complete).toHaveBeenCalledTimes(1)
    expect(complete).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      { status: 504, headers: {} },
      options.ttlSeconds
    )
    expect(response.end).toBe(writer)
  })

  it('waits for the answer to be sent when it has not been', async () => {
    const { interceptor, store } = build({ [IDEMPOTENT_OPTIONS]: options })
    const complete = jest.spyOn(store, 'complete')
    const response = fakeResponse()
    const writer = response.end

    await settled(interceptor.intercept(context({ headers: keyed }, 'http', response), handler()))
    await tick()

    expect(complete).not.toHaveBeenCalled()
    expect(response.end).not.toBe(writer)
  })
})

describe('IdempotencyInterceptor, a key that is already held', () => {
  /** A store whose `begin` reports the key as held by `record`, under the request's own fingerprint. */
  const holding = (record: object): InMemoryIdempotencyStore =>
    ({
      begin: (_key: string, print: string) =>
        Promise.resolve({ claimed: false, record: { fingerprint: print, ...record } }),
      complete: jest.fn(),
      release: jest.fn()
    }) as unknown as InMemoryIdempotencyStore

  const stored = { status: 200, headers: {}, body: '{}' }

  it.each([
    ['not completed, although an answer is attached', { state: 'in_progress', response: stored }],
    ['completed with no answer', { state: 'completed' }]
  ])('says in progress for a record that is %s', async (_name, record) => {
    const { interceptor } = build({ [IDEMPOTENT_OPTIONS]: options }, holding(record))

    const refusal = await settled(interceptor.intercept(context({ headers: keyed }), handler()))

    expect(refusal).toMatchObject({ status: 409 })
    expect((refusal as { getResponse(): unknown }).getResponse()).toMatchObject({
      code: BYMAX_IDEMPOTENCY_IN_PROGRESS
    })
  })

  it('replays a completed record that carries its answer', async () => {
    const { interceptor } = build(
      { [IDEMPOTENT_OPTIONS]: options },
      holding({ state: 'completed', response: stored })
    )

    expect(
      await settled(interceptor.intercept(context({ headers: keyed }), handler()))
    ).toBeUndefined()
  })
})

describe('IdempotencyInterceptor, the storage key', () => {
  // These literals are the keys a shared store already holds. A change to how a key is derived, a tag
  // included, makes a retry across a deploy miss its record and run the handler again.
  it.each([
    ['unscoped', options, 'a7c83d95fbc75448e4abb3b1a52259b36834f06036e518548874744008f1fe50'],
    [
      'scoped',
      resolveIdempotentOptions({ scope: () => 'caller' }),
      'c560b0b6f1e4e86c4df74eff2fa70920b42f391ad8e384c7a15beba18367879d'
    ]
  ])('is a fixed digest for a %s route', async (_name, resolved, expected) => {
    const { interceptor, store } = build({ [IDEMPOTENT_OPTIONS]: resolved })
    const begin = jest.spyOn(store, 'begin')

    await settled(interceptor.intercept(context({ headers: keyed }), handler()))

    expect(begin.mock.calls[0]?.[0]).toBe(expected)
  })
})
