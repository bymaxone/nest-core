/**
 * End-to-end suite: the unexpected-error sink.
 *
 * Layer: e2e.
 * Goal: prove, over real HTTP and on both registration paths, that a handler
 * throwing a plain `Error` still answers with the enveloped 500 while the sink
 * bound under `BYMAX_UNEXPECTED_ERROR_SINK` receives that very error with the
 * method, the route template and the correlation id; that a sink which throws
 * leaves the response untouched; that an `HttpException` never reaches it; and
 * that Fastify reports the same template Express does.
 * Mocks: the fixture's stub correlation provider and stub sink, bound through
 * the documented `@Global()` consumer-override pattern
 * (`test/e2e/fixture/app.fixture.ts`).
 */
import { Controller, Get, Global, Module } from '@nestjs/common'
import type { DynamicModule } from '@nestjs/common'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { BymaxCoreModule, BYMAX_UNEXPECTED_ERROR_SINK } from '@bymax-one/nest-core'

import { buildFixtureApp, StubUnexpectedErrorSink } from './fixture/app.fixture'
import type { Fixture, FixtureRegistration } from './fixture/app.fixture'

/** Both registration paths, each with the envelope enabled. */
const REGISTRATIONS: ReadonlyArray<readonly [string, FixtureRegistration]> = [
  ['forRoot', { kind: 'sync', options: { envelope: { enabled: true } } }],
  ['forRootAsync', { kind: 'async', factory: () => ({ envelope: { enabled: true } }) }]
]

describe.each(REGISTRATIONS)('unexpected-error sink, %s', (_name, registration) => {
  let fixture: Fixture | undefined

  beforeEach(async () => {
    fixture = await buildFixtureApp(registration)
  })

  afterEach(async () => {
    await fixture?.app.close()
    fixture = undefined
  })

  /**
   * The cause reaches the sink; the client still gets the safe 500.
   *
   * The fixture's `/boom` throws `new Error('fixture unexpected failure')`. The
   * response must carry none of that, and the sink must carry all of it.
   */
  it('reports the thrown error and still serves the enveloped 500', async () => {
    const response = await request(fixture?.app.getHttpServer()).get('/boom').expect(500)

    expect(response.body).toMatchObject({
      statusCode: 500,
      code: 'BYMAX_INTERNAL_ERROR',
      message: 'Internal server error',
      path: '/boom',
      correlationId: 'fixture-correlation-id'
    })
    expect(JSON.stringify(response.body)).not.toContain('fixture unexpected failure')
    expect(fixture?.sink.reports).toHaveLength(1)
    const report = fixture?.sink.reports[0]
    expect(report?.error).toBeInstanceOf(Error)
    expect((report?.error as Error).message).toBe('fixture unexpected failure')
    expect(report).toMatchObject({
      method: 'GET',
      route: '/boom',
      correlationId: 'fixture-correlation-id'
    })
  })

  /**
   * A broken sink is invisible to the client.
   *
   * The response with a throwing sink must match the response the same request
   * gets once the sink is repaired, field for field apart from the timestamp.
   */
  it('serves the same envelope when the sink throws', async () => {
    fixture?.sink.setBroken(true)
    const broken = await request(fixture?.app.getHttpServer()).get('/boom')
    fixture?.sink.setBroken(false)
    const healthy = await request(fixture?.app.getHttpServer()).get('/boom')

    expect(broken.status).toBe(500)
    expect({ ...broken.body, timestamp: '' }).toEqual({ ...healthy.body, timestamp: '' })
  })

  /**
   * A deliberate HTTP answer is not an unexpected error.
   */
  it('does not report an HttpException', async () => {
    await request(fixture?.app.getHttpServer()).get('/missing').expect(404)

    expect(fixture?.sink.reports).toEqual([])
  })
})

/** A route with a parameter, so the template and the URL differ. */
@Controller()
class FailingItemController {
  /** Throws a plain `Error`. */
  @Get('items/:id')
  item(): never {
    throw new Error('fastify failure')
  }
}

/** Bind the sink the way the README documents a consumer doing it. */
function sinkModule(sink: StubUnexpectedErrorSink): DynamicModule {
  @Global()
  @Module({
    providers: [{ provide: BYMAX_UNEXPECTED_ERROR_SINK, useValue: sink }],
    exports: [BYMAX_UNEXPECTED_ERROR_SINK]
  })
  class SinkModule {}
  return { module: SinkModule }
}

describe('unexpected-error sink, Fastify', () => {
  let app: NestFastifyApplication | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  /**
   * Fastify reports the template, not the URL or its query.
   *
   * Fastify keeps the matched template on `routeOptions.url`, a different place
   * from Express; reading the wrong one would report every Fastify failure as
   * unmatched, and reading the URL would carry the query string into a log.
   */
  it('reports the route template on Fastify', async () => {
    const sink = new StubUnexpectedErrorSink()
    const moduleRef = await Test.createTestingModule({
      imports: [BymaxCoreModule.forRoot({}), sinkModule(sink)],
      controllers: [FailingItemController]
    }).compile()
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    const response = await app.inject({ method: 'GET', url: '/items/42?token=s3cr3t' })

    expect(response.statusCode).toBe(500)
    expect(sink.reports).toHaveLength(1)
    expect(sink.reports[0]).toMatchObject({ method: 'GET', route: '/items/:id' })
    expect((sink.reports[0]?.error as Error).message).toBe('fastify failure')
  })
})
