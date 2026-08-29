/**
 * Unit tests for `HealthService`.
 *
 * Layer: unit.
 * Goal: prove liveness never touches an indicator; readiness runs every
 * indicator concurrently; a rejecting or a slow indicator is converted to a
 * `down` entry without hiding the results of the others; the aggregate
 * status is `ok` only when every check is `up`; and no per-indicator timer
 * outlives the check that raced it.
 * Mocks: hand-built `IHealthIndicator` stubs (family convention, no test
 * double library).
 */
import { Logger } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { normalizeCoreOptions } from '../core.options'
import type { ResolvedCoreOptions } from '../core.options'
import type { ProviderScanner } from '../discovery'
import type { HealthIndicatorResult, IHealthIndicator } from './health.interfaces'
import { BymaxHealthIndicator } from './health.marker'
import { HealthService } from './health.service'

/** A marked indicator, as a sibling library would ship one. */
@BymaxHealthIndicator()
class DiscoverableIndicator {
  readonly name = 'discovered'

  /**
   * Report healthy.
   *
   * @returns An `up` result.
   */
  async check(): Promise<HealthIndicatorResult> {
    return { status: 'up' }
  }
}

/** A marked indicator that reports its dependency as unreachable. */
@BymaxHealthIndicator()
class FailingIndicator {
  readonly name = 'failing'

  /**
   * Report unhealthy.
   *
   * @returns A `down` result.
   */
  async check(): Promise<HealthIndicatorResult> {
    return { status: 'down' }
  }
}

/** Build an indicator whose `check()` resolves immediately with the given result. */
function stubIndicator(name: string, result: HealthIndicatorResult): IHealthIndicator {
  return { name, check: (): Promise<HealthIndicatorResult> => Promise.resolve(result) }
}

/** Build an indicator whose `check()` rejects with the given reason. */
function rejectingIndicator(name: string, reason: unknown): IHealthIndicator {
  return { name, check: (): Promise<HealthIndicatorResult> => Promise.reject(reason) }
}

/** Build an indicator whose `check()` never settles within the test's lifetime. */
function neverSettlingIndicator(name: string): IHealthIndicator {
  return { name, check: (): Promise<HealthIndicatorResult> => new Promise(() => {}) }
}

/**
 * Build a misbehaving indicator whose `check()` throws synchronously instead
 * of returning a rejected promise (for example, a non-`async` implementation
 * that throws before it can return). The type system cannot express this
 * shape directly, since `IHealthIndicator.check()` is declared to return a
 * `Promise`; the cast documents that this stub deliberately violates the
 * contract to exercise the aggregator's defense against it.
 */
function synchronouslyThrowingIndicator(name: string, reason: unknown): IHealthIndicator {
  return {
    name,
    check: (): Promise<HealthIndicatorResult> => {
      throw reason
    }
  }
}

/** Resolve options with a specific `indicatorTimeoutMs`, defaults otherwise. */
function optionsWithTimeout(indicatorTimeoutMs: number): ResolvedCoreOptions {
  return normalizeCoreOptions({ health: { indicatorTimeoutMs } })
}

/**
 * Resolve options with the failure message surfaced in the response. The
 * summarization tests below assert what the message *is*, which is only
 * observable through the response when it is opted in — by default the reason
 * reaches the log and nothing else.
 */
function optionsExposingErrors(): ResolvedCoreOptions {
  return normalizeCoreOptions({ health: { exposeIndicatorErrors: true } })
}

