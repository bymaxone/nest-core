/**
 * Integration tests for `applyHttpFloors`.
 *
 * Layer: integration.
 * Goal: the helper applies the security headers without HSTS, refuses a compressed body with 415
 * before routing and with the headers still on the refusal, keeps the extended urlencoded syntax,
 * sets the two timeouts, and fails loudly on what it cannot protect.
 * Mocks: none; real Express and Fastify Nest applications are driven with supertest.
 */
import { Body, Controller, Module, Post } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { gzipSync } from 'node:zlib'
import type { Server } from 'node:http'
import request from 'supertest'

import { BymaxCoreModule } from '../core.module'
import { applyHttpFloors } from './http-floors'
import type { HttpFloorsOptions } from './http-floors'

/** `http.Server` with the connection-sweep interval Node reads but its typings do not declare. */
type SweepingServer = Server & { connectionsCheckingInterval: number }

/** Echoes the parsed body back. */
@Controller('p')
class EchoController {
  @Post('echo')
  echo(@Body() body: unknown): unknown {
    return body
  }
}

@Module({ controllers: [EchoController] })
class EchoModule {}

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

describe('applyHttpFloors, defaults', () => {
  let app: INestApplication

  beforeAll(async () => {
    app = await start()
  })

  afterAll(async () => {
    await app.close()
  })

  const server = (): SweepingServer => app.getHttpServer() as SweepingServer

  it('sends the security headers and no Strict-Transport-Security', async () => {
    const res = await request(server()).post('/p/echo').send({ a: 1 })
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['content-security-policy']).toContain("default-src 'self'")
    expect(res.headers['strict-transport-security']).toBeUndefined()
  })

  it('refuses a gzip JSON body with 415, not decompressed, on a matched route', async () => {
    const res = await request(server())
      .post('/p/echo')
      .set('content-type', 'application/json')
      .set('content-encoding', 'gzip')
      .send(gzipSync('{"a":1}'))
    expect(res.status).toBe(415)
    expect(res.body).toMatchObject({ code: 'BYMAX_UNSUPPORTED_MEDIA_TYPE' })
  })

  it('refuses a gzip body before routing, on a path that matches nothing', async () => {
    const res = await request(server())
      .post('/nowhere')
      .set('content-type', 'application/json')
      .set('content-encoding', 'gzip')
      .send(gzipSync('{"a":1}'))
    expect(res.status).toBe(415)
  })

  it('refuses a gzip urlencoded body with 415', async () => {
    const res = await request(server())
      .post('/p/echo')
      .set('content-type', 'application/x-www-form-urlencoded')
      .set('content-encoding', 'gzip')
      .send(gzipSync('a=1'))
    expect(res.status).toBe(415)
  })

  it('keeps the security headers on the refusal', async () => {
    /* The refusal is raised in the parser, after helmet, so the order is what carries them. */
    const res = await request(server())
      .post('/p/echo')
      .set('content-type', 'application/json')
      .set('content-encoding', 'gzip')
      .send(gzipSync('{"a":1}'))
    expect(res.headers['x-content-type-options']).toBe('nosniff')
  })

  it('still parses an uncompressed JSON body', async () => {
    const res = await request(server())
      .post('/p/echo')
      .send({ a: [1, 2] })
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ a: [1, 2] })
  })

  it('keeps the extended urlencoded syntax', async () => {
    const res = await request(server()).post('/p/echo').type('form').send('a[b]=1&a[c][]=2')
    expect(res.body).toEqual({ a: { b: '1', c: ['2'] } })
  })

  it('sets the header timeout to 15 s and the request timeout to 30 s', () => {
    expect(server().headersTimeout).toBe(15_000)
    expect(server().requestTimeout).toBe(30_000)
  })

  it('sweeps connections every second, so the timeouts bite within a second of expiring', () => {
    /* Node's own default is thirty seconds, which would stretch a 15 s floor to up to 45 s. */
    expect(server().connectionsCheckingInterval).toBe(1_000)
  })
})

