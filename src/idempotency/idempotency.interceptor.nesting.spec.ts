/**
 * Integration tests for `IdempotencyInterceptor` applied more than once to a request, and for outer
 * interceptors that call the handler chain again.
 *
 * Layer: integration.
 * Goal: a second instance inside the first one passes the call through, one that cannot be told to be
 * inside it answers `409`, and so does a call from outside while the claim is held.
 * Mocks: none; real Express and Fastify Nest applications over supertest.
 */
import { BadRequestException, Controller, Injectable, Module, Post } from '@nestjs/common'
import { RequestTimeoutException } from '@nestjs/common'
import { UseInterceptors } from '@nestjs/common'
import type {
  CallHandler,
  ExecutionContext,
  INestApplication,
  NestInterceptor,
  Provider,
  Type
} from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { catchError, from, merge, mergeMap, Observable, retry, take, throwError } from 'rxjs'
import { timeout, timer } from 'rxjs'
import request from 'supertest'
import { once } from 'node:events'
import type { Socket } from 'node:net'
import { Agent, request as send } from 'node:http'
import type { IncomingMessage, Server } from 'node:http'

import { BymaxCoreModule } from '../core.module'
import { Idempotent } from './idempotency.decorator'
import { IdempotencyInterceptor } from './idempotency.interceptor'
import { InMemoryIdempotencyStore } from './idempotency.memory-store'
import { BYMAX_IDEMPOTENCY_STORE } from './idempotency.store'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const runs = { count: 0 }

@Controller('n')
class PlainController {
  @Post('ok')
  @Idempotent({ unscoped: true })
  ok(): { n: number } {
    runs.count += 1
    return { n: runs.count }
  }

  @Post('slow')
  @Idempotent({ unscoped: true })
  async slow(): Promise<{ n: number }> {
    runs.count += 1
    await sleep(80)
    return { n: runs.count }
  }

  @Post('boom')
  @Idempotent({ unscoped: true })
  boom(): never {
    runs.count += 1
    throw new Error('boom')
  }

  @Post('bad')
  @Idempotent({ unscoped: true })
  bad(): never {
    runs.count += 1
    throw new BadRequestException({ code: 'APP_BAD', message: 'no' })
  }
}

@Controller('n')
@UseInterceptors(IdempotencyInterceptor)
class ControllerTwice {
  @Post('ok')
  @Idempotent({ unscoped: true })
  ok(): { n: number } {
    runs.count += 1
    return { n: runs.count }
  }
}

@Controller('n')
class MethodTwice {
  @Post('ok')
  @Idempotent({ unscoped: true })
  @UseInterceptors(IdempotencyInterceptor, IdempotencyInterceptor)
  ok(): { n: number } {
    runs.count += 1
    return { n: runs.count }
  }
}

/** Calls the chain again, from outside, after an error. */
@Injectable()
class RetryOnce implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(retry(1))
  }
}

/** Asks for a new chain from inside the error callback of the first one. */
@Injectable()
class CatchAndHandleAgain implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(catchError(() => next.handle()))
  }
}

/** Gives up on the first chain and asks for another. */
@Injectable()
class TimeoutAndHandleAgain implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      timeout(20),
      catchError(() => next.handle())
    )
  }
}

/** Gives up on a slow chain, which unsubscribes it. */
@Injectable()
class GiveUp implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      timeout(20),
      catchError(() => throwError(() => new RequestTimeoutException()))
    )
  }
}

/** Starts a second chain while the first one is still running. */
@Injectable()
class Hedge implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return merge(next.handle(), timer(20).pipe(mergeMap(() => next.handle()))).pipe(take(1))
  }
}

/** Waits for something before it calls the chain. */
@Injectable()
class Later implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return from(sleep(5)).pipe(mergeMap(() => next.handle()))
  }
}

const interceptor = (useClass: Type<NestInterceptor>): Provider => ({
  provide: APP_INTERCEPTOR,
  useClass
})

