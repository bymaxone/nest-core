/**
 * @fileoverview The one way this package writes a log line: through Nest's `Logger`, with a throw
 * from the application's logger absorbed.
 * @layer Utility
 */
import type { Logger } from '@nestjs/common'

/** The levels this package writes at. */
export type LogLevel = 'log' | 'warn' | 'error'

/**
 * Write one structured line; a synchronous throw from the application's logger is dropped, since a
 * library line must not change what a probe, a shutdown deadline or a boot does. Nest's `Logger` does
 * not await what a method returns, so an `async` logger's rejection is not catchable here.
 *
 * @param logger - The Nest logger to write to.
 * @param level - The level to write at.
 * @param entry - The structured entry.
 */
export function writeLog(logger: Logger, level: LogLevel, entry: object): void {
  try {
    if (level === 'warn') logger.warn(entry)
    else if (level === 'error') logger.error(entry)
    else logger.log(entry)
  } catch {
    // A logger is the last place a failure could be reported to.
  }
}