describe('HealthService', () => {
  /**
   * Liveness isolation.
   *
   * Liveness must always report the documented empty shape and must never
   * invoke an indicator, since a slow or failing dependency must not be able
   * to affect whether the process itself is reported as alive.
   */
  it('reports liveness as ok with no checks and never calls an indicator', () => {
    const spyIndicator = stubIndicator('spy', { status: 'up' })
    const check = jest.spyOn(spyIndicator, 'check')
    const service = new HealthService([spyIndicator], normalizeCoreOptions())

    const result = service.checkLiveness()

    expect(result).toEqual({ status: 'ok', checks: [] })
    expect(check).not.toHaveBeenCalled()
  })

  /**
   * All-up aggregation.
   *
   * When every indicator reports up, the aggregate status is ok and every
   * check is carried through with its name and details intact.
   */
  it('aggregates readiness as ok when every indicator is up', async () => {
    const redis = stubIndicator('redis', { status: 'up', details: { latencyMs: 2 } })
    const database = stubIndicator('database', { status: 'up' })
    const service = new HealthService([redis, database], normalizeCoreOptions())

    const result = await service.checkReadiness()

    expect(result).toEqual({
      status: 'ok',
      checks: [
        { name: 'redis', status: 'up', details: { latencyMs: 2 } },
        { name: 'database', status: 'up' }
      ]
    })
  })

  /**
   * Empty indicator list.
   *
   * With no indicators registered, readiness is vacuously ok with an empty
   * checks array, matching the same shape liveness reports.
   */
  it('aggregates readiness as ok with an empty checks array when no indicators are registered', async () => {
    const service = new HealthService([], normalizeCoreOptions())

    const result = await service.checkReadiness()

    expect(result).toEqual({ status: 'ok', checks: [] })
  })

  /**
   * No indicators argument at all.
   *
   * `BymaxCoreModule` binds no local default for `BYMAX_HEALTH_INDICATORS`
   * (see `defaults.providers.ts`): when nothing is injected, the constructor's
   * default parameter must supply an empty array, matching the
   * previously-documented empty-array default.
   */
  it('defaults to an empty indicator list when constructed with no argument', async () => {
    const service = new HealthService(undefined, normalizeCoreOptions())

    const result = await service.checkReadiness()

    expect(result).toEqual({ status: 'ok', checks: [] })
  })

  /**
   * One down among ups.
   *
   * A single down indicator must flip the aggregate status to error while
   * every other indicator still reports its own real, unhidden result.
   */
  it('reports error and keeps every check when one indicator is down among ups', async () => {
    const redis = stubIndicator('redis', { status: 'up' })
    const database = stubIndicator('database', { status: 'down', details: { reason: 'timeout' } })
    const queue = stubIndicator('queue', { status: 'up' })
    const service = new HealthService([redis, database, queue], normalizeCoreOptions())

    const result = await service.checkReadiness()

    expect(result.status).toBe('error')
    expect(result.checks).toEqual([
      { name: 'redis', status: 'up' },
      { name: 'database', status: 'down', details: { reason: 'timeout' } },
      { name: 'queue', status: 'up' }
    ])
  })

  /**
   * Rejection conversion.
   *
   * A rejecting indicator must never propagate its rejection to the caller:
   * it is converted to a down entry carrying a safe, summarized message.
   */
  it('converts a rejecting indicator into a down entry with a summarized error detail', async () => {
    const failing = rejectingIndicator('database', new Error('connection refused'))
    const healthy = stubIndicator('redis', { status: 'up' })
    const service = new HealthService([failing, healthy], optionsExposingErrors())

    const result = await service.checkReadiness()

    expect(result.status).toBe('error')
    expect(result.checks).toEqual([
      { name: 'database', status: 'down', details: { error: 'connection refused' } },
      { name: 'redis', status: 'up' }
    ])
  })

  /**
   * The default: a failing indicator names itself and nothing else.
   *
   * Readiness is usually unauthenticated, and an indicator rarely authors its
   * own failure text — it lets a driver's error propagate, and driver errors
   * carry hosts, ports and sometimes credentials. The response says which check
   * is down; the reason goes to the log.
   */
  it('omits the failure reason from the response by default', async () => {
    const secret = 'postgres://user:hunter2@db:5432'
    const failing = rejectingIndicator('database', new Error(`connection refused: ${secret}`))
    const healthy = stubIndicator('redis', { status: 'up' })
    const service = new HealthService([failing, healthy], normalizeCoreOptions())

    const result = await service.checkReadiness()

    expect(result.status).toBe('error')
    expect(result.checks).toEqual([
      { name: 'database', status: 'down' },
      { name: 'redis', status: 'up' }
    ])
    // Assert against the values themselves, not a fragment: a later edit to
    // `secret` would silently stop matching a hardcoded one. Both the credential
    // and the surrounding message text must be absent.
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain(secret)
    expect(serialized).not.toContain('connection refused')
  })

  /**
   * The reason is not discarded — it is written to Nest's logger, so an operator
   * keeps the diagnostic that the response no longer carries.
   */
  it('writes the failure reason to the logger', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const failing = rejectingIndicator('database', new Error('connection refused'))
    const service = new HealthService([failing], normalizeCoreOptions())

    await service.checkReadiness()

    expect(warn).toHaveBeenCalledWith(
      'Health check "database" went down: the indicator rejected: connection refused'
    )
    warn.mockRestore()
  })

  /**
   * The logger is written whether or not the response carries the message, so
   * turning the exposure on for local debugging does not silence the log.
   */
  it('writes to the logger even when the response exposes the message', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const failing = rejectingIndicator('database', new Error('connection refused'))
    const service = new HealthService([failing], optionsExposingErrors())

    const result = await service.checkReadiness()

    expect(result.checks).toEqual([
      { name: 'database', status: 'down', details: { error: 'connection refused' } }
    ])
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  /**
   * A timeout reports a number this library chose, not text an indicator
   * produced, so it is surfaced regardless of the exposure setting.
   */
  it('still reports the timeout duration with the exposure off', async () => {
    jest.useFakeTimers()
    const slow = neverSettlingIndicator('slow')
    const service = new HealthService([slow], optionsWithTimeout(50))

    const pending = service.checkReadiness()
    await jest.advanceTimersByTimeAsync(50)
    const result = await pending

    expect(result.checks).toEqual([
      { name: 'slow', status: 'down', details: { timedOutAfterMs: 50 } }
    ])
    jest.useRealTimers()
  })

  /**
   * Rejection with a non-Error reason.
   *
   * A rejection reason that is not an `Error` instance is still summarized
   * safely, using its string coercion rather than throwing during formatting.
   */
  it('summarizes a non-Error rejection reason using its string coercion', async () => {
    const failing = rejectingIndicator('queue', 'unavailable')
    const service = new HealthService([failing], optionsExposingErrors())

    const result = await service.checkReadiness()

    expect(result.checks).toEqual([
      { name: 'queue', status: 'down', details: { error: 'unavailable' } }
    ])
  })

  /**
   * Declared name cannot be spoofed.
   *
   * Indicator implementations are external; one that returns its own `name`
   * property must not override the registered name in the aggregated entry.
   */
  it('keeps the declared name when an indicator returns its own name property', async () => {
    const spoofing: IHealthIndicator = {
      name: 'redis',
      check: (): Promise<HealthIndicatorResult> =>
        Promise.resolve({ status: 'up', name: 'attacker' } as unknown as HealthIndicatorResult)
    }
    const service = new HealthService([spoofing], normalizeCoreOptions())

    const result = await service.checkReadiness()

    expect(result.checks).toEqual([{ name: 'redis', status: 'up' }])
  })

  /**
   * Synchronous throw from a misbehaving indicator.
   *
   * An indicator that throws synchronously instead of returning a rejected
   * promise must still be converted to a down entry, and must never reject
   * the overall `checkReadiness` call: doing so would hide every other
   * indicator's result behind an unhandled rejection.
   */
  it('converts a synchronously-throwing indicator into a down entry without hiding other checks', async () => {
    const broken = synchronouslyThrowingIndicator('broken', new Error('boom'))
    const healthy = stubIndicator('redis', { status: 'up' })
    const service = new HealthService([broken, healthy], optionsExposingErrors())

    const result = await service.checkReadiness()

    expect(result.status).toBe('error')
    expect(result.checks).toEqual([
      { name: 'broken', status: 'down', details: { error: 'boom' } },
      { name: 'redis', status: 'up' }
    ])
  })

  /**
   * Rejection message truncation.
   *
   * A rejection message longer than the safe-detail bound is truncated
   * before being surfaced, keeping the diagnostic detail bounded in size.
   */
  it('truncates an overly long rejection message before surfacing it', async () => {
    const longMessage = 'x'.repeat(400)
    const failing = rejectingIndicator('database', new Error(longMessage))
    const service = new HealthService([failing], optionsExposingErrors())

    const result = await service.checkReadiness()

    const [entry] = result.checks
    // The surfaced message, ellipsis included, is bounded at 300 characters.
    expect(entry?.details?.error).toBe(`${'x'.repeat(297)}...`)
    expect(entry?.details?.error).toHaveLength(300)
  })

  /**
   * Rejection with an uncoercible reason.
   *
   * A rejection reason that throws when coerced to a string (a null-prototype
   * object) must not break the down-conversion: it becomes a safe placeholder
   * and the aggregation still reports every indicator.
   */
  it('survives a rejection reason that cannot be coerced to a string', async () => {
    const uncoercible = rejectingIndicator('database', Object.create(null) as unknown)
    const healthy = stubIndicator('cache', { status: 'up' })
    const service = new HealthService([uncoercible, healthy], optionsExposingErrors())

    const result = await service.checkReadiness()

    expect(result.status).toBe('error')
    expect(result.checks).toHaveLength(2)
    const failed = result.checks.find((check) => check.name === 'database')
    expect(failed?.status).toBe('down')
    // Pin the exact placeholder, not just its type: an empty fallback would still
    // be a string, so only the literal value proves the safe placeholder is used.
    expect(failed?.details?.error).toBe('Unknown error')
  })

  /**
   * Message exactly at the length bound is not truncated.
   *
   * The truncation guard keeps a message whose length equals the bound intact
   * (`length <= MAX`): the boundary is inclusive. A message of exactly 300
   * characters must be surfaced verbatim, with no ellipsis, proving the `<=`
   * boundary rather than a `<` that would needlessly truncate the limit case.
   */
  it('surfaces a message exactly at the length bound without truncating it', async () => {
    const exactMessage = 'y'.repeat(300)
    const failing = rejectingIndicator('database', new Error(exactMessage))
    const service = new HealthService([failing], optionsExposingErrors())

    const result = await service.checkReadiness()

    const [entry] = result.checks
    expect(entry?.details?.error).toBe(exactMessage)
    expect(entry?.details?.error).toHaveLength(300)
    expect(entry?.details?.error).not.toContain('...')
  })

  /**
   * Timeout conversion.
   *
   * An indicator that never settles within `indicatorTimeoutMs` must be
   * converted to a down entry naming the elapsed timeout, without blocking
   * the overall readiness result forever.
   */
  it('converts a timed-out indicator into a down entry with the elapsed timeout', async () => {
    const slow = neverSettlingIndicator('external-api')
    const service = new HealthService([slow], optionsWithTimeout(20))

    const result = await service.checkReadiness()

    expect(result).toEqual({
      status: 'error',
      checks: [{ name: 'external-api', status: 'down', details: { timedOutAfterMs: 20 } }]
    })
  })

  /**
   * Concurrency proof.
   *
   * Every indicator's `check()` must be invoked before any of them settles;
   * sequential execution would interleave start and settle. This asserts the
   * ordering deterministically instead of depending on wall-clock timing.
   */
  it('starts every indicator before any of them settles', async () => {
    const events: string[] = []
    const deferred = (name: string): { indicator: IHealthIndicator; settle: () => void } => {
      let settle!: () => void
      const indicator: IHealthIndicator = {
        name,
        check: (): Promise<HealthIndicatorResult> => {
          events.push(`start:${name}`)
          return new Promise<HealthIndicatorResult>((resolve) => {
            settle = (): void => {
              events.push(`settle:${name}`)
              resolve({ status: 'up' })
            }
          })
        }
      }
      return { indicator, settle: (): void => settle() }
    }
    const first = deferred('first')
    const second = deferred('second')
    const service = new HealthService([first.indicator, second.indicator], optionsWithTimeout(5000))

    const pending = service.checkReadiness()
    await new Promise((resolve) => {
      setImmediate(resolve)
    })

    expect(events).toEqual(['start:first', 'start:second'])

    first.settle()
    second.settle()
    const result = await pending
    expect(result.status).toBe('ok')
  })

  /**
   * No timer leaks.
   *
   * Once an indicator settles before its timeout fires, the pending timeout
   * timer must be cleared immediately, never left scheduled.
   */
  it('clears the per-indicator timeout timer once the check settles first', async () => {
    jest.useFakeTimers()
    try {
      const fast = stubIndicator('fast', { status: 'up' })
      const service = new HealthService([fast], optionsWithTimeout(5000))

      await service.checkReadiness()

      expect(jest.getTimerCount()).toBe(0)
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('HealthService, indicator discovery', () => {
  const reflector = new Reflector()

  /** Options with discovery on and everything else at its default. */
  function withDiscovery(autoDiscover: boolean): ResolvedCoreOptions {
    return normalizeCoreOptions({ health: { autoDiscover } })
  }

  /** A provider graph exposing exactly the given marked indicator classes. */
  function scannerOver(classes: ReadonlyArray<new () => object>): ProviderScanner {
    return {
      getProviders: () => classes.map((metatype) => ({ metatype, instance: new metatype() }))
    }
  }

  /**
   * Discovery stays off unless asked for.
   *
   * The default must be observationally identical to the behavior before this
   * feature existed: a marked provider sitting in the container changes nothing
   * until the application opts in.
   */
  it('ignores marked providers while autoDiscover is off', async () => {
    const service = new HealthService(
      [stubIndicator('cache', { status: 'up' })],
      withDiscovery(false),
      scannerOver([DiscoverableIndicator]),
      reflector
    )

    const response = await service.checkReadiness()

    expect(response.checks.map((check) => check.name)).toEqual(['cache'])
  })

  /**
   * Enabled discovery extends the readiness set.
   *
   * This is the feature: an indicator the application never registered appears
   * in readiness because the provider carrying it was imported.
   */
  it('aggregates marked providers alongside explicit ones when enabled', async () => {
    const service = new HealthService(
      [stubIndicator('cache', { status: 'up' })],
      withDiscovery(true),
      scannerOver([DiscoverableIndicator]),
      reflector
    )

    const response = await service.checkReadiness()

    expect(response.checks.map((check) => check.name)).toEqual(['cache', 'discovered'])
  })

  /**
   * A discovered indicator can fail readiness.
   *
   * Aggregation is not cosmetic: a discovered check reporting `down` must flip
   * the overall status, or the feature would report health it never verified.
   */
  it('lets a discovered indicator fail the aggregate status', async () => {
    const service = new HealthService(
      [],
      withDiscovery(true),
      scannerOver([FailingIndicator]),
      reflector
    )

    const response = await service.checkReadiness()

    expect(response.status).toBe('error')
    expect(response.checks).toEqual([{ name: 'failing', status: 'down' }])
  })

  /**
   * The scan runs once, not per probe.
   *
   * Readiness is polled continuously; walking the whole provider graph on every
   * request would put that cost on the probe's path for a result that cannot
   * change after bootstrap.
   */
  it('scans the provider graph only once across many probes', async () => {
    const getProviders = jest.fn(() => [
      { metatype: DiscoverableIndicator, instance: new DiscoverableIndicator() }
    ])
    const service = new HealthService([], withDiscovery(true), { getProviders }, reflector)

    await service.checkReadiness()
    await service.checkReadiness()
    await service.checkReadiness()

    expect(getProviders).toHaveBeenCalledTimes(1)
  })

  /**
   * The bootstrap hook resolves the set eagerly.
   *
   * Resolving at bootstrap is what turns a misdeclared indicator into a failed
   * boot instead of a failed probe in production, so the hook must do the work
   * rather than leave it to the first request.
   */
  it('resolves the readiness set during application bootstrap', () => {
    const getProviders = jest.fn(() => [
      { metatype: DiscoverableIndicator, instance: new DiscoverableIndicator() }
    ])
    const service = new HealthService([], withDiscovery(true), { getProviders }, reflector)

    service.onApplicationBootstrap()

    expect(getProviders).toHaveBeenCalledTimes(1)
  })

  /**
   * A disabled health feature never scans. Regression guard.
   *
   * The asynchronous registration path binds this service whatever the options
   * say, so `health.enabled: false` with discovery left on would otherwise scan
   * the container at bootstrap — and let a misdeclared indicator fail a boot that
   * never asked for a readiness endpoint at all.
   */
  it('skips discovery entirely when the health feature is disabled', () => {
    const getProviders = jest.fn(() => [
      { metatype: DiscoverableIndicator, instance: new DiscoverableIndicator() }
    ])
    const service = new HealthService(
      [],
      normalizeCoreOptions({ health: { enabled: false, autoDiscover: true } }),
      { getProviders },
      reflector
    )

    service.onApplicationBootstrap()

    expect(getProviders).not.toHaveBeenCalled()
  })

  /**
   * Discovery without Nest's scanner fails loudly. Edge case.
   *
   * Reachable only when this service is constructed outside `BymaxCoreModule`,
   * which is the one case where the module has not imported `DiscoveryModule`.
   * Falling back silently would leave an operator believing discovered checks
   * are running when none are.
   */
  it('throws when discovery is enabled but the scanner is unavailable', async () => {
    const service = new HealthService([], withDiscovery(true))

    // Whole message: the second sentence is the actionable half — it names what
    // to register — and a message that only states the failure is a dead end.
    await expect(service.checkReadiness()).rejects.toThrow(
      "[BymaxCoreModule] health.autoDiscover is enabled but Nest's DiscoveryService is not available. " +
        'Register the health feature through BymaxCoreModule, which imports DiscoveryModule for it.'
    )
  })
})
