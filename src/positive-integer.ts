/**
 * @fileoverview Boot-time validation of the numeric options that feed a limit or a timer.
 * @layer Configuration
 */

/** The longest delay `setTimeout` honours; a longer one fires after a millisecond. */
export const MAX_TIMER_DELAY_MS = 2 ** 31 - 1

/**
 * Fail at boot on a number that is not a positive safe integer.
 *
 * A zero, negative or non-finite limit does not disable what it limits: it makes every check time
 * out, every request slow, or compares false for ever, and does so silently.
 *
 * @param name - The dotted option name, for the message.
 * @param value - The value to check.
 * @param max - The largest accepted value, for a limit that feeds a timer: Node clamps a delay
 *   above 2**31 - 1 to one millisecond.
 * @returns The value, unchanged.
 * @throws Error When `value` is not a positive safe integer, or is above `max`.
 */
export function positiveSafeInteger(name: string, value: number, max?: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive safe integer, received ${String(value)}`)
  }
  if (max !== undefined && value > max) {
    throw new Error(`${name} must be a positive integer of at most ${max}, received ${value}`)
  }
  return value
}