const queued: (() => void)[] = []
/** Runs what was queued from its own async context, not from the caller's. */
let drain: NodeJS.Timeout

/** Hands the rest of the chain to a queue that something else drains. */
@Injectable()
class Queue implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return new Observable((subscriber) => {
      queued.push(() => next.handle().subscribe(subscriber))
    })
  }
}

beforeAll(() => {
  drain = setInterval(() => queued.splice(0).forEach((job) => job()), 2)
})
afterAll(() => clearInterval(drain))

async function* generate(): AsyncGenerator<{ n: number }> {
  runs.count += 1
  await sleep(1)
  yield { n: runs.count }
}

@Controller('n')
class GeneratorController {
  @Post('ok')
  @Idempotent({ unscoped: true })
  ok(): Observable<{ n: number }> {
    return from(generate())
  }
}

/** A module serving `controller`, with these global interceptors in order. */
function moduleOf(controller: Type<unknown>, ...global: Type<NestInterceptor>[]): Type<unknown> {
  @Module({
    imports: [BymaxCoreModule.forRoot({})],
    controllers: [controller],
    providers: [
      { provide: BYMAX_IDEMPOTENCY_STORE, useValue: new InMemoryIdempotencyStore() },
      ...global.map(interceptor)
    ]
  })
  class App {}
  return App
}

const open: INestApplication[] = []

async function boot(module: Type<unknown>, fastify: boolean): Promise<Server> {
  const moduleRef = await Test.createTestingModule({ imports: [module] }).compile()
  const app = fastify
    ? moduleRef.createNestApplication(new FastifyAdapter())
    : moduleRef.createNestApplication()
  await app.init()
  if (fastify) await app.getHttpAdapter().getInstance().ready()
  open.push(app)
  return app.getHttpServer() as Server
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((app) => app.close()))
  runs.count = 0
})

/** One answer of {@link flood}. */
interface Answer {
  readonly key: string
  readonly status: number
  readonly replayed: boolean
}

/**
 * Posts one request per key over 64 kept-alive connections: fewer than the listen backlog holds, so
 * none is reset.
 */
async function flood(port: number, keys: string[]): Promise<Answer[]> {
  const agent = new Agent({ keepAlive: true, maxSockets: 64 })
  try {
    return await Promise.all(
      keys.map(async (key) => {
        const [status, replayed] = await over(agent, port, '/n/slow', key)
        return { key, status: status as number, replayed: replayed === 'true' }
      })
    )
  } finally {
    agent.destroy()
  }
}

const post = (server: Server, path: string, key = 'same'): request.Test =>
  request(server).post(path).set('Idempotency-Key', key)

/** Two requests with one key: both answers, and how many times the handler ran. */
async function twice(server: Server): Promise<unknown[]> {
  const first = await post(server, '/n/ok')
  const second = await post(server, '/n/ok')
  return [
    first.status,
    first.headers['idempotent-replayed'],
    second.status,
    second.headers['idempotent-replayed'],
    second.body,
    runs.count
  ]
}

const replayedOnce = [201, undefined, 201, 'true', { n: 1 }, 1]

/** One keyed POST through `agent`: the status, the replay header and the connection it went over. */
async function over(agent: Agent, port: number, path: string, key: string): Promise<unknown[]> {
  const sent = send({ agent, port, path, method: 'POST', headers: { 'idempotency-key': key } })
  sent.end()
  const [answer] = (await once(sent, 'response')) as [IncomingMessage]
  const socket = sent.socket as Socket
  answer.resume()
  await once(answer, 'end')
  return [answer.statusCode, answer.headers['idempotent-replayed'], socket]
}

