/**
 * Unit tests for how concurrent and repeated readiness probes share work.
 *
 * Layer: unit.
 * Goal: pin that probe volume does not set dependency volume: probes in flight share one run, a
 * finished answer is reused for `readinessCacheMs`, a hung indicator is cancelled and cannot stack
 * up, and a failed run is never cached.
 * Mocks: indicators are stubs; the clock is a spy on `Date.now`.
 */
import { normalizeCoreOptions } from '../core.options'
import type { HealthIndicatorResult, IHealthIndicator } from './health.interfaces'
import { HealthService } from './health.service'

/** An indicator that counts its calls and answers through a promise the test controls. */
function gatedIndicator(name = 'db'): {
  indicator: IHealthIndicator
  calls: () => number
  signals: AbortSignal[]
  release: (result?: HealthIndicatorResult) => void
} {
  let calls = 0
  const signals: AbortSignal[] = []
  const waiting: Array<(result: HealthIndicatorResult) => void> = []
  const indicator: IHealthIndicator = {
    name,
    check: (signal?: AbortSignal): Promise<HealthIndicatorResult> => {
      calls += 1
      if (signal !== undefined) {
        signals.push(signal)
      }
      return new Promise((resolve) => waiting.push(resolve))
    }
  }
  return {
    indicator,
    calls: () => calls,
    signals,
    release: (result = { status: 'up' }) => waiting.splice(0).forEach((resolve) => resolve(result))
  }
}

const serviceFor = (
  indicator: IHealthIndicator,
  health: { readinessCacheMs?: number; indicatorTimeoutMs?: number } = {}
): HealthService => new HealthService([indicator], normalizeCoreOptions({ health }))

describe('HealthService readiness sharing', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('runs one check for 200 concurrent probes and hands all of them the same answer', async () => {
    const gate = gatedIndicator()
    const service = serviceFor(gate.indicator, { readinessCacheMs: 0 })
    const probes = Array.from({ length: 200 }, () => service.checkReadiness())
    await Promise.resolve()
    gate.release()
    const answers = await Promise.all(probes)
    expect(gate.calls()).toBe(1)
    expect(new Set(answers).size).toBe(1)
    expect(answers[0]).toEqual({ status: 'ok', checks: [{ name: 'db', status: 'up' }] })
  })

  it('runs a new check for a probe that arrives after the shared one ended, with the cache off', async () => {
    const gate = gatedIndicator()
    const service = serviceFor(gate.indicator, { readinessCacheMs: 0 })
    const first = service.checkReadiness()
    await Promise.resolve()
    gate.release()
    await first
    const second = service.checkReadiness()
    await Promise.resolve()
    gate.release()
    await second
    expect(gate.calls()).toBe(2)
  })

  it('reuses a finished answer inside the window and runs again after it', async () => {
    const gate = gatedIndicator()
    const service = serviceFor(gate.indicator, { readinessCacheMs: 1000 })
    const now = jest.spyOn(Date, 'now').mockReturnValue(10_000)
    const first = service.checkReadiness()
    await Promise.resolve()
    gate.release()
    const answer = await first
    now.mockReturnValue(10_999)
    await expect(service.checkReadiness()).resolves.toBe(answer)
    expect(gate.calls()).toBe(1)
    now.mockReturnValue(11_000)
    const third = service.checkReadiness()
    await Promise.resolve()
    gate.release({ status: 'down' })
    await expect(third).resolves.toMatchObject({ status: 'error' })
    expect(gate.calls()).toBe(2)
  })

  it('caches a failing answer too, so a sick dependency is not probed harder', async () => {
    const gate = gatedIndicator()
    const service = serviceFor(gate.indicator, { readinessCacheMs: 1000 })
    const first = service.checkReadiness()
    await Promise.resolve()
    gate.release({ status: 'down' })
    await first
    await expect(service.checkReadiness()).resolves.toMatchObject({ status: 'error' })
    expect(gate.calls()).toBe(1)
  })

  it('aborts the signal of a check that outlives the timeout, and does not stack a hung one', async () => {
    const gate = gatedIndicator()
    const service = serviceFor(gate.indicator, { readinessCacheMs: 0, indicatorTimeoutMs: 20 })
    const probes = Array.from({ length: 200 }, () => service.checkReadiness())
    const answers = await Promise.all(probes)
    expect(gate.calls()).toBe(1)
    expect(gate.signals).toHaveLength(1)
    expect(gate.signals[0]?.aborted).toBe(true)
    expect(answers[0]).toMatchObject({ status: 'error' })
    /* The hung check never settles; the next probe must still run its own. */
    const next = service.checkReadiness()
    await expect(next).resolves.toMatchObject({ status: 'error' })
    expect(gate.calls()).toBe(2)
  })

  it('does not abort the signal of a check that answered in time', async () => {
    const gate = gatedIndicator()
    const service = serviceFor(gate.indicator, { readinessCacheMs: 0 })
    const probe = service.checkReadiness()
    await Promise.resolve()
    gate.release()
    await probe
    expect(gate.signals[0]?.aborted).toBe(false)
  })

  it('never caches or keeps a run that threw, so the next probe tries again', async () => {
    const failing: IHealthIndicator = { name: 'x', check: () => Promise.resolve({ status: 'up' }) }
    const service = new HealthService(
      [failing],
      normalizeCoreOptions({ health: { readinessCacheMs: 1000, autoDiscover: true } })
    )
    await expect(service.checkReadiness()).rejects.toThrow(/DiscoveryService/)
    await expect(service.checkReadiness()).rejects.toThrow(/DiscoveryService/)
  })
})
