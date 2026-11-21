/**
 * @fileoverview The options of the shutdown deadline and their resolution.
 * @layer Configuration
 */
import { checkedBlock } from '../option-validation'
import { MAX_TIMER_DELAY_MS, positiveSafeInteger } from '../positive-integer'

/** Shutdown configuration: an overall bound on how long the process may take to stop. */
export interface ShutdownOptions {
  /**
   * The longest the shutdown may take, in milliseconds, once the deadline has been armed. Positive
   * integer up to `2147483647`. Default: unset, which adds no bound.
   *
   * Each library bounds its own close, so the worst case is their sum, and a handle nothing closes
   * keeps the process alive past all of them. When this is set and the process has not exited by
   * the deadline, one error line is logged and the process exits with code `1`, so an orchestrator
   * sees a failed stop and not a hung one. Choose it above the orchestrator's grace period only if
   * you want the orchestrator to kill first; below it, to exit on your own terms.
   *
   * It is armed by whichever comes first: a `SIGTERM` or `SIGINT` that the application already
   * handles (`app.enableShutdownHooks()` before `app.init()`), or the first of this module's own
   * shutdown hooks. Nest runs a global module, as this one is by default, after every other module in
   * each phase, so on a programmatic `app.close()` a never-settling `onModuleDestroy` in another module
   * or in the root module's providers is reached first and the deadline is not armed, as it is on any
   * signal other than `SIGTERM` and `SIGINT` (`SIGHUP`, `SIGQUIT`, `SIGUSR2`); a never-settling
   * `beforeApplicationShutdown` or `onApplicationShutdown` anywhere is covered. A signal nothing
   * handles keeps Node's default of ending the process, and no listener is added for it.
   *
   * A `SIGTERM` or `SIGINT` the application handles for another purpose also arms it, and the process
   * then exits with code `1` after `deadlineMs`. The timer outlives `app.close()` on purpose, so a
   * process that keeps running after it, such as a Jest end-to-end suite, exits with code `1` too:
   * leave `deadlineMs` unset in test processes.
   */
  deadlineMs?: number
}

/** Fully-resolved shutdown options. `deadlineMs` stays absent when unset. */
export interface ResolvedShutdownOptions {
  readonly deadlineMs?: number
}

/** The options of {@link ShutdownOptions}; the compiler keeps this table complete. */
export const SHUTDOWN_KEYS = { deadlineMs: 0 } satisfies Record<keyof ShutdownOptions, 0>

/**
 * Resolve the shutdown options.
 *
 * @param given - The consumer's shutdown block, if any.
 * @returns The options; `deadlineMs` is present only when it was set.
 * @throws Error When the block has an option it does not document, or `deadlineMs` is not a
 *   positive timer-safe integer.
 */
export function resolveShutdown(given?: unknown): ResolvedShutdownOptions {
  const raw = checkedBlock<ShutdownOptions>('shutdown', given, SHUTDOWN_KEYS)
  const deadlineMs = raw?.deadlineMs ?? undefined
  return deadlineMs === undefined
    ? {}
    : { deadlineMs: positiveSafeInteger('shutdown.deadlineMs', deadlineMs, MAX_TIMER_DELAY_MS) }
}
