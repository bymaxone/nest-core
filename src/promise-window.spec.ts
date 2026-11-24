/**
 * Tests for the window between a promise check and the `await` it guards, and for the rejection a
 * refusal leaves behind.
 *
 * Layer: integration.
 * Goal: no replaceable built-in runs between the check and the decision `await` (a replaced
 * `setTimeout` or `performance.now` that swaps `Promise.prototype.constructor` cannot forge a scrape
 * body or a readiness verdict), a refused scrape is logged once, and a refusal leaves no unhandled
 * rejection even when reading `constructor` throws.
 * Mocks: a hand-built registry and `HttpAdapterHost`; Nest's `Logger.warn` is spied; unhandled
 * rejections are counted in a child process.
 */
import { ServiceUnavailableException } from '@nestjs/common'
import { Logger } from '@nestjs/common'
import type { HttpAdapterHost } from '@nestjs/core'

import { lastLineFromChild, restorePromise } from './__tests__/promise-forgery.harness'
import { normalizeCoreOptions } from './core.options'
import type { IHealthIndicator } from './health/health.interfaces'
import { HealthService } from './health/health.service'
import { createMetricsController } from './metrics/metrics.controller'
import type { MetricsRegistry } from './metrics/metrics.registry'

const realTimeout = globalThis.setTimeout
const FORGED = 'FORGED_METRICS'
const PROTOTYPE = Object.getPrototypeOf((async (): Promise<void> => {})()) as object
const REAL_CONSTRUCTOR = Object.getOwnPropertyDescriptor(
  PROTOTYPE,
  'constructor'
) as PropertyDescriptor
const REAL_THEN = Object.getOwnPropertyDescriptor(PROTOTYPE, 'then') as PropertyDescriptor

/** `promise.then(ok, bad)` through the real `then`, which a swap in flight has replaced on the prototype. */
function after<T>(
  promise: Promise<T>,
  ok: (value: T) => void,
  bad: (error: unknown) => void
): void {
  ;(REAL_THEN.value as (this: Promise<T>, a: typeof ok, b: typeof bad) => unknown).call(
    promise,
    ok,
    bad
  )
}

/** Swap the constructor and plant a `then` that answers `forged`, then puts both back when it is called. */
function swapAndPlant(forged: unknown): void {
  Object.defineProperty(PROTOTYPE, 'constructor', {
    value: function Forged() {},
    writable: true,
    configurable: true
  })
  Object.defineProperty(PROTOTYPE, 'then', {
    value: (resolve: (value: unknown) => void) => {
      Object.defineProperty(PROTOTYPE, 'constructor', REAL_CONSTRUCTOR)
      Object.defineProperty(PROTOTYPE, 'then', REAL_THEN)
      resolve(forged)
    },
    writable: true,
    configurable: true
  })
}

/**
 * Run `act` and hand what it settled to `check` once the timers have run, without awaiting in the test: an
 * `await` here would read the very constructor the row has swapped.
 */
function settled(
  done: jest.DoneCallback,
  act: () => Promise<unknown>,
  check: (outcome: { value?: unknown; error?: unknown }) => void
): void {
  const outcome: { value?: unknown; error?: unknown } = {}
  after(
    act(),
    (value) => (outcome.value = value),
    (error: unknown) => (outcome.error = error)
  )
  realTimeout(() => {
    Object.defineProperty(PROTOTYPE, 'constructor', REAL_CONSTRUCTOR)
    Object.defineProperty(PROTOTYPE, 'then', REAL_THEN)
    try {
      check(outcome)
      done()
    } catch (failure) {
      done(failure)
    }
  }, 120)
}

