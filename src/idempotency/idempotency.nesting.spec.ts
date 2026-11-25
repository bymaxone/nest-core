/**
 * Unit tests for the owner of a claim as nested interceptor instances see it.
 *
 * Layer: unit.
 * Goal: only a call from inside the live chain, for the same request and handler, is inside; copies of
 * the module share one storage, a slot of another shape is not used, and nothing is made before use.
 * Mocks: the call handler; the shared slot on `globalThis` is set and restored by hand.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

import type { CallHandler } from '@nestjs/common'
import { Observable, of, Subject, throwError } from 'rxjs'

type Nesting = typeof import('./idempotency.nesting')

const SLOT = Symbol.for('@bymax-one/nest-core:idempotency-nesting')

/** A fresh copy of the module, as a second build of the package would be. */
function copy(): Nesting {
  let loaded: Nesting | undefined
  jest.isolateModules(() => {
    loaded = require('./idempotency.nesting') as Nesting
  })
  return loaded as Nesting
}

const slot = (): unknown => (globalThis as Record<symbol, unknown>)[SLOT]
const clearSlot = (): void => {
  Reflect.deleteProperty(globalThis, SLOT)
}

beforeEach(clearSlot)
afterEach(clearSlot)

const request = {}
const handler = (): void => undefined

/** A chain that records, at each point it is asked, whether it is inside the owner. */
const probe = (ask: () => boolean, seen: boolean[]): CallHandler => ({
  handle: () => {
    seen.push(ask())
    return new Observable((subscriber) => {
      seen.push(ask())
      subscriber.next(1)
      subscriber.complete()
    })
  }
})

describe('asOwner and insideOwner', () => {
  it('is inside at handle() and at subscription, and not before, after or in the answer', () => {
    const nesting = copy()
    const ask = (): boolean => nesting.insideOwner(request, handler)
    const seen: boolean[] = [ask()]

    nesting
      .asOwner(request, handler, probe(ask, seen))
      .handle()
      .subscribe({ next: () => seen.push(ask()), complete: () => seen.push(ask()) })
    seen.push(ask())

    expect(seen).toEqual([false, true, true, false, false, false])
  })

  it.each([
    ['another request', {}, handler],
    ['another handler on the same request', request, (): void => undefined]
  ])('is not inside for %s', (_name, otherRequest, otherHandler) => {
    const nesting = copy()
    const seen: boolean[] = []

    nesting
      .asOwner(
        request,
        handler,
        probe(() => nesting.insideOwner(otherRequest, otherHandler), seen)
      )
      .handle()
      .subscribe()

    expect(seen).toEqual([false, false])
  })

  it.each([
    ['an error', () => throwError(() => new Error('boom'))],
    ['a completion with no value', () => new Observable((subscriber) => subscriber.complete())],
    ['a value', () => of(1)]
  ])('is no longer inside when %s reaches the caller', (_name, source) => {
    const nesting = copy()
    const seen: boolean[] = []
    const record = (): void => {
      seen.push(nesting.insideOwner(request, handler))
    }

    nesting
      .asOwner(request, handler, { handle: source })
      .handle()
      .subscribe({ next: record, error: record, complete: record })

    expect(seen.length).toBeGreaterThan(0)
    expect(seen).not.toContain(true)
  })

  it('is no longer inside once the caller has left, and leaves the chain', async () => {
    const nesting = copy()
    const pending = new Subject<number>()
    let later: Promise<boolean> | undefined
    const source = new Observable((subscriber) => {
      later = new Promise((resolve) =>
        setTimeout(() => resolve(nesting.insideOwner(request, handler)), 5)
      )
      return pending.subscribe(subscriber)
    })

    const subscription = nesting
      .asOwner(request, handler, { handle: () => source })
      .handle()
      .subscribe()
    subscription.unsubscribe()

    expect(await later).toBe(false)
    expect(pending.observed).toBe(false)
  })
})

describe('the storage', () => {
  /** What a call owned by `owner` looks like to `asker`. */
  function seenBy(owner: Nesting, asker: Nesting): boolean[] {
    const seen: boolean[] = []
    owner
      .asOwner(
        request,
        handler,
        probe(() => asker.insideOwner(request, handler), seen)
      )
      .handle()
      .subscribe()
    return seen
  }

  it('is not made by loading the module', () => {
    copy()

    expect(slot()).toBeUndefined()
  })

  it('is one for two copies of the module, in a hidden, read-only, removable slot', () => {
    const one = copy()
    const two = copy()

    expect(seenBy(one, two)).toEqual([true, true])
    expect(Object.getOwnPropertyDescriptor(globalThis, SLOT)).toMatchObject({
      enumerable: false,
      writable: false,
      configurable: true
    })
  })

  it.each([
    ['another version', { version: 2, storage: new AsyncLocalStorage() }],
    ['this version with no storage', { version: 1, storage: {} }],
    ['null', null]
  ])('is a copy of its own when the slot holds %s, which is left alone', (_name, found) => {
    Reflect.defineProperty(globalThis, SLOT, { value: found, configurable: true })
    const one = copy()
    const two = copy()

    expect(seenBy(one, one)).toEqual([true, true])
    expect(seenBy(one, two)).toEqual([false, false])
    expect(slot()).toBe(found)
  })
})
