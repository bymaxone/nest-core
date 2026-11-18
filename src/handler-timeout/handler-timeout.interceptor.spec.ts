/**
 * Integration tests for the handler-timeout interceptor.
 *
 * Layer: integration.
 * Goal: a handler that has not answered within the timeout is answered `504` in the error envelope,
 * a route can opt out by decorator, by path or by being an SSE stream, the handler gets an abort
 * signal, and a response whose headers are already out is cut instead of rewritten.
 * Mocks: none; a real Express Nest application is driven over HTTP.
 */
import { Controller, Logger, Module, Post, Res, Sse } from '@nestjs/common'
import type { INestApplication, MessageEvent } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { Response } from 'express'
import type { Server } from 'node:http'
import { request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import { interval, map, Observable as RxObservable, take } from 'rxjs'
import type { Observable } from 'rxjs'
import request from 'supertest'

import { BymaxCoreModule } from '../core.module'
import { HandlerSignal, NoHandlerTimeout } from './handler-timeout.decorators'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** What the handlers observed, read back by the cases. */
const seen: {
  finished: boolean
  abortedAtEnd: boolean | undefined
  abortEvents: number
  tornDown: boolean
  watchTornDown: boolean
} = {
  tornDown: false,
  watchTornDown: false,
  finished: false,
  abortedAtEnd: undefined,
  abortEvents: 0
}

@Controller('t')
class SlowController {
  @Post('slow')
  async slow(@HandlerSignal() signal: AbortSignal | undefined): Promise<{ ok: true }> {
    await sleep(400)
    seen.finished = true
    seen.abortedAtEnd = signal?.aborted
    return { ok: true }
  }

  @Post('fast')
  fast(): { ok: true } {
    return { ok: true }
  }

  @Post('opted-out')
  @NoHandlerTimeout()
  async optedOut(): Promise<{ ok: true }> {
    await sleep(300)
    return { ok: true }
  }

  @Post('observable')
  observable(): RxObservable<{ ok: true }> {
    return new RxObservable((subscriber) => {
      const timer = setTimeout(() => {
        subscriber.next({ ok: true })
        subscriber.complete()
      }, 400)
      return () => {
        clearTimeout(timer)
        seen.tornDown = true
      }
    })
  }

  @Post('emit-forever')
  emitForever(): RxObservable<{ ok: true }> {
    return new RxObservable((subscriber) => {
      subscriber.next({ ok: true })
      return () => {
        seen.tornDown = true
      }
    })
  }

  @Post('watch-observable')
  watchObservable(): RxObservable<{ ok: true }> {
    return new RxObservable(() => () => {
      seen.watchTornDown = true
    })
  }

  @Post('late-error')
  async lateError(): Promise<{ ok: true }> {
    await sleep(150)
    throw new Error('late boom')
  }

  @Post('very-late-error')
  async veryLateError(): Promise<{ ok: true }> {
    await sleep(500)
    throw new Error('much later boom')
  }

  @Post('by-path/slow')
  async byPath(): Promise<{ ok: true }> {
    await sleep(300)
    return { ok: true }
  }

  @Post('by-path-old/slow')
  async byPathOld(): Promise<{ ok: true }> {
    await sleep(300)
    return { ok: true }
  }

  @Sse('events')
  events(): Observable<MessageEvent> {
    return interval(150).pipe(
      take(2),
      map((n): MessageEvent => ({ data: { n } }))
    )
  }

  @Post('watch')
  async watch(@HandlerSignal() signal: AbortSignal | undefined): Promise<{ ok: true }> {
    signal?.addEventListener('abort', () => {
      seen.abortEvents += 1
    })
    await sleep(600)
    return { ok: true }
  }

  @Post('out')
  async out(@Res() res: Response): Promise<void> {
    res.write('first')
    await sleep(600)
    res.end('second')
  }

  @Post('streams-after-returning')
  streamsAfterReturning(@Res() res: Response): void {
    res.write('first')
    setTimeout(() => res.end('second'), 300)
  }
}

@Module({ controllers: [SlowController] })
class SlowModule {}

/** Starts an application with the handler timeout configured as given. */
async function start(timeoutMs = 100): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      BymaxCoreModule.forRoot({
        handlerTimeout: { enabled: true, timeoutMs, excludePaths: ['/t/by-path'] }
      }),
      SlowModule
    ]
  }).compile()
  const app = moduleRef.createNestApplication()
  await app.init()
  return app
}

