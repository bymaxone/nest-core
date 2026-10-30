/**
 * End-to-end suite: request data in the message of a client error.
 *
 * Layer: e2e.
 * Goal: prove, over real HTTP on Express and on Fastify, that the router's 404 answers with the
 * path only, for a plain target and for an absolute-form one that carries credentials, and that a
 * message the application wrote is untouched.
 * Mocks: none; the controller below throws the exception an application would.
 */
import { Controller, Get, NotFoundException } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import type { TestingModule } from '@nestjs/testing'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

import { BymaxCoreModule } from '@bymax-one/nest-core'

/** A route that throws the message the application chose. */
@Controller()
class MissingController {
  /** Throws an application-written NotFoundException. */
  @Get('missing')
  missing(): never {
    throw new NotFoundException('Invoice inv_123 was not found')
  }
}

/** Send a request with an arbitrary target, which supertest cannot, and read the status and body. */
function send(server: http.Server, target: string): Promise<{ status: number; body: string }> {
  const { port } = server.address() as AddressInfo
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'GET', path: target }, (res) => {
      let body = ''
      res.on('data', (chunk: Buffer) => {
        body += chunk.toString()
      })
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body })
      })
    })
    req.on('error', reject)
    req.end()
  })
}

/** Both adapters, built from the same module. */
const ADAPTERS: ReadonlyArray<readonly [string, (m: TestingModule) => INestApplication]> = [
  ['Express', (m) => m.createNestApplication()],
  ['Fastify', (m) => m.createNestApplication(new FastifyAdapter())]
]

describe.each(ADAPTERS)('request data in a client error message, %s', (_name, create) => {
  let app: INestApplication | undefined

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [BymaxCoreModule.forRoot({})],
      controllers: [MissingController]
    }).compile()
    app = create(moduleRef)
    await app.init()
    await app.getHttpAdapter().getInstance().ready?.()
    await app.listen(0, '127.0.0.1')
  })

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  /**
   * The router's 404 carries the path, not the query.
   *
   * No route matches `/nope`, so the framework's own message is the answer; the token in the
   * query must not be in it.
   */
  it('answers an unmatched route without its query string', async () => {
    const { status, body } = await send(app?.getHttpServer(), '/nope?token=s3cr3t')

    expect(status).toBe(404)
    expect(JSON.parse(body)).toMatchObject({ code: 'BYMAX_NOT_FOUND', message: 'Cannot GET /nope' })
    expect(body).not.toContain('s3cr3t')
  })

  /**
   * An absolute-form target loses its credentials.
   *
   * A proxy sends the whole URL as the request target, userinfo included.
   */
  it('answers an absolute-form target without its authority or credentials', async () => {
    const { status, body } = await send(
      app?.getHttpServer(),
      'http://user:pw@example.com/nope?token=s3cr3t'
    )

    expect(status).toBe(404)
    expect(JSON.parse(body).message).toBe('Cannot GET /nope')
    expect(body).not.toContain('user:pw')
    expect(body).not.toContain('s3cr3t')
  })

  /**
   * The application's own message is untouched.
   *
   * A route that matched and threw keeps the text its author chose.
   */
  it('keeps the message the application wrote', async () => {
    const { status, body } = await send(app?.getHttpServer(), '/missing?token=s3cr3t')

    expect(status).toBe(404)
    expect(JSON.parse(body).message).toBe('Invoice inv_123 was not found')
  })
})
