/**
 * End-to-end suite: the details of a server error.
 *
 * Layer: e2e.
 * Goal: prove, over real HTTP on Express and on Fastify, that an `HttpException` carrying
 * `details` in either shape answers a 5xx without them, still answers a 4xx with them, and keeps
 * them on a 5xx only when `envelope.exposeInternals` is on.
 * Mocks: none; the controller below throws the exceptions a library would.
 */
import { Controller, Get, HttpException } from '@nestjs/common'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'

import { BymaxCoreModule } from '@bymax-one/nest-core'

/** A payload fragment of the kind a library puts in `details`. */
const LEAKY = { preview: 'SECRET-PAYLOAD-0123456789' }

/** Throws what an integration library throws. */
@Controller()
class LeakyController {
  /** A 500 with flat details. */
  @Get('flat-500')
  flat500(): never {
    throw new HttpException({ code: 'CACHE_FAILED', message: 'cache failed', details: LEAKY }, 500)
  }

  /** A 503 with nested details. */
  @Get('nested-503')
  nested503(): never {
    throw new HttpException(
      { error: { code: 'CACHE_FAILED', message: 'cache failed', details: LEAKY } },
      503
    )
  }

  /** A 409 with nested details, a client error. */
  @Get('nested-409')
  nested409(): never {
    throw new HttpException(
      { error: { code: 'CONFLICT_X', message: 'conflict', details: LEAKY } },
      409
    )
  }
}

/** Build an Express application with the given envelope options. */
async function expressApp(exposeInternals: boolean): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [BymaxCoreModule.forRoot({ envelope: { exposeInternals } })],
    controllers: [LeakyController]
  }).compile()
  const app = moduleRef.createNestApplication()
  await app.init()
  return app
}

describe('server error details, Express', () => {
  let app: INestApplication | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  /**
   * A 5xx body carries the code and message but never the details.
   *
   * Both shapes are thrown at a server status; the body must not contain the payload fragment.
   */
  it('omits details from a 500 and a 503 by default', async () => {
    app = await expressApp(false)

    const flat = await request(app.getHttpServer()).get('/flat-500').expect(500)
    const nested = await request(app.getHttpServer()).get('/nested-503').expect(503)

    expect(flat.body).toMatchObject({ code: 'CACHE_FAILED', message: 'cache failed' })
    expect(nested.body).toMatchObject({ code: 'CACHE_FAILED', message: 'cache failed' })
    expect(JSON.stringify([flat.body, nested.body])).not.toContain('SECRET-PAYLOAD')
  })

  /**
   * A client error keeps its details.
   *
   * The rule must stop at 500: a 409's details are the caller's contract.
   */
  it('keeps the details of a 409', async () => {
    app = await expressApp(false)

    const response = await request(app.getHttpServer()).get('/nested-409').expect(409)

    expect(response.body.details).toEqual(LEAKY)
  })

  /**
   * The development switch keeps them on a 5xx.
   *
   * `exposeInternals` is the documented way to see internals in the body.
   */
  it('keeps the details of a 500 under exposeInternals', async () => {
    app = await expressApp(true)

    const response = await request(app.getHttpServer()).get('/flat-500').expect(500)

    expect(response.body.details).toEqual(LEAKY)
  })
})

describe('server error details, Fastify', () => {
  let app: NestFastifyApplication | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  /**
   * Fastify answers the same way as Express.
   *
   * The filter replies through the framework-neutral adapter, so the 5xx body must be identical.
   */
  it('omits details from a 500 and keeps them on a 409', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [BymaxCoreModule.forRoot({})],
      controllers: [LeakyController]
    }).compile()
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    const server = await app.inject({ method: 'GET', url: '/flat-500' })
    const client = await app.inject({ method: 'GET', url: '/nested-409' })

    expect(server.statusCode).toBe(500)
    expect(server.body).not.toContain('SECRET-PAYLOAD')
    expect(JSON.parse(server.body)).toMatchObject({ code: 'CACHE_FAILED' })
    expect(client.statusCode).toBe(409)
    expect(JSON.parse(client.body).details).toEqual(LEAKY)
  })
})