describe('the scrape beside a built-in replaced between the check and the await', () => {
  let warn: jest.SpyInstance

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    globalThis.setTimeout = realTimeout
    Object.defineProperty(PROTOTYPE, 'constructor', REAL_CONSTRUCTOR)
    Object.defineProperty(PROTOTYPE, 'then', REAL_THEN)
    restorePromise()
    warn.mockRestore()
  })

  /** A controller over a registry whose text is `real`, and what it replied. */
  function scraper(): { scrape: () => Promise<void>; replied: jest.Mock } {
    const replied = jest.fn()
    const registry = {
      metrics: async () => 'real 1\n',
      contentType: 'text/plain'
    } as unknown as MetricsRegistry
    const adapterHost = {
      httpAdapter: { setHeader: () => undefined, reply: replied }
    } as unknown as HttpAdapterHost
    const Controller = createMetricsController('metrics')
    const instance = new Controller(
      registry,
      normalizeCoreOptions({ metrics: { enabled: true, path: 'metrics' } }),
      adapterHost
    ) as unknown as { scrape(response: unknown, request: object): Promise<void> }
    return { scrape: () => instance.scrape({}, {}), replied }
  }

  it('answers 503 and serves no forged body when setTimeout swaps the constructor as the timer is armed', (done) => {
    const { scrape, replied } = scraper()
    let armed = true
    globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
      if (armed) {
        armed = false
        swapAndPlant(FORGED)
      }
      return realTimeout(...args)
    }) as typeof setTimeout

    settled(done, scrape, ({ error }) => {
      expect(error).toBeInstanceOf(ServiceUnavailableException)
      expect(replied).not.toHaveBeenCalled()
    })
  })

  it('writes one CORE_METRICS_RUNTIME_ALTERED line, however many scrapes are refused', (done) => {
    const { scrape } = scraper()
    swapAndPlant(FORGED)

    settled(
      done,
      () =>
        new Promise<string[]>((resolve) => {
          const seen: string[] = []
          const note = (word: string): void => {
            seen.push(word)
            if (seen.length === 2) resolve(seen)
          }
          after(
            scrape(),
            () => note('served'),
            () => {
              note('refused')
              after(
                scrape(),
                () => note('served'),
                () => note('refused')
              )
            }
          )
        }),
      ({ value }) => {
        expect(value).toEqual(['refused', 'refused'])
        expect(warn.mock.calls.map(([entry]) => (entry as { event: string }).event)).toEqual([
          'CORE_METRICS_RUNTIME_ALTERED'
        ])
      }
    )
  })
})