let app: INestApplication
const server = (): Server => app.getHttpServer() as Server

beforeAll(async () => {
  app = await start()
})

afterAll(async () => {
  await app.close()
})

beforeEach(() => {
  seen.finished = false
  seen.abortedAtEnd = undefined
  seen.abortEvents = 0
  seen.tornDown = false
  seen.watchTornDown = false
})

describe('handler timeout', () => {
  /**
   * The answer comes at the timeout, not when the handler finishes, and it is the typed 504.
   */
  it('answers 504 in the envelope at the timeout, not when the handler ends', async () => {
    const started = Date.now()
    const res = await request(server()).post('/t/slow')
    expect(res.status).toBe(504)
    expect(res.body).toMatchObject({ code: 'BYMAX_GATEWAY_TIMEOUT' })
    expect(Date.now() - started).toBeLessThan(350)
  })

  it('leaves a handler that answers in time alone', async () => {
    const res = await request(server()).post('/t/fast')
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ ok: true })
  })

  /**
   * The timeout frees the client, not the handler: the handler runs to its end, and the signal it
   * was given is aborted by then, which is what a handler that passes it on can act on.
   */
  it('lets the handler run on after the 504, with its signal aborted', async () => {
    await request(server()).post('/t/slow')
    expect(seen.finished).toBe(false)
    await sleep(450)
    expect(seen.finished).toBe(true)
    expect(seen.abortedAtEnd).toBe(true)
  })
})

describe('handler timeout, what a handler that returns an Observable sees', () => {
  /**
   * An Observable handler is held for one more bound after the 504, so an error it throws meanwhile
   * is logged, and is then unsubscribed, so its teardown runs. The response does not wait for it.
   */
  it('unsubscribes an Observable handler one bound after the 504, so its teardown runs', async () => {
    const res = await request(server()).post('/t/observable')
    expect(res.status).toBe(504)
    expect(seen.tornDown).toBe(false)
    await sleep(250)
    expect(seen.tornDown).toBe(true)
  })
})

describe('handler timeout, the whole duration', () => {
  /**
   * An Observable that emits and never completes leaves the request unanswered: the bound is the
   * handler's whole duration, not the time to its first value.
   */
  it('answers 504 for an Observable that emits and never completes, and releases it afterwards', async () => {
    const res = await request(server()).post('/t/emit-forever')
    expect(res.status).toBe(504)
    await sleep(350)
    expect(seen.tornDown).toBe(true)
  })

  it('releases an Observable handler when the client goes away', async () => {
    const listening = await start(5_000)
    await listening.listen(0, '127.0.0.1')
    try {
      const { port } = (listening.getHttpServer() as Server).address() as AddressInfo
      const req = httpRequest({
        port,
        host: '127.0.0.1',
        path: '/t/watch-observable',
        method: 'POST'
      })
      req.on('error', () => undefined)
      req.end()
      await sleep(150)
      expect(seen.watchTornDown).toBe(false)
      req.destroy()
      await sleep(150)
      expect(seen.watchTornDown).toBe(true)
    } finally {
      await listening.close()
    }
  })
})

