/**
 * Integration tests for the CORS allowlist of `applyHttpFloors`.
 *
 * Layer: integration.
 * Goal: CORS is off unless configured; an explicit origin allowlist is matched exactly, credentials
 * are opt-in, and a configuration that cannot be safe (a wildcard with credentials, an empty list, an
 * origin that is not an exact origin) is refused at boot with nothing applied.
 * Mocks: none; a real Express Nest application is driven with supertest.
 */
import { Controller, Module, Post } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import type { Server } from 'node:http'
import request from 'supertest'

import { BymaxCoreModule } from '../core.module'
import { applyHttpFloors } from './http-floors'
import type { HttpFloorsOptions } from './http-floors'

@Controller('p')
class EchoController {
  @Post('echo')
  echo(): { ok: true } {
    return { ok: true }
  }
}

@Module({ controllers: [EchoController] })
class EchoModule {}

const ALLOWED = 'https://app.example.com'

/** Build an Express application, apply the helper, and initialise it. */
async function start(options?: HttpFloorsOptions): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [BymaxCoreModule.forRoot(), EchoModule]
  }).compile()
  const app = moduleRef.createNestApplication()
  await applyHttpFloors(app, options)
  await app.init()
  return app
}

/** Runs `body` against a started application and always closes it. */
async function withApp(
  options: HttpFloorsOptions | undefined,
  body: (server: Server) => Promise<void>
): Promise<void> {
  const app = await start(options)
  try {
    await body(app.getHttpServer() as Server)
  } finally {
    await app.close()
  }
}

/** Applies unusable options and asserts the refusal registered nothing. */
async function expectRefused(options: HttpFloorsOptions, message: RegExp): Promise<void> {
  const moduleRef = await Test.createTestingModule({ imports: [EchoModule] }).compile()
  const app = moduleRef.createNestApplication<NestExpressApplication>()
  const use = jest.spyOn(app, 'use')
  const enableCors = jest.spyOn(app, 'enableCors')
  try {
    await expect(applyHttpFloors(app, options)).rejects.toThrow(message)
    expect(use).not.toHaveBeenCalled()
    expect(enableCors).not.toHaveBeenCalled()
  } finally {
    await app.close()
  }
}

describe('applyHttpFloors, CORS off', () => {
  it('sends no CORS header when nothing is configured', async () => {
    await withApp(undefined, async (server) => {
      const res = await request(server).post('/p/echo').set('origin', ALLOWED)
      expect(res.headers['access-control-allow-origin']).toBeUndefined()
      expect(res.status).toBe(201)
    })
  })
})

