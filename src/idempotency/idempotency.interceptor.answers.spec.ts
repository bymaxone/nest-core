/**
 * Integration tests for what `@Idempotent` keeps of an answer and when it gives a claim back.
 *
 * Layer: integration.
 * Goal: a replay is byte-equal to the first answer on Express and on Fastify, a status the handler set is kept,
 * an answer that cannot be replayed or serialised still answers and leaves the claim to a 409, and a caller
 * that leaves while the handler runs does not free the key.
 * Mocks: none; real Express and Fastify Nest applications over supertest, with an outer timeout interceptor.
 */
import {
  CallHandler,
  Controller,
  ExecutionContext,
  Injectable,
  Module,
  NestInterceptor,
  Post,
  Res,
  StreamableFile
} from '@nestjs/common'
import type { INestApplication, Type } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { Readable } from 'node:stream'
import { Observable, timeout } from 'rxjs'
import request from 'supertest'
import type { Server } from 'node:http'

import { BymaxCoreModule } from '../core.module'
import { Idempotent } from './idempotency.decorator'
import { InMemoryIdempotencyStore } from './idempotency.memory-store'
import { BYMAX_IDEMPOTENCY_STORE } from './idempotency.store'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** How many times a handler ran. */
const runs = { count: 0 }

/** A row from a database: a class instance holding a `Date`. */
class Row {
  constructor(
    readonly id: number,
    readonly createdAt: Date
  ) {}
}

/** An instance that decides its own JSON. */
class Custom {
  toJSON(): { custom: true } {
    return { custom: true }
  }
}

/** An instance whose JSON changes each time it is serialised. */
class Unstable {
  private calls = 0

  toJSON(): { calls: number } {
    this.calls += 1
    return { calls: this.calls }
  }
}

/** Gives up on the handler after 50 ms, the way an application-wide timeout does. */
@Injectable()
class Outer implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(timeout(50))
  }
}

const unscoped = { unscoped: true } as const

@Controller('a')
class AnswersController {
  @Post('slow')
  @Idempotent(unscoped)
  async slow(): Promise<{ done: true }> {
    runs.count += 1
    await sleep(300)
    return { done: true }
  }

  @Post('row')
  @Idempotent(unscoped)
  row(): Row {
    runs.count += 1
    return new Row(1, new Date(0))
  }

  @Post('date')
  @Idempotent(unscoped)
  date(): { at: Date } {
    runs.count += 1
    return { at: new Date(0) }
  }

  @Post('custom')
  @Idempotent(unscoped)
  custom(): Custom {
    runs.count += 1
    return new Custom()
  }

  @Post('string')
  @Idempotent(unscoped)
  string(): string {
    runs.count += 1
    return 'hello "world"'
  }

  @Post('number')
  @Idempotent(unscoped)
  number(): number {
    runs.count += 1
    return 5
  }

  @Post('null')
  @Idempotent(unscoped)
  nothing(): null {
    runs.count += 1
    return null
  }

  @Post('buffer')
  @Idempotent(unscoped)
  buffer(): Buffer {
    runs.count += 1
    return Buffer.from('hi')
  }

  @Post('file')
  @Idempotent(unscoped)
  file(): StreamableFile {
    runs.count += 1
    return new StreamableFile(Buffer.from('hi'))
  }

  @Post('stream')
  @Idempotent(unscoped)
  stream(): Readable {
    runs.count += 1
    return Readable.from(['hi'])
  }

  @Post('bigint')
  @Idempotent(unscoped)
  bigint(): { n: bigint } {
    runs.count += 1
    return { n: BigInt(1) }
  }

  @Post('cyclic')
  @Idempotent(unscoped)
  cyclic(): object {
    runs.count += 1
    const loop: { self?: unknown } = {}
    loop.self = loop
    return loop
  }

  @Post('throwing')
  @Idempotent(unscoped)
  throwing(): object {
    runs.count += 1
    return {
      toJSON(): never {
        throw new Error('no json')
      }
    }
  }

  @Post('accepted')
  @Idempotent(unscoped)
  accepted(@Res({ passthrough: true }) response: { status(code: number): unknown }): { ok: true } {
    runs.count += 1
    response.status(202)
    return { ok: true }
  }

  @Post('unstable')
  @Idempotent(unscoped)
  unstable(): Unstable {
    runs.count += 1
    return new Unstable()
  }

  @Post('refused')
  @Idempotent(unscoped)
  refused(@Res({ passthrough: true }) response: { status(code: number): unknown }): { ok: false } {
    runs.count += 1
    response.status(400)
    return { ok: false }
  }

  @Post('failed')
  @Idempotent(unscoped)
  failed(@Res({ passthrough: true }) response: { status(code: number): unknown }): { ok: false } {
    runs.count += 1
    response.status(500)
    return { ok: false }
  }
}

const store = new InMemoryIdempotencyStore()
const common = [{ provide: BYMAX_IDEMPOTENCY_STORE, useValue: store }]

@Module({
  imports: [BymaxCoreModule.forRoot({})],
  controllers: [AnswersController],
  providers: common
})
class PlainModule {}

@Module({
  imports: [BymaxCoreModule.forRoot({})],
  controllers: [AnswersController],
  providers: [...common, { provide: APP_INTERCEPTOR, useClass: Outer }]
})
class TimedModule {}

