/**
 * Tests for the scrape run beside `Promise` statics replaced after load.
 *
 * Layer: unit.
 * Goal: a `race`, `all`, `allSettled`, `any`, `resolve` or `reject` replaced after load serves no
 * forged text and hides no timeout: the collection's own text is returned, a collection past its
 * deadline is still answered `503`, a delegating `then` leaves both passing under fake timers, and a
 * replaced `Promise.prototype.constructor` is answered `503` before the registry is asked.
 * Mocks: a hand-built registry stub and `HttpAdapterHost`; real timers for the statics, fake for `then`.
 */
import { ServiceUnavailableException } from '@nestjs/common'
import type { HttpAdapterHost } from '@nestjs/core'

import {
  delegateThen,
  forgeStatic,
  loadUnderForeignPromise,
  replaceConstructor,
  restorePromise,
  STATICS
} from '../__tests__/promise-forgery.harness'
import { normalizeCoreOptions } from '../core.options'
import { createMetricsController } from './metrics.controller'
import type { MetricsRegistry } from './metrics.registry'
import { ScrapeRun } from './scrape-run'

const FORGED = 'forged_metric 1\n'

/** The outcome of one `run`, as text. */
async function outcome(run: ScrapeRun, collect: () => Promise<string>): Promise<string> {
  return await run.run(collect).then(
    (text) => `text:${text}`,
    (error: unknown) => `refused:${(error as Error).message}`
  )
}

describe('the scrape run beside a replaced Promise', () => {
  afterEach(() => {
    restorePromise()
    jest.useRealTimers()
  })

  it.each(STATICS)(
    'serves the collection, not the forged text, when %s is forged',
    async (name) => {
      const run = new ScrapeRun(1_000, () => undefined)
      forgeStatic(name, FORGED)

      expect(await outcome(run, async () => 'real 1\n')).toBe('text:real 1\n')
    }
  )

  it.each(STATICS)(
    'answers 503 for a collection past its deadline when %s is forged',
    async (name) => {
      const expired = jest.fn()
      const run = new ScrapeRun(20, expired)
      forgeStatic(name, FORGED)

      expect(await outcome(run, () => new Promise<string>(() => {}))).toBe(
        'refused:Metrics collection timed out'
      )
      expect(expired).toHaveBeenCalledTimes(1)
    }
  )

  it('serves the text and answers 503 at the deadline through a delegating then', async () => {
    jest.useFakeTimers()
    delegateThen()
    const run = new ScrapeRun(50, () => undefined)

    expect(await outcome(run, async () => 'real 1\n')).toBe('text:real 1\n')
    const late = outcome(run, () => new Promise<string>(() => {}))
    await jest.advanceTimersByTimeAsync(50)

    expect(await late).toBe('refused:Metrics collection timed out')
  })

  it('answers 503 without asking the registry while Promise.prototype.constructor is replaced', async () => {
    const asked = jest.fn(async () => 'up 1\n')
    const registry = { metrics: asked, contentType: 'text/plain' } as unknown as MetricsRegistry
    const adapterHost = {
      httpAdapter: { setHeader: () => undefined, reply: () => undefined }
    } as unknown as HttpAdapterHost
    const Controller = createMetricsController('metrics')
    const scraper = new Controller(
      registry,
      normalizeCoreOptions({ metrics: { enabled: true, path: 'metrics' } }),
      adapterHost
    ) as unknown as { scrape(response: unknown): Promise<void> }
    replaceConstructor()

    const error: unknown = await scraper.scrape({}).catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(ServiceUnavailableException)
    expect(asked).not.toHaveBeenCalled()
  })

  it('keeps a refused collection in flight until it settles and starts no second one', async () => {
    let finish: (text: string) => void = () => undefined
    const collect = jest.fn(() => {
      replaceConstructor()
      return new Promise<string>((resolve) => {
        finish = resolve
      })
    })
    const run = new ScrapeRun(1_000, () => undefined)
    const first = run.run(collect)

    const refusal: unknown = await first.catch((thrown: unknown) => thrown)
    restorePromise()

    expect(refusal).toBeInstanceOf(Error)
    expect(run.run(collect)).toBe(first)
    expect(collect).toHaveBeenCalledTimes(1)

    finish('late 1\n')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(await outcome(run, async () => 'next 1\n')).toBe('text:next 1\n')
  })

  it('answers 503 for a collection past its deadline under a foreign global Promise', async () => {
    const Run = loadUnderForeignPromise(FORGED, () => {
      let loaded!: typeof ScrapeRun
      jest.isolateModules(() => {
        loaded = (require('./scrape-run') as { ScrapeRun: typeof ScrapeRun }).ScrapeRun
      })
      return loaded
    })

    expect(await outcome(new Run(20, () => undefined), () => new Promise<string>(() => {}))).toBe(
      'refused:Metrics collection timed out'
    )
  })
})
