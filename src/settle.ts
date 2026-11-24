/**
 * @fileoverview One promise settled by the work or a timer, whichever is first, from the constructor
 * captured at load: a verdict never reads a `Promise` static a host can replace. `await` reads only
 * `Promise.prototype.constructor`, which `object-prototype` watches.
 * @layer Utility
 */

const NativePromise = Promise

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
      win(await work())
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
 */
export function ignoreRejection(promise: PromiseLike<unknown>): void {
  void (async (): Promise<void> => {
    try {
      await promise
    } catch {
      // Handled by being awaited.
    }
  })()
}
