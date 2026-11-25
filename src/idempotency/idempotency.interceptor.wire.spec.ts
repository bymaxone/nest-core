/**
 * Integration tests for the answer `@Idempotent` stores: the bytes the client was sent, taken at the wire.
 *
 * Layer: integration.
 * Goal: outer serialisers and envelopes neither leak into nor wrap a replay, a client that leaves still
 * has its answer stored, an outer failure after the handler releases the claim, a store that fails does
 * not stop the answer, answers that cannot be held pass through, a filter's client error is stored from
 * the wire, and a request deadline in either order ends the request once.
 * Mocks: none beyond a failing store method; real Express and Fastify Nest applications over supertest.
 */
import {
  BadRequestException,
  CallHandler,
  ClassSerializerInterceptor,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Header,
  Injectable,
  InternalServerErrorException,
  Module,
  NestInterceptor,
  Post,
  Res
} from '@nestjs/common'
import type { INestApplication, Type } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { Exclude } from 'class-transformer'
import { request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { map, Observable } from 'rxjs'
import request from 'supertest'

import { BymaxCoreModule } from '../core.module'
import { applyHttpFloors } from '../http'
import { Idempotent } from './idempotency.decorator'
import { InMemoryIdempotencyStore } from './idempotency.memory-store'
import { BYMAX_IDEMPOTENCY_STORE } from './idempotency.store'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const runs = { count: 0, replays: 0 }
const unscoped = { unscoped: true } as const

/** A row with a field no client may see. */
class Account {
  readonly id = 7
  @Exclude() readonly password = 'hunter2'
}

/** Wraps every value in an envelope, the way an application-wide response mapper does. */
@Injectable()
class Envelope implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((data) => ({ data })))
  }
}

/** Refuses a second call of the same route with a status of its own, after the handler returned. */
@Injectable()
class Late implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const mode = context.switchToHttp().getRequest<{ headers: Record<string, string> }>().headers[
      'x-late'
    ]
    return next.handle().pipe(
      map((value) => {
        if (mode === 'forbidden' && runs.replays++ >= 0) throw new ForbiddenException()
        if (mode === 'fail') throw new InternalServerErrorException()
        return value
      })
    )
  }
}

@Controller('w')
class WireController {
  @Post('account')
  @Idempotent(unscoped)
  account(): Account {
    runs.count += 1
    return new Account()
  }

  @Post('plain')
  @Idempotent(unscoped)
  plain(): { ok: true } {
    runs.count += 1
    return { ok: true }
  }

  @Post('slow')
  @Idempotent(unscoped)
  async slow(): Promise<{ done: true }> {
    runs.count += 1
    await sleep(250)
    return { done: true }
  }

  @Post('slow-fail')
  @Idempotent(unscoped)
  async slowFail(): Promise<never> {
    runs.count += 1
    await sleep(250)
    throw new Error('late failure')
  }

  @Post('encoded')
  @Idempotent(unscoped)
  @Header('Content-Encoding', 'identity')
  encoded(): { ok: true } {
    runs.count += 1
    return { ok: true }
  }

  @Post('bad')
  @Idempotent(unscoped)
  bad(
    @Res({ passthrough: true })
    response: {
      header?(name: string, value: string): unknown
      setHeader?(name: string, value: string): unknown
    }
  ): never {
    runs.count += 1
    if (response.header) response.header('Set-Cookie', 'session=1')
    else response.setHeader?.('Set-Cookie', 'session=1')
    throw new BadRequestException('nope')
  }

  @Get('tagged')
  @Idempotent(unscoped)
  tagged(): { ok: true } {
    runs.count += 1
    return { ok: true }
  }
}

const common = (store: InMemoryIdempotencyStore): object[] => [
  { provide: BYMAX_IDEMPOTENCY_STORE, useValue: store }
]

/** A module with `interceptors` applied application-wide, in order. */
function moduleWith(
  store: InMemoryIdempotencyStore,
  ...interceptors: Type<NestInterceptor>[]
): Type<unknown> {
  @Module({
    imports: [BymaxCoreModule.forRoot({})],
    controllers: [WireController],
    providers: [
      ...common(store),
      ...interceptors.map((useClass) => ({ provide: APP_INTERCEPTOR, useClass }))
    ] as never
  })
  class WireModule {}
  return WireModule
}