describe('applyHttpFloors, CORS allowlist', () => {
  const cors = { origins: [ALLOWED, 'http://localhost:3000'] }

  it('echoes an allowed origin, with Vary: Origin and no credentials header', async () => {
    await withApp({ cors }, async (server) => {
      const res = await request(server).post('/p/echo').set('origin', ALLOWED)
      expect(res.headers['access-control-allow-origin']).toBe(ALLOWED)
      expect(res.headers['vary']).toMatch(/Origin/i)
      expect(res.headers['access-control-allow-credentials']).toBeUndefined()
    })
  })

  it('sends no allow-origin header to an origin that is not listed, near misses included', async () => {
    await withApp({ cors }, async (server) => {
      for (const origin of [
        'https://evil.example.com',
        'https://app.example.com.evil.test',
        'http://app.example.com',
        'https://app.example.com:8443',
        'https://APP.example.com',
        'null'
      ]) {
        const res = await request(server).post('/p/echo').set('origin', origin)
        expect([origin, res.headers['access-control-allow-origin']]).toEqual([origin, undefined])
      }
    })
  })

  it('answers a preflight from an allowed origin with 204 and the allowed methods', async () => {
    await withApp({ cors: { ...cors, maxAgeSeconds: 600 } }, async (server) => {
      const res = await request(server)
        .options('/p/echo')
        .set('origin', ALLOWED)
        .set('access-control-request-method', 'POST')
      expect(res.status).toBe(204)
      expect(res.headers['access-control-allow-origin']).toBe(ALLOWED)
      expect(res.headers['access-control-allow-methods']).toContain('POST')
      expect(res.headers['access-control-max-age']).toBe('600')
    })
  })

  it('reflects only the listed request headers when allowedHeaders is set', async () => {
    await withApp({ cors: { ...cors, allowedHeaders: ['x-trace'] } }, async (server) => {
      const res = await request(server)
        .options('/p/echo')
        .set('origin', ALLOWED)
        .set('access-control-request-method', 'POST')
        .set('access-control-request-headers', 'x-other')
      expect(res.headers['access-control-allow-headers']).toBe('x-trace')
    })
  })

  it('exposes the listed response headers', async () => {
    await withApp({ cors: { ...cors, exposedHeaders: ['x-request-id'] } }, async (server) => {
      const res = await request(server).post('/p/echo').set('origin', ALLOWED)
      expect(res.headers['access-control-expose-headers']).toBe('x-request-id')
    })
  })

  it('sends credentials only when asked, and never with a wildcard', async () => {
    await withApp({ cors: { ...cors, credentials: true } }, async (server) => {
      const res = await request(server).post('/p/echo').set('origin', ALLOWED)
      expect(res.headers['access-control-allow-credentials']).toBe('true')
      expect(res.headers['access-control-allow-origin']).toBe(ALLOWED)
    })
  })

  it('keeps the CORS headers on a refusal raised by the body parser', async () => {
    await withApp({ cors, bodyLimit: { json: 100 } }, async (server) => {
      const res = await request(server)
        .post('/p/echo')
        .set('origin', ALLOWED)
        .type('json')
        .send(JSON.stringify({ a: 'x'.repeat(500) }))
      expect(res.status).toBe(413)
      expect(res.headers['access-control-allow-origin']).toBe(ALLOWED)
    })
  })
})

describe('applyHttpFloors, CORS wildcard', () => {
  it('allows every origin without credentials when the list is a lone *', async () => {
    await withApp({ cors: { origins: ['*'] } }, async (server) => {
      const res = await request(server).post('/p/echo').set('origin', 'https://anywhere.test')
      expect(res.headers['access-control-allow-origin']).toBe('*')
      expect(res.headers['access-control-allow-credentials']).toBeUndefined()
    })
  })

  it('refuses a wildcard together with credentials', async () => {
    await expectRefused(
      { cors: { origins: ['*'], credentials: true } },
      /cors\.origins.*\*.*cors\.credentials/s
    )
  })

  it('refuses a wildcard mixed with listed origins', async () => {
    await expectRefused({ cors: { origins: ['*', ALLOWED] } }, /cors\.origins.*\*.*alone/s)
  })
})

describe('applyHttpFloors, CORS refusals', () => {
  it.each([
    ['an empty list', { origins: [] }, /cors\.origins must list at least one origin/],
    ['a bare host', { origins: ['app.example.com'] }, /cors\.origins.*app\.example\.com/],
    ['a trailing slash', { origins: [`${ALLOWED}/`] }, /cors\.origins/],
    ['a path', { origins: [`${ALLOWED}/app`] }, /cors\.origins/],
    ['an upper-case host', { origins: ['https://APP.example.com'] }, /cors\.origins/],
    ['a non-http scheme', { origins: ['ftp://app.example.com'] }, /cors\.origins/],
    ['userinfo', { origins: ['https://user@app.example.com'] }, /cors\.origins/],
    ['the string null', { origins: ['null'] }, /cors\.origins/],
    ['a non-string entry', { origins: [42 as unknown as string] }, /cors\.origins/],
    ['a zero max age', { origins: [ALLOWED], maxAgeSeconds: 0 }, /cors\.maxAgeSeconds/],
    ['a fractional max age', { origins: [ALLOWED], maxAgeSeconds: 1.5 }, /cors\.maxAgeSeconds/],
    ['an empty method', { origins: [ALLOWED], methods: [''] }, /cors\.methods/],
    [
      'an empty allowed header',
      { origins: [ALLOWED], allowedHeaders: [' '] },
      /cors\.allowedHeaders/
    ]
  ])('refuses %s and registers nothing', async (_name, cors, message) => {
    await expectRefused({ cors }, message)
  })
})
