/**
 * @fileoverview Containing a rejection a consumer's callback hands back, for the
 * seams that must never let one reach what they observe.
 *
 * `ITimingSink.record` and `IHealthTransitionSink.record` are declared `void`,
 * and TypeScript accepts any return value in a void-returning position, so what
 * comes back is genuinely unknown. Two shapes both compile and pull opposite
 * ways: `async record()` returns a promise whose rejection must be contained —
 * uncontained it is an unhandled rejection, able to end the process under
 * `--unhandled-rejections=strict` — while a concise arrow such as
 * `record: (s) => list.push(s)` returns a number that must not be assimilated,
 * since doing so allocates on a path that runs once per closed request.
 *
 * `instanceof Promise` cannot be the test. `Promise` is a per-realm binding, so
 * an `async` function from a `node:vm` plugin returns a native promise that
 * fails it, and a userland promise library's result is not an instance either.
 * Probing for a callable `then` is what the language itself does when it
 * assimilates a value, so it admits every shape that can carry a rejection —
 * objects, functions and foreign promises alike — and nothing that cannot.
 *
 * One implementation rather than one per seam: a containment guarantee is worth
 * exactly as much as its least careful copy.
 * @layer Utility
 */

/**
 * Attach a failure handler to whatever a sink returned, when it can fail.
 *
 * A value that cannot carry a rejection is left alone, so the ordinary
 * synchronous sink costs one `typeof` rather than two promises and a queued
 * reaction.
 *
 * @param returned - The value a `void`-declared sink method returned.
 * @param onFailure - Receives the rejection reason, if one ever arrives.
 */
export function containRejection(returned: unknown, onFailure: (error: unknown) => void): void {
  // Cast to probe one property of an `unknown`; optional chaining absorbs
  // `null` and `undefined`, and a primitive simply has no `then`.
  //
  // Written positively rather than as an early return: with the assimilation
  // inside the block, emptying that block is a real regression the async,
  // thenable and cross-realm sink tests catch, where emptying an early-return
  // block would only have widened the guard harmlessly.
  //
  // Stryker disable next-line ConditionalExpression: equivalent in the `true` arm — assimilating a value that cannot reject resolves inertly, changing allocation and nothing observable; the `false` arm is a real regression, killed by the async, thenable and cross-realm sink tests.
  if (typeof (returned as PromiseLike<unknown> | undefined)?.then === 'function') {
    Promise.resolve(returned).catch(onFailure)
  }
}