describe.each([
  ['Express', false],
  ['Fastify', true]
])('IdempotencyInterceptor registered a second time, on %s', (_platform, fastify) => {
  it.each([
    ['globally and by @Idempotent', moduleOf(PlainController, IdempotencyInterceptor)],
    ['on the controller and by @Idempotent', moduleOf(ControllerTwice)],
    ['twice more on the method', moduleOf(MethodTwice)],
    [
      'globally, with an async interceptor between the two',
      moduleOf(PlainController, IdempotencyInterceptor, Later)
    ],
    [
      'globally, for a handler fed by an async generator',
      moduleOf(GeneratorController, IdempotencyInterceptor)
    ]
  ])('runs once and replays when it is registered %s', async (_name, module) => {
    expect(await twice(await boot(module, fastify))).toEqual(replayedOnce)
  })

  it('stores and replays 409 when an interceptor between the two loses the async context', async () => {
    const server = await boot(moduleOf(PlainController, IdempotencyInterceptor, Queue), fastify)

    const answer = await post(server, '/n/ok')
    const repeat = await post(server, '/n/ok')

    expect([answer.status, answer.body.code, runs.count]).toEqual([
      409,
      'BYMAX_IDEMPOTENCY_IN_PROGRESS',
      0
    ])
    expect([repeat.status, repeat.headers['idempotent-replayed'], repeat.body.code]).toEqual([
      409,
      'true',
      'BYMAX_IDEMPOTENCY_IN_PROGRESS'
    ])
  })

  it('protects the next request of a connection whose first one was given up', async () => {
    await boot(moduleOf(PlainController, GiveUp, IdempotencyInterceptor), fastify)
    const app = open[0] as INestApplication
    await app.listen(0, '127.0.0.1')
    const port = Number(new URL(await app.getUrl()).port)
    const agent = new Agent({ keepAlive: true, maxSockets: 1 })

    const first = await over(agent, port, '/n/slow', 'a')
    const second = await over(agent, port, '/n/ok', 'b')
    const third = await over(agent, port, '/n/ok', 'b')
    agent.destroy()

    expect([first[0], second.slice(0, 2), third.slice(0, 2), runs.count]).toEqual([
      408,
      [201, undefined],
      [201, 'true'],
      2
    ])
    expect(new Set([first[2], second[2], third[2]]).size).toBe(1)
  })

  it('runs each of 500 keys once under 1000 requests, 64 in flight', async () => {
    await boot(moduleOf(PlainController, IdempotencyInterceptor), fastify)
    const app = open[0] as INestApplication
    await app.listen(0, '127.0.0.1')
    const port = Number(new URL(await app.getUrl()).port)
    const keys = Array.from({ length: 1000 }, (_, index) => `k${index % 500}`)

    const answers = await flood(port, keys)

    const ran = answers.filter((one) => one.status === 201 && !one.replayed)
    expect(runs.count).toBe(500)
    expect(ran).toHaveLength(500)
    expect(new Set(ran.map((one) => one.key)).size).toBe(500)
    expect(answers.filter((one) => one.status !== 201 && one.status !== 409)).toEqual([])
  }, 60_000)

  it('does the same in two applications of one process', async () => {
    const one = await boot(moduleOf(PlainController, IdempotencyInterceptor), fastify)
    const two = await boot(moduleOf(PlainController, IdempotencyInterceptor), fastify)

    expect(await twice(one)).toEqual(replayedOnce)
    runs.count = 0
    expect(await twice(two)).toEqual(replayedOnce)
  })

  it.each([
    ['retries after a handler error', RetryOnce, '/n/boom'],
    ['retries after a handler 4xx', RetryOnce, '/n/bad'],
    ['calls again from its catchError', CatchAndHandleAgain, '/n/boom'],
    ['calls again after its timeout', TimeoutAndHandleAgain, '/n/slow'],
    ['starts a second call while the first runs', Hedge, '/n/slow']
  ])('answers 409 to an outer interceptor that %s', async (_name, outer, path) => {
    const server = await boot(moduleOf(PlainController, outer), fastify)

    const answer = await post(server, path)

    expect([answer.status, answer.body.code, runs.count]).toEqual([
      409,
      'BYMAX_IDEMPOTENCY_IN_PROGRESS',
      1
    ])
  })
})
