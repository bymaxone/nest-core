/**
 * Unit tests for the scrape endpoint beside a changed `Object.prototype`, and beside a collection that throws.
 *
 * Layer: unit.
 * Goal: a name planted on `Object.prototype` after boot refuses the scrape with `503` before the registry is
 * asked for anything, and a collection that throws is answered `503` and not as an unhandled error.
 * Mocks: a hand-built registry stub and `HttpAdapterHost`.
 */
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
import type { HttpAdapterHost } from '@nestjs/core'

import { normalizeCoreOptions } from '../core.options'
import { createMetricsController } from './metrics.controller'
import type { MetricsRegistry } from './metrics.registry'

/** The controller's handler, as the tests call it. */
interface Scraper {
  scrape(response: unknown, request?: { headers?: Record<string, unknown> }): Promise<void>
}

/** A controller over a registry whose `metrics()` is `collect`. */
function controllerOver(
  collect: () => Promise<string>,
  authToken?: string
): { scraper: Scraper; asked: jest.Mock } {
  const asked = jest.fn(collect)
  const registry = { metrics: asked, contentType: 'text/plain' } as unknown as MetricsRegistry
  const adapterHost = {
    httpAdapter: { setHeader: () => undefined, reply: () => undefined }
  } as unknown as HttpAdapterHost
  const Controller = createMetricsController('metrics')
  const scraper = new Controller(
    registry,
    normalizeCoreOptions({
      metrics: { enabled: true, path: 'metrics', ...(authToken === undefined ? {} : { authToken }) }
    }),
    adapterHost
  ) as unknown as Scraper
  return { scraper, asked }
}

describe('the scrape endpoint', () => {
  it.each([true, false])(
    'answers 503 without asking the registry when a name is planted after boot (enumerable: %s)',
    async (enumerable) => {
      const { scraper, asked } = controllerOver(() => Promise.resolve('up 1\n'))
      Object.defineProperty(Object.prototype, 'planted', {
        value: 1,
        enumerable,
        configurable: true,
        writable: true
      })
      try {
        const error: unknown = await scraper.scrape({}).catch((thrown: unknown) => thrown)
        expect(error).toBeInstanceOf(ServiceUnavailableException)
        expect((error as Error).message).toBe('Metrics are unavailable')
        expect(((error as Error).cause as Error).message).toBe(
          'Object.prototype holds names or changes this package cannot run beside'
        )
        expect(asked).not.toHaveBeenCalled()
      } finally {
        delete (Object.prototype as Record<string, unknown>)['planted']
      }
    }
  )

  it('answers 401, and not 503, to a caller without the token while a name is planted', async () => {
    const { scraper, asked } = controllerOver(() => Promise.resolve('up 1\n'), 'secret-token')
    Object.defineProperty(Object.prototype, 'planted', {
      value: 1,
      enumerable: true,
      configurable: true,
      writable: true
    })
    try {
      await expect(scraper.scrape({}, { headers: {} })).rejects.toBeInstanceOf(
        UnauthorizedException
      )
      await expect(
        scraper.scrape({}, { headers: { authorization: 'Bearer wrong' } })
      ).rejects.toBeInstanceOf(UnauthorizedException)
      await expect(
        scraper.scrape({}, { headers: { authorization: 'Bearer secret-token' } })
      ).rejects.toBeInstanceOf(ServiceUnavailableException)
      expect(asked).not.toHaveBeenCalled()
    } finally {
      delete (Object.prototype as Record<string, unknown>)['planted']
    }
  })

  it.each([
    [
      'rejects',
      () => Promise.reject(new Error('Added label "x" is not included in initial labelset'))
    ],
    [
      'throws at once',
      (): Promise<string> => {
        throw new Error('collector failed')
      }
    ]
  ])('answers 503, and not an unhandled error, when the collection %s', async (_name, collect) => {
    const { scraper } = controllerOver(collect)

    const error: unknown = await scraper.scrape({}).catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(ServiceUnavailableException)
    expect((error as Error).message).toBe('Metrics collection failed')
    expect(((error as Error).cause as Error).message).toMatch(/labelset|collector failed/)
  })

  it('serves a clean scrape as before', async () => {
    const { scraper, asked } = controllerOver(() => Promise.resolve('up 1\n'))

    await expect(scraper.scrape({})).resolves.toBeUndefined()
    expect(asked).toHaveBeenCalledTimes(1)
  })
})
