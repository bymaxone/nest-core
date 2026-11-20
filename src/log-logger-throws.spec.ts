/**
 * Unit tests for the other library log lines when the application's logger throws.
 *
 * Layer: unit.
 * Goal: a logger installed with `Logger.overrideLogger` that throws does not change what the
 * shutdown deadline, the metrics contribution runner and the metrics contribution runner do.
 * Mocks: the process exit is spied on and time is faked; the logger is a real Nest `Logger`
 * delegating to a throwing logger.
 */
import { ConsoleLogger, Logger } from '@nestjs/common'
import type { LoggerService } from '@nestjs/common'
import { DiscoveryService, Reflector } from '@nestjs/core'
import { Registry } from 'prom-client'

import { normalizeCoreOptions } from './core.options'
import { BymaxMetricsContributor } from './metrics/metrics.contract'
import type { IMetricsContributor } from './metrics/metrics.contract'
import { MetricsContributionRunner } from './metrics/metrics.contribution'
import { BymaxShutdownDeadline } from './shutdown/shutdown-deadline'

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

/** A marked contributor that registers nothing. */
@BymaxMetricsContributor()
class Quiet implements IMetricsContributor {
  /** Nothing to publish. */
  registerMetrics(): void {}
}

describe('library log lines with a logger that throws', () => {
  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
    Logger.overrideLogger(new ConsoleLogger())
  })

  it('still exits at the shutdown deadline', () => {
    jest.useFakeTimers()
    const exit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    Logger.overrideLogger(throwing)
    new BymaxShutdownDeadline(
      normalizeCoreOptions({ shutdown: { deadlineMs: 1_000 } })
    ).beforeApplicationShutdown()

    jest.advanceTimersByTime(1_000)

    expect(exit).toHaveBeenCalledWith(1)
  })

  it('still finishes the contributor run', () => {
    const discovery = {
      getProviders: () => [{ metatype: Quiet, instance: new Quiet(), name: 'Quiet' }]
    } as unknown as DiscoveryService
    const runner = new MetricsContributionRunner(
      normalizeCoreOptions({ metrics: { enabled: true } }),
      new Registry(),
      discovery,
      new Reflector()
    )
    Logger.overrideLogger(throwing)

    expect(() => runner.onApplicationBootstrap()).not.toThrow()
  })
})
