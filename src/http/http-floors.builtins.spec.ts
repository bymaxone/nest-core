/**
 * Tests for the CORS and request-deadline decisions while a built-in they call is replaced.
 *
 * Layer: integration.
 * Goal: a `Set.prototype.has` replaced after boot to answer `true` neither lists an unlisted origin nor
 * excludes a path from the deadline, and a `toJSON` planted on `Object.prototype` does not rewrite the 504.
 * Mocks: none; the real option builder and a real Nest application on Express, driven with supertest.
 */
import { CanActivate, Controller, Get, Module, UseGuards } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { applyHttpFloors } from './http-floors'
import { resolveCors } from './http-floors.cors'
import { requestDeadline } from './http-floors.deadline'

/** Run `body` while `Set.prototype.has` answers `true` for any string that starts with `prefix`. */
async function withHasAnsweringTrue<T>(prefix: string, body: () => Promise<T> | T): Promise<T> {
  const original = Set.prototype.has
  Set.prototype.has = function (this: Set<unknown>, value: unknown): boolean {
    return typeof value === 'string' && value.startsWith(prefix) ? true : original.call(this, value)
  }
  try {
    return await body()
  } finally {
    Set.prototype.has = original
  }
}

class SlowGuard implements CanActivate {
  async canActivate(): Promise<boolean> {
    await new Promise((resolve) => setTimeout(resolve, 300))
    return true
  }
}

@Controller()
class HeldController {
  @UseGuards(SlowGuard)
  @Get('held')
  held(): { ok: true } {
    return { ok: true }
  }

  @UseGuards(SlowGuard)
  @Get('healthz-admin')
  neighbour(): { ok: true } {
    return { ok: true }
  }
}

@Module({ controllers: [HeldController] })
class HeldModule {}

describe('the CORS decision beside a replaced Set.prototype.has', () => {
  it('lists no origin once the method was replaced after boot', async () => {
    const delegate = resolveCors({ origins: ['https://app.example'], credentials: true } as never)

    const handed = await withHasAnsweringTrue(
      'https://',
      () =>
        new Promise<unknown>((resolve) => {
          ;(delegate as never as (r: object, done: (e: null, o: unknown) => void) => void)(
            { headers: { origin: 'https://evil.example' } },
            (_error, options) => resolve(options)
          )
        })
    )

    expect(handed).toEqual({ origin: false })
  })
})

describe('the request deadline beside a replaced built-in', () => {
  let app: INestApplication

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [HeldModule] }).compile()
    app = moduleRef.createNestApplication()
    await applyHttpFloors(app, {
      requestDeadline: { timeoutMs: 100, excludePaths: ['/health'] }
    } as never)
    await app.init()
  })

  afterEach(async () => {
    delete (Object.prototype as Record<string, unknown>)['toJSON']
    await app.close()
  })

  it('still bounds a path when Set.prototype.has was replaced to exclude every path', async () => {
    const answer = await withHasAnsweringTrue('/', () => request(app.getHttpServer()).get('/held'))

    expect(answer.status).toBe(504)
  })

  it('still bounds a path beside an excluded prefix when String.prototype.indexOf was replaced', async () => {
    const original = String.prototype.indexOf
    String.prototype.indexOf = function (this: string, search: string, from?: number): number {
      return this.startsWith('/healthz') && search === '/' && from === 1
        ? '/health'.length
        : original.call(this, search, from)
    }
    try {
      const answer = await request(app.getHttpServer()).get('/healthz-admin')
      expect(answer.status).toBe(504)
    } finally {
      String.prototype.indexOf = original
    }
  })

  it('answers the 504 envelope unchanged when a toJSON is planted on Object.prototype', async () => {
    Object.defineProperty(Object.prototype, 'toJSON', {
      value: () => 'PLANTED',
      enumerable: false,
      configurable: true,
      writable: true
    })

    const answer = await request(app.getHttpServer()).get('/held')

    expect(answer.status).toBe(504)
    expect(answer.text).toContain('"statusCode":504')
    expect(answer.text).toContain('"path":"/held"')
    expect(answer.text).not.toContain('PLANTED')
  })
})

describe('the 504 body for a path that holds a quote, a backslash or a control character', () => {
  it('stays valid JSON and carries the path unchanged', async () => {
    let body = ''
    const response = {
      headersSent: false,
      writableEnded: false,
      statusCode: 0,
      setHeader: () => undefined,
      removeHeader: () => undefined,
      end: (text: string) => {
        body = text
      },
      once: () => undefined
    }
    const path = '/a"b\\c\n\u0001d'
    requestDeadline({ timeoutMs: 5, excludePaths: [] })(
      { originalUrl: `${path}?x=1` } as never,
      response as never,
      () => undefined
    )

    await new Promise((resolve) => setTimeout(resolve, 40))

    expect(JSON.parse(body)).toMatchObject({ statusCode: 504, path })
  })
})
