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

import { IdempotencyInterceptor } from './idempotency.interceptor'
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

/** An HTTP context over `request`. */
function context(request: object, type = 'http'): ExecutionContext {
  return {
    getType: () => type,
    getHandler: () => () => undefined,
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) })
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

    const outcome = await new Promise<unknown>((resolve) =>
      interceptor
        .intercept(
          context({ headers: { 'idempotency-key': 'k' } }),
          handler(throwError(() => new Error('boom')))
        )
        .subscribe({ error: resolve })
    )

    expect(store.release).toHaveBeenCalledTimes(1)
    expect((outcome as Error).message).toBe('boom')
  })
})
