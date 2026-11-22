/**
 * Unit and end-to-end tests for the request deadline of `applyHttpFloors`.
 *
 * Layer: integration.
 * Goal: a request that a slow guard holds is answered `504` in the error envelope once, at the
 * deadline, before the handler could run; an excluded path and a run with no deadline are untouched;
 * the signal a handler is given is aborted by the deadline; and the options are checked at boot.
 * Mocks: none; a real Nest application on Express, driven with supertest.
 */
import { CanActivate, Controller, Get, Module, UseGuards } from '@nestjs/common'
import { Logger } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { BymaxCoreModule } from '../core.module'
import { BYMAX_GATEWAY_TIMEOUT } from '../envelope/error-codes'
import { HandlerSignal } from '../handler-timeout/handler-timeout.decorators'
import { applyHttpFloors } from './http-floors'

/** Resolves after `ms` milliseconds. */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** What the handlers saw, reset for each test. */
const seen: { reached: number; aborted: boolean | undefined } = { reached: 0, aborted: undefined }

/** A guard that holds the request for `300` milliseconds, then lets it through. */
class SlowGuard implements CanActivate {
  async canActivate(): Promise<boolean> {
    await sleep(300)
    return true
  }
}

@Controller()
class ProbeController {
  @UseGuards(SlowGuard)
  @Get('guarded')
  guarded(@HandlerSignal() signal: AbortSignal | undefined): { ok: true } {
    seen.reached += 1
    seen.aborted = signal?.aborted
    return { ok: true }
  }

  @UseGuards(SlowGuard)
  @Get('events/stream')
  events(): { ok: true } {
    return { ok: true }
  }

  @Get('fast')
  fast(): { ok: true } {
    return { ok: true }
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

/** A started application with `floors`. */
async function start(floors: object): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile()
  const app = moduleRef.createNestApplication()
  await applyHttpFloors(app, floors as never)
  await app.init()
  return app
}

describe('the request deadline', () => {
  let app: INestApplication

  beforeEach(() => {
    seen.reached = 0
    seen.aborted = undefined
  })

  afterEach(async () => {
    await app.close()
  })

  it('answers 504 in the envelope at the deadline when a guard holds the request, once', async () => {
    const errors = jest.spyOn(Logger.prototype, 'error')
    app = await start({ requestDeadline: { timeoutMs: 100, excludePaths: [] } })

    const started = Date.now()
    const answer = await request(app.getHttpServer()).get('/guarded')

    expect(answer.status).toBe(504)
    expect(answer.body).toMatchObject({
      statusCode: 504,
      code: BYMAX_GATEWAY_TIMEOUT,
      path: '/guarded'
    })
    expect(Date.now() - started).toBeLessThan(290)
    await sleep(350)
    expect(seen.aborted).toBe(true)
    // The guard let the request through after the answer: nothing is written, nothing is logged.
    expect(seen.reached).toBe(1)
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })

  it('leaves a request that answers in time alone', async () => {
    app = await start({ requestDeadline: { timeoutMs: 100, excludePaths: [] } })

    const answer = await request(app.getHttpServer()).get('/fast')

    expect(answer.status).toBe(200)
    expect(answer.body).toEqual({ ok: true })
  })

  it('leaves an excluded path unbounded, a segment boundary at a time', async () => {
    app = await start({ requestDeadline: { timeoutMs: 100, excludePaths: ['/events'] } })

    expect((await request(app.getHttpServer()).get('/events/stream')).status).toBe(200)
    expect((await request(app.getHttpServer()).get('/guarded')).status).toBe(504)
  })

  it('bounds nothing when the deadline is not asked for', async () => {
    app = await start({})

    const answer = await request(app.getHttpServer()).get('/guarded')

    expect(answer.status).toBe(200)
    expect(seen.aborted).toBeUndefined()
  })
})

describe('the request deadline beside the handler timeout', () => {
  /** A slow handler, with no guard, so only the two bounds are in play. */
  @Controller()
  class SlowController {
    @Get('slow')
    async slow(): Promise<{ ok: true }> {
      await sleep(500)
      return { ok: true }
    }
  }

  /** A started application with the module and the floors. */
  async function both(deadlineMs: number, handlerMs: number): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({
      imports: [
        BymaxCoreModule.forRoot({ handlerTimeout: { enabled: true, timeoutMs: handlerMs } })
      ],
      controllers: [SlowController]
    }).compile()
    const app = moduleRef.createNestApplication()
    await applyHttpFloors(app, { requestDeadline: { timeoutMs: deadlineMs, excludePaths: [] } })
    await app.init()
    return app
  }

  it.each([
    ['the deadline is the shorter', 100, 300],
    ['the handler timeout is the shorter', 300, 100]
  ])('answers 504 once, in the envelope, when %s', async (_name, deadlineMs, handlerMs) => {
    const errors = jest.spyOn(Logger.prototype, 'error')
    const app = await both(deadlineMs, handlerMs)

    const started = Date.now()
    const answer = await request(app.getHttpServer()).get('/slow')
    const elapsed = Date.now() - started
    await sleep(700)

    expect(answer.status).toBe(504)
    expect(answer.body).toMatchObject({ statusCode: 504, code: BYMAX_GATEWAY_TIMEOUT })
    expect(elapsed).toBeLessThan(Math.min(deadlineMs, handlerMs) + 150)
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
    await app.close()
  })
})

describe('the options of the request deadline', () => {
  const failure = async (requestDeadline: unknown): Promise<Error | undefined> => {
    const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile()
    const probe = moduleRef.createNestApplication()
    try {
      await applyHttpFloors(probe, { requestDeadline } as never)
    } catch (error) {
      return error as Error
    } finally {
      await probe.close()
    }
    return undefined
  }

  it.each([
    ['no excludePaths', { timeoutMs: 100 }, 'requestDeadline.excludePaths'],
    [
      'an excludePaths that is not a list',
      { timeoutMs: 100, excludePaths: '/a' },
      'requestDeadline.excludePaths'
    ],
    [
      'an entry that is not a path',
      { timeoutMs: 100, excludePaths: ['a'] },
      'entry 1 must be a path'
    ],
    ['no timeout', { excludePaths: [] }, 'requestDeadline.timeoutMs'],
    ['a timeout that is zero', { timeoutMs: 0, excludePaths: [] }, 'requestDeadline.timeoutMs'],
    [
      '1001 excluded paths',
      { timeoutMs: 100, excludePaths: Array.from({ length: 1001 }, (_, i) => `/p${i}`) },
      'the options could not be read'
    ]
  ])('are refused at boot for %s', async (_name, requestDeadline, text) => {
    expect((await failure(requestDeadline))?.message).toContain(text)
  })

  it('take 1000 excluded paths, and an empty list', async () => {
    expect(
      await failure({
        timeoutMs: 100,
        excludePaths: Array.from({ length: 1000 }, (_, i) => `/p${i}`)
      })
    ).toBeUndefined()
    expect(await failure({ timeoutMs: 100, excludePaths: [] })).toBeUndefined()
  })
})
