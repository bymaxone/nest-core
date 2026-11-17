/**
 * @fileoverview The options of the shutdown deadline and their resolution.
 * @layer Configuration
 */
import { MAX_TIMER_DELAY_MS, positiveSafeInteger } from '../positive-integer'

/** Shutdown configuration: an overall bound on how long the process may take to stop. */
export interface ShutdownOptions {
  /**
   * The longest the whole shutdown may take, in milliseconds, counted from the start of the
   * application's shutdown. Positive integer up to `2147483647`. Default: unset, which adds no bound.
   *
   * Each library bounds its own close, so the worst case is their sum, and a handle nothing closes
   * keeps the process alive past all of them. When this is set and the process has not exited by
   * then, one error line is logged and the process exits with code `1`, so an orchestrator sees a
   * failed stop and not a hung one. Choose it above the orchestrator's grace period only if you want
   * the orchestrator to kill first; below it, to exit on your own terms.
   */
  deadlineMs?: number
}

/** Fully-resolved shutdown options. `deadlineMs` stays absent when unset. */
export interface ResolvedShutdownOptions {
  readonly deadlineMs?: number
}

/**
 * Resolve the shutdown options.
 *
 * @param raw - The consumer's shutdown block, if any.
 * @returns The options; `deadlineMs` is present only when it was set.
 * @throws Error When `deadlineMs` is not a positive timer-safe integer.
 */
export function resolveShutdown(raw?: ShutdownOptions): ResolvedShutdownOptions {
  const deadlineMs = raw?.deadlineMs ?? undefined
  return deadlineMs === undefined
    ? {}
    : { deadlineMs: positiveSafeInteger('shutdown.deadlineMs', deadlineMs, MAX_TIMER_DELAY_MS) }
}