/** A started application. */
async function open(
  module: Type<unknown>,
  fastify: boolean,
  deadlineMs?: number
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [module] }).compile()
  const app = fastify
    ? moduleRef.createNestApplication(new FastifyAdapter())
    : moduleRef.createNestApplication()
  if (deadlineMs !== undefined) {
    await applyHttpFloors(app, {
      requestDeadline: { timeoutMs: deadlineMs, excludePaths: [] }
    } as never)
  }
  await app.init()
  if (fastify) await app.getHttpAdapter().getInstance().ready()
  return app
}

const post = (app: INestApplication, path: string, key: string): request.Test =>
  request(app.getHttpServer() as Server)
    .post(path)
    .set('Idempotency-Key', key)

describe.each([
  ['Express', false],
  ['Fastify', true]
])('the stored answer is the wire answer on %s', (platform, fastify) => {
  const key = (name: string): string => `${platform}-${name}`
  const apps: INestApplication[] = []
  const track = async (
    store: InMemoryIdempotencyStore,
    interceptors: Type<NestInterceptor>[],
    deadlineMs?: number
  ): Promise<INestApplication> => {
    const app = await open(moduleWith(store, ...interceptors), fastify, deadlineMs)
    apps.push(app)
    return app
  }
  beforeEach(() => {
    runs.count = 0
    runs.replays = 0
  })
  afterAll(async () => {
    await Promise.all(apps.map((app) => app.close()))
  })

  it('replays what an outer ClassSerializerInterceptor sent, without the excluded field', async () => {
    const app = await track(new InMemoryIdempotencyStore(), [ClassSerializerInterceptor])
    const first = await post(app, '/w/account', key('account'))
    const second = await post(app, '/w/account', key('account'))

    expect(first.text).not.toContain('hunter2')
    expect(second.text).toBe(first.text)
    expect(second.headers['idempotent-replayed']).toBe('true')
    expect(runs.count).toBe(1)
  })

  it('replays an outer envelope once, without wrapping it again', async () => {
    const app = await track(new InMemoryIdempotencyStore(), [Envelope])
    const first = await post(app, '/w/plain', key('envelope'))
    const second = await post(app, '/w/plain', key('envelope'))

    expect(first.body).toEqual({ data: { ok: true } })
    expect(second.text).toBe(first.text)
    expect(second.headers['content-length']).toBe(String(Buffer.byteLength(second.text)))
    expect(runs.count).toBe(1)
  })

  it('answers with an outer interceptor that throws another status on a replay, and does not store it', async () => {
    const app = await track(new InMemoryIdempotencyStore(), [Late])
    const first = await post(app, '/w/plain', key('late')).set('X-Late', 'none')
    const refused = await post(app, '/w/plain', key('late')).set('X-Late', 'forbidden')

    expect([first.status, refused.status]).toEqual([201, 403])
    expect(refused.headers['idempotent-replayed']).toBe('true')
    expect(runs.count).toBe(1)
  })

  it('releases the claim when an outer interceptor fails after the handler returned', async () => {
    const app = await track(new InMemoryIdempotencyStore(), [Late])
    const first = await post(app, '/w/plain', key('fail')).set('X-Late', 'fail')
    const retry = await post(app, '/w/plain', key('fail')).set('X-Late', 'fail')

    expect([first.status, retry.status]).toEqual([500, 500])
    expect(runs.count).toBe(2)
  })

  it('stores the answer of a client that left while the handler ran', async () => {
    const app = await track(new InMemoryIdempotencyStore(), [])
    await app.listen(0, '127.0.0.1')
    const { port } = (app.getHttpServer() as Server).address() as AddressInfo
    await new Promise<void>((resolve) => {
      const call = httpRequest(
        {
          port,
          host: '127.0.0.1',
          method: 'POST',
          path: '/w/slow',
          headers: { 'Idempotency-Key': key('gone') }
        },
        () => undefined
      )
      call.on('error', () => resolve())
      call.end()
      setTimeout(() => call.destroy(), 60)
    })
    await sleep(350)
    const retry = await post(app, '/w/slow', key('gone'))

    expect(retry.status).toBe(201)
    expect(retry.headers['idempotent-replayed']).toBe('true')
    expect(runs.count).toBe(1)
  })

  it('still sends the answer when the store fails to record it, and leaves the key in progress', async () => {
    const store = new InMemoryIdempotencyStore()
    jest.spyOn(store, 'complete').mockRejectedValue(new Error('down'))
    const app = await track(store, [])
    const first = await post(app, '/w/plain', key('down'))
    const retry = await post(app, '/w/plain', key('down'))

    expect(first.status).toBe(201)
    expect(first.body).toEqual({ ok: true })
    expect(retry.status).toBe(409)
    expect(retry.body.code).toBe('BYMAX_IDEMPOTENCY_IN_PROGRESS')
    expect(runs.count).toBe(1)
  })

  it('passes an encoded answer through untouched and refuses its replay', async () => {
    const app = await track(new InMemoryIdempotencyStore(), [])
    const first = await post(app, '/w/encoded', key('encoded'))
    const second = await post(app, '/w/encoded', key('encoded'))

    expect(first.status).toBe(201)
    expect(first.body).toEqual({ ok: true })
    expect(second.status).toBe(409)
    expect(second.body.code).toBe('BYMAX_IDEMPOTENCY_NOT_REPLAYABLE')
    expect(runs.count).toBe(1)
  })

  it('stores a client error from the wire, with the allow-listed headers and never a cookie', async () => {
    const app = await track(new InMemoryIdempotencyStore(), [])
    const first = await post(app, '/w/bad', key('bad'))
    const second = await post(app, '/w/bad', key('bad'))

    expect([first.status, second.status]).toEqual([400, 400])
    expect(second.text).toBe(first.text)
    expect(second.headers['set-cookie']).toBeUndefined()
    expect(second.headers['idempotent-replayed']).toBe('true')
    expect(runs.count).toBe(1)
  })
})

