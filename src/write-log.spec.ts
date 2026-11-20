/**
 * Unit tests for the package's log writer.
 *
 * Layer: unit.
 * Goal: a logger the application installed that throws does not change the outcome of what logged,
 * proved through a real Nest `Logger` and `overrideLogger`, at every level.
 * Mocks: none; a real `Logger` delegating to a throwing logger.
 */
import { ConsoleLogger, Logger } from '@nestjs/common'
import type { LoggerService } from '@nestjs/common'

import { writeLog } from './write-log'

/** A logger whose every method throws synchronously. */
const throwing: LoggerService = {
  log: () => {
    throw new Error('logger down')
  },
  warn: () => {
    throw new Error('logger down')
  },
  error: () => {
    throw new Error('logger down')
  }
}

describe('writeLog', () => {
  afterEach(() => Logger.overrideLogger(new ConsoleLogger()))

  it.each(['log', 'warn', 'error'] as const)('absorbs a %s that throws', (level) => {
    Logger.overrideLogger(throwing)
    expect(() => writeLog(new Logger('T'), level, { event: 'E', message: 'm' })).not.toThrow()
  })

  it.each(['log', 'warn', 'error'] as const)('delivers the entry at %s level', (level) => {
    const calls: unknown[][] = []
    Logger.overrideLogger({
      log: (...a: unknown[]) => calls.push(['log', ...a]),
      warn: (...a: unknown[]) => calls.push(['warn', ...a]),
      error: (...a: unknown[]) => calls.push(['error', ...a])
    })
    writeLog(new Logger('T'), level, { event: 'E', message: 'm' })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.[0]).toBe(level)
    expect(calls[0]?.[1]).toEqual({ event: 'E', message: 'm' })
  })
})