describe('the readiness verdict beside a built-in replaced between the check and the await', () => {
  const realNow = performance.now.bind(performance)
  let warn: jest.SpyInstance

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    performance.now = realNow
    Object.defineProperty(PROTOTYPE, 'constructor', REAL_CONSTRUCTOR)
    Object.defineProperty(PROTOTYPE, 'then', REAL_THEN)
    delete (Object.prototype as Record<string, unknown>)['then']
    warn.mockRestore()
  })

  it('answers runtime down, not a forged verdict, when performance.now swaps the constructor on a concurrent probe', async () => {
    const down: IHealthIndicator = {
      name: 'db',
      check: () => new Promise((resolve) => realTimeout(() => resolve({ status: 'down' }), 30))
    }
    const service = new HealthService(
      [down],
      normalizeCoreOptions({ health: { readinessCacheMs: 0 } })
    )
    await service.checkReadiness()
    const outcome: { value?: unknown } = {}
    let armed = false
    performance.now = (() => {
      if (armed) {
        armed = false
        swapAndPlant({ status: 'ok', checks: [] })
      }
      return realNow()
    }) as typeof performance.now
    after(
      service.checkReadiness(),
      () => undefined,
      () => undefined
    )
    armed = true
    await new Promise<void>((resolve) => {
      after(
        service.checkReadiness(),
        (value) => (outcome.value = value),
        () => undefined
      )
      realTimeout(resolve, 120)
    })

    expect(outcome.value).toEqual({
      status: 'error',
      checks: [{ name: 'runtime', status: 'down' }]
    })
  })

  it('answers runtime down, not a forged verdict, when the timer armed for a run swaps the constructor', async () => {
    const down: IHealthIndicator = { name: 'db', check: () => Promise.resolve({ status: 'down' }) }
    const service = new HealthService([down], normalizeCoreOptions({}))
    const realSet = globalThis.setTimeout
    let armed = true
    globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
      if (armed) {
        armed = false
        swapAndPlant({ status: 'ok', checks: [] })
      }
      return realSet(...args)
    }) as typeof setTimeout
    const outcome: { value?: unknown } = {}
    try {
      await new Promise<void>((resolve) => {
        after(
          service.checkReadiness(),
          (value) => (outcome.value = value),
          () => undefined
        )
        realSet(resolve, 120)
      })
    } finally {
      globalThis.setTimeout = realSet
    }

    expect(outcome.value).toEqual({
      status: 'error',
      checks: [{ name: 'runtime', status: 'down' }]
    })
  })

  it('answers the real verdict when a self-erasing then accessor is planted on Object.prototype while a probe waits', async () => {
    const down: IHealthIndicator = {
      name: 'db',
      check: () => new Promise((resolve) => realTimeout(() => resolve({ status: 'down' }), 40))
    }
    const service = new HealthService(
      [down],
      normalizeCoreOptions({ health: { readinessCacheMs: 0 } })
    )
    realTimeout(() => {
      Object.defineProperty(Object.prototype, 'then', {
        configurable: true,
        get() {
          delete (Object.prototype as Record<string, unknown>)['then']
          return (resolve: (value: unknown) => void) => resolve({ status: 'ok', checks: [] })
        }
      })
    }, 10)

    const response = await service.checkReadiness()

    expect(response.status).toBe('error')
  })

  it('answers runtime down, and does not rethrow the refusal, when what was planted is gone by the time the run fails', async () => {
    const planter: IHealthIndicator = {
      name: 'planter',
      check: async () => {
        Object.defineProperty(Object.prototype, 'then', {
          value: 1,
          configurable: true,
          writable: true
        })
        queueMicrotask(() => delete (Object.prototype as Record<string, unknown>)['then'])
        return { status: 'up' }
      }
    }
    const service = new HealthService(
      [planter],
      normalizeCoreOptions({ health: { readinessCacheMs: 0 } })
    )

    const outcome = await service.checkReadiness().then(
      (response) => response,
      (error: unknown) => ({ threw: (error as Error).message })
    )

    expect(outcome).toEqual({ status: 'error', checks: [{ name: 'runtime', status: 'down' }] })
  })
})

describe('a refusal and the rejection it leaves behind', () => {
  /** Plants a `constructor` getter that throws, as a host whose read of it must not decide anything. */
  const PLANT = `
    const proto = Object.getPrototypeOf((async () => {})())
    const plant = () => Object.defineProperty(proto, 'constructor', { get() { throw new Error('boom') }, configurable: true })
    let seen = 0
    process.on('unhandledRejection', () => { seen += 1 })
    const report = () => setTimeout(() => console.log('unhandled=' + seen), 60)
  `

  it('leaves none when a refused check rejects afterwards and reading constructor throws', () => {
    const output = lastLineFromChild(`
      ${PLANT}
      const { HealthService } = require('./src/health/health.service')
      const { normalizeCoreOptions } = require('./src/core.options')
      const late = { name: 'late', check: () => { plant(); return new Promise((_, reject) => setTimeout(() => reject(new Error('late')), 5)) } }
      new HealthService([late], normalizeCoreOptions()).checkReadiness().then(report, report)
    `)

    expect(output).toBe('unhandled=0')
  })

  it('leaves none when settleFirst refuses work that rejects afterwards and reading constructor throws', () => {
    const output = lastLineFromChild(`
      ${PLANT}
      const { settleFirst } = require('./src/settle')
      settleFirst(() => { plant(); return new Promise((_, reject) => setTimeout(() => reject(new Error('late')), 5)) }, () => () => undefined)
        .then(report, report)
    `)

    expect(output).toBe('unhandled=0')
  })

  it('leaves none when a scrape past its deadline is refused and reading constructor throws', () => {
    const output = lastLineFromChild(`
      ${PLANT}
      const { ScrapeRun } = require('./src/metrics/scrape-run')
      plant()
      new ScrapeRun(20, () => undefined).run(() => new Promise(() => {})).then(report, report)
    `)

    expect(output).toBe('unhandled=0')
  })
})
