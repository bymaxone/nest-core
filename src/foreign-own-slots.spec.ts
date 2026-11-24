/**
 * Tests for a native promise that carries its own `constructor` or `then`.
 *
 * Layer: unit.
 * Goal: a native promise whose own, non-configurable `constructor` is not the intrinsic one, or which
 * carries an own `then`, cannot answer for a verdict: its rejection is heard, the decision fails closed
 * (down, refused, `503`), and no unhandled rejection is left behind.
 * Mocks: hand-built indicators, a registry stub and `HttpAdapterHost`.
 */
import { ServiceUnavailableException } from '@nestjs/common'
import type { HttpAdapterHost } from '@nestjs/core'

import { normalizeCoreOptions } from './core.options'
import type { IHealthIndicator } from './health/health.interfaces'
import { HealthService } from './health/health.service'
import { createMetricsController } from './metrics/metrics.controller'
import type { MetricsRegistry } from './metrics/metrics.registry'
import { hear, isGuardRefusal, ownIntrinsicConstructor, pinned } from './object-prototype'
import { ignoreRejection, settleFirst } from './settle'

/** A rejected native promise that a host pinned a foreign `constructor` on and gave a `then` that answers up. */
function forged(reason: Error): Promise<never> {
  const promise = Promise.reject(reason)
  Object.defineProperty(promise, 'constructor', {
    value: function Forged() {},
    writable: false,
    configurable: false
  })
  Object.defineProperty(promise, 'then', {
    value: (ok: (value: unknown) => void) => ok({ status: 'up', forged: true }),
    configurable: true
  })
  return promise
}

describe('a native promise with an own constructor and an own then', () => {
  const unhandled: unknown[] = []
  const record = (reason: unknown): void => void unhandled.push(reason)

  beforeEach(() => {
    unhandled.length = 0
    process.on('unhandledRejection', record)
  })

  afterEach(() => {
    process.off('unhandledRejection', record)
  })

  /** Lets a rejection nobody heard reach the process. */
  const settled = async (): Promise<void> => await new Promise((resolve) => setTimeout(resolve, 20))

  it('loses to the guard in settleFirst, with the rejection heard', async () => {
    const down = new Error('indicator down')

    const outcome = await settleFirst(
      () => forged(down),
      () => () => undefined
    ).then(
      (value) => ({ value }),
      (error: unknown) => ({ error })
    )
    await settled()

    expect(isGuardRefusal((outcome as { error?: unknown }).error)).toBe(true)
    expect(outcome).not.toHaveProperty('value')
    expect(unhandled).toEqual([])
  })

  it('is answered down for an indicator that returns it, never up', async () => {
    const indicator: IHealthIndicator = {
      name: 'db',
      check: () => forged(new Error('indicator down')) as never
    }
    const service = new HealthService([indicator], normalizeCoreOptions())

    const response = await service.checkReadiness()
    await settled()

    expect(response).toEqual({ status: 'error', checks: [{ name: 'db', status: 'down' }] })
    expect(unhandled).toEqual([])
  })

  it('is answered 503 for a registry whose collection returns it', async () => {
    const registry = {
      metrics: () => forged(new Error('collector down')),
      contentType: 'text/plain'
    } as unknown as MetricsRegistry
    const adapterHost = {
      httpAdapter: { setHeader: () => undefined, reply: () => undefined }
    } as unknown as HttpAdapterHost
    const Controller = createMetricsController('metrics')
    const instance = new Controller(
      registry,
      normalizeCoreOptions({ metrics: { enabled: true, path: 'metrics' } }),
      adapterHost
    ) as unknown as { scrape(response: unknown, request: object): Promise<void> }

    const error: unknown = await instance.scrape({}, {}).catch((thrown: unknown) => thrown)
    await settled()

    expect(error).toBeInstanceOf(ServiceUnavailableException)
    expect(unhandled).toEqual([])
  })

  it('has its rejection handed to the failure handler by ignoreRejection', async () => {
    const down = new Error('indicator down')
    const seen: unknown[] = []

    ignoreRejection(forged(down), (reason) => seen.push(reason))
    await settled()

    expect(seen).toEqual([down])
    expect(unhandled).toEqual([])
  })

  it('is judged not awaitable when a proxy of a promise refuses to describe itself', () => {
    const proxy = new Proxy(Promise.resolve(1), {
      getOwnPropertyDescriptor() {
        throw new TypeError('refused')
      }
    })

    expect(pinned(proxy)).toBe(false)
    expect(() => ownIntrinsicConstructor(proxy)).toThrow(
      'Object.prototype holds names or changes this package cannot run beside'
    )
  })

  it('is heard without throwing when the intrinsic then does not accept the value', () => {
    expect(() => hear({} as PromiseLike<unknown>)).not.toThrow()
  })
})