describe('handler timeout, an error after the 504', () => {
  /**
   * A handler that throws after the client was answered would otherwise leave no trace: the error is
   * logged while the subscription is still held, which is one more bound after the 504.
   */
  it('logs an error the handler throws within a bound after the 504', async () => {
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    try {
      expect((await request(server()).post('/t/late-error')).status).toBe(504)
      await sleep(250)
      expect(logged.mock.calls.map((call) => (call[0] as { err: Error }).err.message)).toContain(
        'late boom'
      )
    } finally {
      logged.mockRestore()
    }
  })

  it('does not log an error that comes after the subscription was released', async () => {
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    try {
      expect((await request(server()).post('/t/very-late-error')).status).toBe(504)
      await sleep(600)
      expect(logged.mock.calls.map((call) => String(call[0])).join('\n')).not.toContain(
        'much later boom'
      )
    } finally {
      logged.mockRestore()
    }
  })
})

describe('handler timeout, opt-outs', () => {
  it('skips a route marked with @NoHandlerTimeout()', async () => {
    expect((await request(server()).post('/t/opted-out')).status).toBe(201)
  })

  it('skips a path listed in excludePaths, and the paths under it', async () => {
    expect((await request(server()).post('/t/by-path/slow')).status).toBe(201)
  })

  it('does not skip a path that only starts with an excluded prefix', async () => {
    expect((await request(server()).post('/t/by-path-old/slow')).status).toBe(504)
  })

  it('skips an SSE stream, which outlives the timeout by design', async () => {
    const res = await request(server()).get('/t/events').buffer(true)
    expect(res.status).toBe(200)
    expect(res.text.match(/data:/g)).toHaveLength(2)
  })
})

describe('handler timeout, what it bounds', () => {
  /**
   * The bound is the handler's own promise or observable. A handler that takes the response and
   * returns at once, then writes later, has finished as far as the interceptor can see.
   */
  it('does not bound what a handler writes after it has returned', async () => {
    const res = await request(server()).post('/t/streams-after-returning')
    expect(res.status).toBe(201)
    expect(res.text).toBe('firstsecond')
  })
})

describe('handler timeout, the connection', () => {
  /**
   * A client that goes away aborts the signal, so work done for nobody can stop.
   */
  it('aborts the signal when the client disconnects', async () => {
    const listening = await start(5_000)
    await listening.listen(0, '127.0.0.1')
    try {
      const { port } = (listening.getHttpServer() as Server).address() as AddressInfo
      const req = httpRequest({ port, host: '127.0.0.1', path: '/t/watch', method: 'POST' })
      req.on('error', () => undefined)
      req.end()
      await sleep(150)
      req.destroy()
      await sleep(150)
      expect(seen.abortEvents).toBe(1)
    } finally {
      await listening.close()
    }
  })

  /**
   * Headers already sent cannot be replaced by a 504, so the connection is cut.
   */
  it('cuts the connection of a response whose headers are already out, without an error report', async () => {
    const reported = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    try {
      const started = Date.now()
      await expect(request(server()).post('/t/out')).rejects.toThrow()
      expect(Date.now() - started).toBeLessThan(450)
      /* Sending a 504 over sent headers would throw inside the filter and be reported. */
      expect(reported).not.toHaveBeenCalled()
    } finally {
      reported.mockRestore()
    }
  })
})

describe('handler timeout, forRootAsync', () => {
  /** Starts an application on the asynchronous registration path with the given block. */
  async function startAsync(handlerTimeout: Record<string, unknown>): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({
      imports: [
        BymaxCoreModule.forRootAsync({ useFactory: () => ({ handlerTimeout }) }),
        SlowModule
      ]
    }).compile()
    const created = moduleRef.createNestApplication()
    await created.init()
    return created
  }

  it('bounds the handler when the resolved options enable it, and not when they do not', async () => {
    const on = await startAsync({ enabled: true, timeoutMs: 100 })
    const off = await startAsync({ enabled: false, timeoutMs: 100 })
    try {
      expect((await request(on.getHttpServer() as Server).post('/t/slow')).status).toBe(504)
      expect((await request(off.getHttpServer() as Server).post('/t/slow')).status).toBe(201)
    } finally {
      await on.close()
      await off.close()
    }
  })
})
