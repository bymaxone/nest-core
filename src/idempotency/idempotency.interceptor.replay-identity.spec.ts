/**
 * Integration tests for what a replay carries and what `@Idempotent` leaves alone.
 *
 * Layer: integration.
 * Goal: a replayed error envelope is the first answer's bytes while a per-request header is the new
 * request's; an answer over `maxBodyBytes` is logged without its content; an undecorated route under an
 * application-wide registration never reaches the store.
 * Mocks: spies on the store and on Nest's logger; a real Express application over supertest.
 */
import {
  BadRequestException,
  Controller,
  Global,
  Logger,
  Module,
  Post,
  Res,
  StreamableFile
} from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import type { Server } from 'node:http'
import request from 'supertest'

import { BymaxCoreModule } from '../core.module'
import { BYMAX_CORRELATION_PROVIDER } from '../core.tokens'
import { Idempotent } from './idempotency.decorator'
import { IdempotencyInterceptor } from './idempotency.interceptor'
import { InMemoryIdempotencyStore } from './idempotency.memory-store'
import { BYMAX_IDEMPOTENCY_STORE } from './idempotency.store'

const store = new InMemoryIdempotencyStore()
const current: { id?: string | undefined } = {}
const bounded = { unscoped: true, maxBodyBytes: 8 } as const
const secret = 'hunter2-hunter2'

@Controller('r')
class ReplayController {
  @Post('bad')
  @Idempotent({ unscoped: true })
  bad(): never {
    throw new BadRequestException('nope')
  }

  @Post('big')
  @Idempotent(bounded)
  big(): { secret: string } {
    return { secret }
  }

  @Post('small')
  @Idempotent(bounded)
  small(): number {
    return 1
  }

  @Post('big-failure')
  @Idempotent(bounded)
  bigFailure(@Res({ passthrough: true }) response: { status(code: number): void }): {
    secret: string
  } {
    response.status(503)
    return { secret }
  }

  @Post('streamed')
  @Idempotent(bounded)
  streamed(): StreamableFile {
    return new StreamableFile(Buffer.from(secret))
  }

  @Post('plain')
  plain(): { ok: true } {
    return { ok: true }
  }
}

@Global()
@Module({
  providers: [
    { provide: BYMAX_CORRELATION_PROVIDER, useValue: { getCorrelationId: () => current.id } }
  ],
  exports: [BYMAX_CORRELATION_PROVIDER]
})
class CorrelationModule {}

@Module({
  imports: [CorrelationModule, BymaxCoreModule.forRoot({})],
  controllers: [ReplayController],
  providers: [
    { provide: BYMAX_IDEMPOTENCY_STORE, useValue: store },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }
  ]
})
class ReplayModule {}

describe('@Idempotent, replay identity and reach', () => {
  let app: INestApplication
  let warn: jest.SpyInstance

  const post = (path: string, key: string, id = 'req'): request.Test =>
    request(app.getHttpServer() as Server)
      .post(path)
      .set('Idempotency-Key', key)
      .set('x-rid', id)

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ReplayModule] }).compile()
    app = moduleRef.createNestApplication()
    app.use(
      (
        req: { headers: Record<string, string | undefined> },
        res: { setHeader(name: string, value: string): void },
        next: () => void
      ) => {
        current.id = req.headers['x-rid']
        res.setHeader('x-request-id', current.id ?? '')
        next()
      }
    )
    await app.init()
  })
  afterAll(async () => app.close())
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => jest.restoreAllMocks())

  it('replays an error envelope byte for byte, the new id only in the header', async () => {
    const first = await post('/r/bad', 'k-bad', 'req-first')
    const second = await post('/r/bad', 'k-bad', 'req-second')

    expect(second.status).toBe(400)
    expect(second.headers['idempotent-replayed']).toBe('true')
    expect(second.text).toBe(first.text)
    expect(second.body.correlationId).toBe('req-first')
    expect(second.headers['x-request-id']).toBe('req-second')
  })

  it('logs one warning, without the body, for an answer over maxBodyBytes', async () => {
    const first = await post('/r/big', 'k-big')
    await post('/r/big', 'k-big')

    expect(first.body).toEqual({ secret })
    expect(warn.mock.calls).toEqual([
      [
        {
          event: 'CORE_IDEMPOTENCY_BODY_TOO_LARGE',
          message: 'The answer is over maxBodyBytes and is not kept for replay'
        }
      ]
    ])
  })

  it.each([
    ['an answer within the bound', '/r/small'],
    ['a streamed answer longer than the bound', '/r/streamed'],
    ['an answer over the bound that is not kept at any size', '/r/big-failure']
  ])('logs nothing for %s', async (_name, path) => {
    await post(path, `k-${path}`)

    expect(warn).not.toHaveBeenCalled()
  })

  it('leaves the store untouched on a route without the decorator', async () => {
    const spies = (['begin', 'complete', 'release'] as const).map((name) => jest.spyOn(store, name))
    const res = await post('/r/plain', 'has space')

    expect(res.status).toBe(201)
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })
})