describe('applyHttpFloors, options', () => {
  it('passes helmet options through and lets a caller turn HSTS back on', async () => {
    const app = await start({
      helmet: {
        contentSecurityPolicy: { directives: { defaultSrc: ["'none'"] } },
        strictTransportSecurity: true
      }
    })
    try {
      const res = await request(app.getHttpServer()).post('/p/echo').send({})
      expect(res.headers['content-security-policy']).toContain("default-src 'none'")
      expect(res.headers['strict-transport-security']).toBeDefined()
    } finally {
      await app.close()
    }
  })

  it("accepts helmet's hsts alias to tune or re-enable HSTS", async () => {
    /* helmet throws when both spellings are present, so the default must not add the other one. */
    const app = await start({ helmet: { hsts: { maxAge: 5 } } })
    try {
      const res = await request(app.getHttpServer()).post('/p/echo').send({})
      expect(res.headers['strict-transport-security']).toBe('max-age=5; includeSubDomains')
    } finally {
      await app.close()
    }
  })

  it('accepts hsts: false, which keeps HSTS off', async () => {
    const app = await start({ helmet: { hsts: false } })
    try {
      const res = await request(app.getHttpServer()).post('/p/echo').send({})
      expect(res.headers['strict-transport-security']).toBeUndefined()
      expect(res.headers['x-content-type-options']).toBe('nosniff')
    } finally {
      await app.close()
    }
  })

  it('leaves helmet out when asked', async () => {
    const app = await start({ helmet: false })
    try {
      const res = await request(app.getHttpServer()).post('/p/echo').send({})
      expect(res.headers['x-content-type-options']).toBeUndefined()
      expect(res.status).toBe(201)
    } finally {
      await app.close()
    }
  })

  it('applies custom timeouts', async () => {
    const app = await start({ headersTimeoutMs: 5_000, requestTimeoutMs: 10_000 })
    try {
      const server = app.getHttpServer() as SweepingServer
      expect(server.headersTimeout).toBe(5_000)
      expect(server.requestTimeout).toBe(10_000)
      expect(server.connectionsCheckingInterval).toBe(1_000)
    } finally {
      await app.close()
    }
  })

  it('accepts the smallest timeout, and a header timeout equal to the request timeout', async () => {
    /* Both limits are inclusive: one millisecond is a positive integer, and equal is not above. */
    const app = await start({ headersTimeoutMs: 1, requestTimeoutMs: 1 })
    try {
      const server = app.getHttpServer() as SweepingServer
      expect(server.headersTimeout).toBe(1)
      expect(server.requestTimeout).toBe(1)
      /* The sweep never runs less often than the shortest timeout it enforces. */
      expect(server.connectionsCheckingInterval).toBe(1)
    } finally {
      await app.close()
    }
  })

  it.each([
    ['a zero header timeout', { headersTimeoutMs: 0 }],
    ['a negative request timeout', { requestTimeoutMs: -1 }],
    ['a fractional header timeout', { headersTimeoutMs: 1.5 }],
    [
      'a header timeout above the request timeout',
      { headersTimeoutMs: 20_000, requestTimeoutMs: 10_000 }
    ]
  ])('rejects %s', async (_name, options) => {
    /* A timeout that disables itself is not a floor. */
    const moduleRef = await Test.createTestingModule({ imports: [EchoModule] }).compile()
    const app = moduleRef.createNestApplication()
    await expect(applyHttpFloors(app, options)).rejects.toThrow(/headersTimeoutMs|requestTimeoutMs/)
    await app.close()
  })

  it('applies a custom connection-sweep interval', async () => {
    /* A server holding very many sockets may want the sweep slower than the default. */
    const app = await start({ connectionsCheckingIntervalMs: 5_000 })
    try {
      const server = app.getHttpServer() as SweepingServer
      expect(server.connectionsCheckingInterval).toBe(5_000)
      expect(server.headersTimeout).toBe(15_000)
    } finally {
      await app.close()
    }
  })

  it.each([0, -1, 1.5, Number.NaN])('rejects a connection-sweep interval of %p', async (value) => {
    const moduleRef = await Test.createTestingModule({ imports: [EchoModule] }).compile()
    const app = moduleRef.createNestApplication()
    await expect(applyHttpFloors(app, { connectionsCheckingIntervalMs: value })).rejects.toThrow(
      /connectionsCheckingIntervalMs must be a positive integer/
    )
    await app.close()
  })

  it('throws when the server is already listening, and applies nothing', async () => {
    /* Node reads the sweep interval when the server starts listening, so later is too late. */
    const moduleRef = await Test.createTestingModule({ imports: [EchoModule] }).compile()
    const app = moduleRef.createNestApplication()
    await app.listen(0, '127.0.0.1')
    try {
      const server = app.getHttpServer() as SweepingServer
      const before = server.connectionsCheckingInterval
      await expect(applyHttpFloors(app)).rejects.toThrow(/before listen/)
      expect(server.headersTimeout).not.toBe(15_000)
      expect(server.connectionsCheckingInterval).toBe(before)
    } finally {
      await app.close()
    }
  })

  it('rejects an application that is not on Express rather than half-applying', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [EchoModule] }).compile()
    const app = moduleRef.createNestApplication(new FastifyAdapter())
    await expect(applyHttpFloors(app)).rejects.toThrow(/Express/)
    await app.close()
  })
})

describe('applyHttpFloors, order', () => {
  it('lets middleware mounted after it read cookies and see the parsed body', async () => {
    /* cookie-parser and the trusted-proxy wiring stay with the caller, after this helper. */
    const seen: { cookie?: string | undefined; body?: unknown } = {}
    const moduleRef = await Test.createTestingModule({
      imports: [BymaxCoreModule.forRoot(), EchoModule]
    }).compile()
    const second = moduleRef.createNestApplication()
    await applyHttpFloors(second)
    second.use(
      (req: { headers: { cookie?: string }; body?: unknown }, _res: unknown, next: () => void) => {
        seen.cookie = req.headers.cookie
        seen.body = req.body
        next()
      }
    )
    await second.init()
    try {
      await request(second.getHttpServer()).post('/p/echo').set('cookie', 'sid=1').send({ a: 1 })
      expect(seen).toEqual({ cookie: 'sid=1', body: { a: 1 } })
    } finally {
      await second.close()
    }
  })
})
