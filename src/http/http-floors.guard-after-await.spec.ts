/**
 * Unit tests for the guard's place in `applyHttpFloors`.
 *
 * Layer: integration.
 * Goal: a name planted after the guard first ran and before `helmet` is configured (the lazy load of the
 * peer is an `await` between them) is refused, so nothing planted reaches the headers.
 * Mocks: `loadHelmet`, which plants the name while it loads the real peer.
 */
import type { INestApplication } from '@nestjs/common'

import { applyHttpFloors } from './http-floors'

jest.mock('./http.loader', () => {
  const actual = jest.requireActual<typeof import('./http.loader')>('./http.loader')
  return {
    ...actual,
    loadHelmet: async () => {
      const helmet = await actual.loadHelmet()
      const planted = (globalThis as { __planted?: string }).__planted
      if (planted !== undefined) {
        Object.defineProperty(Object.prototype, planted, {
          value: false,
          enumerable: true,
          configurable: true,
          writable: true
        })
      }
      return helmet
    }
  }
})

/** A fake Express application the floors accept. */
function fakeApp(): INestApplication {
  return {
    getHttpAdapter: () => ({ getType: () => 'express' }),
    getHttpServer: () => ({ listening: false }),
    use: () => undefined,
    enableCors: () => undefined,
    useBodyParser: () => undefined
  } as unknown as INestApplication
}

describe('a name planted while helmet loads', () => {
  afterEach(() => {
    const planted = (globalThis as { __planted?: string }).__planted
    if (planted !== undefined) delete (Object.prototype as Record<string, unknown>)[planted]
    delete (globalThis as { __planted?: string }).__planted
  })

  it.each(['contentSecurityPolicy', 'reportOnly', 'hsts'])(
    'is refused when %s is planted after the first check',
    async (name) => {
      ;(globalThis as { __planted?: string }).__planted = name

      await expect(applyHttpFloors(fakeApp(), {})).rejects.toMatchObject({
        message: 'Object.prototype holds names or changes this package cannot run beside',
        count: 1
      })
    }
  )
})
