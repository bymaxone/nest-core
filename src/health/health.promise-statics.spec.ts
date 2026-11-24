/**
 * Tests for the readiness verdict beside `Promise` statics replaced after load.
 *
 * Layer: unit.
 * Goal: a `race`, `all`, `allSettled`, `any`, `resolve` or `reject` replaced after load changes no part
 * of the verdict: a failing indicator stays down, a slow one stays timed out, `CORE_HEALTH_DOWN` is
 * still written, a delegating `then` leaves the clean path passing, and a replaced
 * `Promise.prototype.constructor` is answered as not ready.
 * Mocks: hand-built indicators; Nest's `Logger.warn` is spied.
 */
import { Logger } from '@nestjs/common'

import {
  delegateThen,
  forgeStatic,
  replaceConstructor,
  restorePromise,
  STATICS
} from '../__tests__/promise-forgery.harness'
import { normalizeCoreOptions } from '../core.options'
import type { IHealthIndicator } from './health.interfaces'
import { HealthService } from './health.service'

/** What a forger would like readiness to read: every check up. */
const FORGED_UP = { entry: { name: 'forged', status: 'up' }, isUp: true }

const down: IHealthIndicator = { name: 'db', check: async () => ({ status: 'down' }) }
const rejects: IHealthIndicator = {
  name: 'cache',
  check: async () => {
    throw new Error('refused')
  }
}
const never: IHealthIndicator = { name: 'slow', check: () => new Promise(() => {}) }

describe('the readiness verdict beside a replaced Promise', () => {
  let warn: jest.SpyInstance

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    restorePromise()
    jest.useRealTimers()
    warn.mockRestore()
  })

  it.each(STATICS)(
    'keeps a failing and a rejecting indicator down when %s is forged',
    async (name) => {
      const service = new HealthService([down, rejects], normalizeCoreOptions())
      forgeStatic(name, FORGED_UP)

      const response = await service.checkReadiness()

      expect(response).toEqual({
        status: 'error',
        checks: [
          { name: 'db', status: 'down' },
          { name: 'cache', status: 'down' }
        ]
      })
      expect(warn.mock.calls.map(([entry]) => (entry as { event: string }).event)).toEqual([
        'CORE_HEALTH_DOWN',
        'CORE_HEALTH_DOWN'
      ])
    }
  )

  it.each(STATICS)('keeps a slow indicator timed out when %s is forged', async (name) => {
    const service = new HealthService(
      [never],
      normalizeCoreOptions({ health: { indicatorTimeoutMs: 20 } })
    )
    forgeStatic(name, FORGED_UP)

    const response = await service.checkReadiness()

    expect(response).toEqual({
      status: 'error',
      checks: [{ name: 'slow', status: 'down', details: { timedOutAfterMs: 20 } }]
    })
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'CORE_HEALTH_DOWN', cause: 'timed-out', timeoutMs: 20 })
    )
  })

  it('answers the shutdown verdict as down when resolve is forged', async () => {
    const service = new HealthService([], normalizeCoreOptions())
    service.beforeApplicationShutdown()
    forgeStatic('resolve', { status: 'ok', checks: [] })

    expect(await service.checkReadiness()).toEqual({
      status: 'error',
      checks: [{ name: 'shutdown', status: 'down' }]
    })
  })

  it('reads an up indicator as ok and a slow one as timed out through a delegating then', async () => {
    jest.useFakeTimers()
    delegateThen()
    const service = new HealthService(
      [{ name: 'ok', check: async () => ({ status: 'up' }) }, never],
      normalizeCoreOptions({ health: { indicatorTimeoutMs: 50 } })
    )

    const pending = service.checkReadiness()
    await jest.advanceTimersByTimeAsync(50)

    expect(await pending).toEqual({
      status: 'error',
      checks: [
        { name: 'ok', status: 'up' },
        { name: 'slow', status: 'down', details: { timedOutAfterMs: 50 } }
      ]
    })
  })

  it('answers not ready while Promise.prototype.constructor is replaced', async () => {
    const service = new HealthService(
      [{ name: 'ok', check: async () => ({ status: 'up' }) }],
      normalizeCoreOptions()
    )
    replaceConstructor()

    expect(await service.checkReadiness()).toEqual({
      status: 'error',
      checks: [{ name: 'runtime', status: 'down' }]
    })
  })

  it('aborts the signal of an indicator whose pending work the guard refused', async () => {
    let signal: AbortSignal | undefined
    const stuck: IHealthIndicator = {
      name: 'db',
      check: (given?: AbortSignal) => {
        signal = given
        replaceConstructor()
        return new Promise<never>(() => {})
      }
    }
    const service = new HealthService(
      [stuck],
      normalizeCoreOptions({ health: { indicatorTimeoutMs: 5_000 } })
    )

    const verdict = await service.checkReadiness()
    restorePromise()

    expect(verdict.status).toBe('error')
    expect(signal?.aborted).toBe(true)
  })
})
