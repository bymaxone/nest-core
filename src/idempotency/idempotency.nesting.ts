/**
 * @fileoverview Tells an `IdempotencyInterceptor` that it runs inside another one for the same request
 * and handler, so only the outer one claims the key.
 * @layer Utility
 */
import { AsyncLocalStorage } from 'node:async_hooks'

import type { CallHandler } from '@nestjs/common'
import { finalize, Observable, tap } from 'rxjs'

/** The call that owns the claim. `live` is false once its chain has answered or been left. */
interface Owner {
  readonly request: object
  readonly handler: object
  live: boolean
}

/** What copies of this module share on `globalThis`. */
interface Shared {
  readonly version: number
  readonly storage: AsyncLocalStorage<Owner>
}

/** The shape of {@link Shared}; a copy that finds another one keeps its own storage. */
const VERSION = 1

/** Registry symbol: the CJS and the ESM build of one application must find the same storage. */
const SLOT = Symbol.for('@bymax-one/nest-core:idempotency-nesting')

let storage: AsyncLocalStorage<Owner> | undefined

/** The storage, made on first use and shared with every copy of this shape. */
function owners(): AsyncLocalStorage<Owner> {
  if (storage !== undefined) return storage
  const found = Reflect.get(globalThis, SLOT) as Partial<Shared> | null | undefined
  if (found?.version === VERSION && found.storage instanceof AsyncLocalStorage) {
    storage = found.storage
    return storage
  }
  storage = new AsyncLocalStorage<Owner>()
  if (found === undefined) {
    Reflect.defineProperty(globalThis, SLOT, {
      value: { version: VERSION, storage },
      configurable: true
    })
  }
  return storage
}

/**
 * Whether this call is made from inside the live chain of a call that already owns `request` and
 * `handler`.
 */
export function insideOwner(request: object, handler: object): boolean {
  const owner = owners().getStore()
  return owner?.live === true && owner.request === request && owner.handler === handler
}

/**
 * `next`, run as the owner of `request` and `handler`. Only what its chain runs sees the owner: an
 * outer interceptor that calls the chain again does so from outside it, or after it has answered.
 */
export function asOwner(request: object, handler: object, next: CallHandler): CallHandler {
  return {
    handle: () =>
      new Observable<unknown>((subscriber) => {
        const owner: Owner = { request, handler, live: true }
        const close = (): void => {
          owner.live = false
        }
        // `handle()` and the subscription both run inside: Nest binds the async context at
        // `handle()`, and an interceptor between two instances calls on at subscription.
        return owners().run(owner, () =>
          next
            .handle()
            .pipe(tap({ next: close, error: close, complete: close }), finalize(close))
            .subscribe(subscriber)
        )
      })
  }
}
