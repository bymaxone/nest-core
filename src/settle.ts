/**
 * @fileoverview One promise settled by the work or a timer, whichever is first, from the intrinsic
 * `Promise` captured at load: a verdict never reads a `Promise` static, or the global binding, a host can
 * replace. `await` reads only `Promise.prototype.constructor`, which `object-prototype` watches.
 * @layer Utility
 */
import {
  IntrinsicPromise,
  assertPromiseIntact,
  hear,
  ownIntrinsicConstructor,
  pinned
} from './object-prototype'

const NativePromise = IntrinsicPromise

/** Arms the timer with `win` (fulfil) and `lose` (reject); returns what runs when the work ends. */
export type Arm<T> = (win: (value: T) => void, lose: (reason: unknown) => void) => () => void

/**
 * Run `work` in a later microtask and return a promise it or the armed timer settles first.
 *
 * @param work - Produces the value, or throws or rejects.
 * @param arm - Starts the timer.
 * @returns The promise of whichever settled first.
 */
export function settleFirst<T>(work: () => T | PromiseLike<T>, arm: Arm<T>): Promise<T> {
  let win!: (value: T) => void
  let lose!: (reason: unknown) => void
  const result = new NativePromise<T>((resolve, reject) => {
    win = resolve
    lose = reject
  })
  const ended = arm(win, lose)
  void (async (): Promise<void> => {
    try {
      await undefined
      const pending = work()
      try {
        assertPromiseIntact()
      } catch (refusal) {
        ignoreRejection(pending as PromiseLike<unknown>)
        lose(refusal)
        await pending
        return
      }
      win(await ownIntrinsicConstructor(pending))
    } catch (reason) {
      lose(reason)
    } finally {
      ended()
    }
  })()
  return result
}

/**
 * Mark a promise handled, so a rejection nobody awaits is not an unhandled one.
 *
 * @param promise - The promise to mark.
 * @param onFailure - Receives the rejection, when given. It must not throw.
 */
export function ignoreRejection(
  promise: PromiseLike<unknown>,
  onFailure?: (reason: unknown) => void
): void {
  // Its own constructor first: the `await` below must not read the prototype's, which is altered
  // exactly when a refusal calls this. A promise that cannot be pinned is heard through the intrinsic `then`.
  if (!pinned(promise)) return hear(promise, onFailure)
  void (async (): Promise<void> => {
    try {
      await promise
    } catch (reason) {
      onFailure?.(reason)
    }
  })()
}