/** An application of `module` on Express, or on Fastify. */
async function open(module: Type<unknown>, fastify: boolean): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [module] }).compile()
  const app = fastify
    ? moduleRef.createNestApplication(new FastifyAdapter())
    : moduleRef.createNestApplication()
  await app.init()
  if (fastify) await app.getHttpAdapter().getInstance().ready()
  return app
}

const send = (app: INestApplication, path: string, key: string): request.Test =>
  request(app.getHttpServer() as Server)
    .post(path)
    .set('Idempotency-Key', key)
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => done(null, Buffer.concat(chunks)))
    })

/** The raw bytes of an answer. */
const bytes = (res: request.Response): string => (res.body as Buffer).toString('utf8')

beforeEach(() => {
  runs.count = 0
})

describe.each([
  ['Express', false],
  ['Fastify', true]
])('@Idempotent answers on %s', (platform, fastify) => {
  let app: INestApplication
  let timed: INestApplication
  const key = (name: string): string => `${platform}-${name}`

  beforeAll(async () => {
    app = await open(PlainModule, fastify)
    timed = await open(TimedModule, fastify)
  })
  afterAll(async () => {
    await app.close()
    await timed.close()
  })

  it.each([
    ['a class instance holding a Date', 'row'],
    ['an object holding a Date', 'date'],
    ['an instance with its own toJSON', 'custom'],
    ['a string', 'string'],
    ['a number', 'number'],
    ['null', 'null']
  ])('replays %s byte for byte', async (_name, path) => {
    const first = await send(app, `/a/${path}`, key(path))
    const second = await send(app, `/a/${path}`, key(path))

    expect(second.headers['idempotent-replayed']).toBe('true')
    expect([second.status, bytes(second), second.headers['content-type']]).toEqual([
      first.status,
      bytes(first),
      first.headers['content-type']
    ])
    expect(runs.count).toBe(1)
  })

  it.each([
    ['a Buffer', 'buffer'],
    ['a StreamableFile', 'file'],
    ['a stream', 'stream']
  ])('answers %s once and refuses its replay with 409', async (_name, path) => {
    const first = await send(app, `/a/${path}`, key(path))
    const second = await send(app, `/a/${path}`, key(path))

    expect(first.status).toBe(201)
    expect(second.status).toBe(409)
    expect(JSON.parse(bytes(second)).code).toBe('BYMAX_IDEMPOTENCY_NOT_REPLAYABLE')
    expect(runs.count).toBe(1)
  })

  it.each([['bigint'], ['cyclic'], ['throwing']])(
    'answers a result that cannot be serialised (%s), and leaves its retries to a 409',
    async (path) => {
      const first = await send(app, `/a/${path}`, key(path)).timeout(2000)
      const second = await send(app, `/a/${path}`, key(path)).timeout(2000)

      expect(first.status).toBe(500)
      expect(second.status).toBe(409)
      expect(JSON.parse(bytes(second)).code).toBe('BYMAX_IDEMPOTENCY_NOT_REPLAYABLE')
      expect(runs.count).toBe(1)
    }
  )

  it('replays the status a handler set through the response', async () => {
    const first = await send(app, '/a/accepted', key('accepted'))
    const second = await send(app, '/a/accepted', key('accepted'))

    expect([first.status, second.status]).toEqual([202, 202])
    expect(bytes(second)).toBe(bytes(first))
    expect(runs.count).toBe(1)
  })

  it('refuses the replay of an answer whose status the handler set to a client error', async () => {
    const first = await send(app, '/a/refused', key('refused'))
    const second = await send(app, '/a/refused', key('refused'))

    expect([first.status, second.status]).toEqual([400, 409])
    expect(JSON.parse(bytes(second)).code).toBe('BYMAX_IDEMPOTENCY_NOT_REPLAYABLE')
    expect(runs.count).toBe(1)
  })

  it('lets the retry run again when the handler set a server error status', async () => {
    const first = await send(app, '/a/failed', key('failed'))
    const second = await send(app, '/a/failed', key('failed'))

    expect([first.status, second.status]).toEqual([500, 500])
    expect(second.headers['idempotent-replayed']).toBeUndefined()
    expect(runs.count).toBe(2)
  })

  it('refuses the replay of an answer whose serialisation changes between calls', async () => {
    const first = await send(app, '/a/unstable', key('unstable'))
    const second = await send(app, '/a/unstable', key('unstable'))

    expect(first.status).toBe(201)
    expect(second.status).toBe(409)
    expect(JSON.parse(bytes(second)).code).toBe('BYMAX_IDEMPOTENCY_NOT_REPLAYABLE')
    expect(runs.count).toBe(1)
  })

  it('keeps the key in progress when the caller times out while the handler runs', async () => {
    const first = await send(timed, '/a/slow', key('timeout'))
    await sleep(20)
    const retry = await send(timed, '/a/slow', key('timeout'))
    await sleep(350)

    expect(first.status).toBe(500)
    expect(retry.status).toBe(409)
    expect(JSON.parse(bytes(retry)).code).toBe('BYMAX_IDEMPOTENCY_IN_PROGRESS')
    expect(runs.count).toBe(1)
  })
})