describe('a 304 from Express freshness', () => {
  it('is not stored as a body: its retry answers 409', async () => {
    runs.count = 0
    const app = await open(moduleWith(new InMemoryIdempotencyStore()), false)
    try {
      const get = (key: string, etag?: string): request.Test => {
        const call = request(app.getHttpServer() as Server)
          .get('/w/tagged')
          .set('Idempotency-Key', key)
        return etag === undefined ? call : call.set('If-None-Match', etag)
      }
      const primed = await get('prime')
      const etag = primed.headers['etag'] as string
      const first = await get('fresh', etag)
      const retry = await get('fresh', etag)

      expect(first.status).toBe(304)
      expect(retry.status).toBe(409)
      expect(retry.body.code).toBe('BYMAX_IDEMPOTENCY_NOT_REPLAYABLE')
      expect(runs.count).toBe(2)
    } finally {
      await app.close()
    }
  })
})

describe('the request deadline of applyHttpFloors on Express', () => {
  beforeEach(() => {
    runs.count = 0
  })

  it('gives the claim back when the handler fails after the deadline answered', async () => {
    const app = await open(moduleWith(new InMemoryIdempotencyStore()), false, 80)
    try {
      const first = await post(app, '/w/slow-fail', 'deadline-fails')
      await sleep(300)
      const later = await post(app, '/w/slow-fail', 'deadline-fails')

      expect([first.status, later.status]).toEqual([504, 504])
      expect(runs.count).toBe(2)
    } finally {
      await app.close()
    }
  })

  it('ends the request once when it answers while the handler runs, and keeps the retry out', async () => {
    const app = await open(moduleWith(new InMemoryIdempotencyStore()), false, 80)
    try {
      const first = await post(app, '/w/slow', 'deadline-running')
      const retry = await post(app, '/w/slow', 'deadline-running')
      await sleep(300)
      const later = await post(app, '/w/slow', 'deadline-running')

      expect([first.status, retry.status]).toEqual([504, 409])
      expect(retry.body.code).toBe('BYMAX_IDEMPOTENCY_IN_PROGRESS')
      expect([later.status, later.body.code]).toEqual([409, 'BYMAX_IDEMPOTENCY_NOT_REPLAYABLE'])
      expect(runs.count).toBe(1)
    } finally {
      await app.close()
    }
  })

  it('ends the request once when it answers while the store records the answer', async () => {
    const store = new InMemoryIdempotencyStore()
    const complete = store.complete.bind(store)
    jest.spyOn(store, 'complete').mockImplementation(async (...args) => {
      await sleep(200)
      return complete(...args)
    })
    const app = await open(moduleWith(store), false, 80)
    try {
      const first = await post(app, '/w/plain', 'deadline-store')
      await sleep(300)
      const retry = await post(app, '/w/plain', 'deadline-store')

      expect(first.status).toBe(504)
      expect([retry.status, retry.body]).toEqual([201, { ok: true }])
      expect(runs.count).toBe(1)
    } finally {
      await app.close()
    }
  })
})
