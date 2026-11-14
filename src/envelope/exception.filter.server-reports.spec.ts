/**
 * Tests for how the filter reports a server failure that arrives as an `HttpException`.
 *
 * Layer: unit and integration.
 * Goal: pin that a 5xx `HttpException` reaches the unexpected-error sink with its original exception, so
 * a sink can write the cause the response withholds; that it does so once per status and code in each
 * window, with a count of the repeats when the window ends; that a 4xx never reaches the sink; that an
 * unexpected non-`HttpException` error is still reported every time; and that the response never changes.
 * Mocks: a hand-built host and adapter for the unit cases, Jest fake timers; a real Nest application
 * for the lifecycle case.
 */
import { Controller, Get, Global, HttpException, Module } from '@nestjs/common'
import type { ArgumentsHost } from '@nestjs/common'
import type { HttpAdapterHost } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { BymaxCoreModule } from '../core.module'
import { BYMAX_UNEXPECTED_ERROR_SINK } from '../core.tokens'
import { normalizeCoreOptions } from '../core.options'

import type { ErrorEnvelope } from './error-envelope'
import { BymaxExceptionFilter } from './exception.filter'
import type { FilterErrorContext } from './exception.filter'
import type { IUnexpectedErrorSink, UnexpectedErrorReport } from './unexpected-error.sink'

const WINDOW_MS = 60_000

/** A sink that keeps every report it receives. */
class RecordingSink implements IUnexpectedErrorSink {
  readonly reports: UnexpectedErrorReport[] = []

  record(report: UnexpectedErrorReport): void {
    this.reports.push(report)
  }
}

/** A filter that also keeps what its protected hook receives. */
class HookedFilter extends BymaxExceptionFilter {
  readonly hooked: Array<{ error: unknown; repeated: number | undefined }> = []

  protected override onUnexpectedError(
    error: unknown,
    _context: FilterErrorContext,
    repeated?: number
  ): void {
    this.hooked.push({ error, repeated })
  }
}

/** Build a filter over a stub adapter, a way to throw one error through it, and what it replied. */
function harness(options?: { sink?: IUnexpectedErrorSink; windowMs?: number; hooked?: boolean }): {
  filter: BymaxExceptionFilter
  fail: (error: unknown) => ErrorEnvelope
} {
  let reply: ErrorEnvelope | undefined
  const route = { path: '/invoices/:id' }
  const httpAdapter = {
    getRequestUrl: (req: { url: string }): string => req.url,
    getRequestMethod: (req: { method: string }): string => req.method,
    reply: (_response: unknown, body: ErrorEnvelope): void => {
      reply = body
    }
  }
  const host = {
    getType: (): string => 'http',
    switchToHttp: () => ({
      getRequest: (): unknown => ({ url: '/invoices/inv_1', method: 'GET', route }),
      getResponse: (): unknown => ({})
    })
  } as unknown as ArgumentsHost
  const Ctor = options?.hooked === true ? HookedFilter : BymaxExceptionFilter
  const filter = new Ctor(
    normalizeCoreOptions({
      envelope: { serverErrorWindowMs: options?.windowMs ?? WINDOW_MS }
    }),
    { getCorrelationId: () => 'corr-1' },
    { httpAdapter } as unknown as HttpAdapterHost,
    { getTraceContext: () => undefined },
    options?.sink
  )
  return {
    filter,
    fail: (error) => {
      filter.catch(error, host)
      return reply as ErrorEnvelope
    }
  }
}

/** A 503 carrying a driver message in its cause, the way a library would throw it. */
function serviceDown(label = 'down', code = 'CACHE_UNAVAILABLE'): HttpException {
  return new HttpException({ code, message: 'The cache is unavailable' }, 503, {
    cause: new Error(`connect ECONNREFUSED 10.0.0.5:6379 password=hunter2 (${label})`)
  })
}

describe('BymaxExceptionFilter, server failures as HttpException', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  /**
   * A 503 with a cause reaches the sink exactly once in the window.
   *
   * The response carries a fixed message by design, so the cause is gone the moment the filter replies
   * unless the filter hands it over. The exception goes over whole, so a sink writes `error.cause`.
   */
  it('hands a 503 with a cause to the sink once in the window, with the original exception', () => {
    const sink = new RecordingSink()
    const { fail } = harness({ sink })
    const first = serviceDown('first')

    fail(first)
    fail(serviceDown('second'))
    fail(serviceDown('third'))

    expect(sink.reports).toHaveLength(1)
    expect(sink.reports[0]?.error).toBe(first)
    expect((sink.reports[0]?.error as HttpException).cause).toBe(first.cause)
    expect(sink.reports[0]).toMatchObject({
      method: 'GET',
      route: '/invoices/:id',
      correlationId: 'corr-1'
    })
    expect(sink.reports[0]).not.toHaveProperty('repeated')
  })

  /**
   * The repeats are counted and reported when the window ends.
   */
  it('reports one summary with the count of the repeats, and the latest of them, when the window ends', () => {
    const sink = new RecordingSink()
    const { fail } = harness({ sink })
    fail(serviceDown('first'))
    fail(serviceDown('second'))
    const last = serviceDown('last')
    fail(serviceDown('third'))
    fail(last)

    jest.advanceTimersByTime(WINDOW_MS)

    expect(sink.reports).toHaveLength(2)
    expect(sink.reports[1]?.error).toBe(last)
    expect(sink.reports[1]).toMatchObject({ repeated: 3, route: '/invoices/:id', method: 'GET' })
  })

  it('reports nothing more when the window ends without repeats, and the next failure is reported at once', () => {
    const sink = new RecordingSink()
    const { fail } = harness({ sink })
    fail(serviceDown('only'))

    jest.advanceTimersByTime(WINDOW_MS)
    expect(sink.reports).toHaveLength(1)
    fail(serviceDown('after'))

    expect(sink.reports).toHaveLength(2)
    expect(sink.reports[1]).not.toHaveProperty('repeated')
  })

  it('keeps a window per status and code', () => {
    const sink = new RecordingSink()
    const { fail } = harness({ sink })

    fail(serviceDown('a', 'CACHE_UNAVAILABLE'))
    fail(serviceDown('b', 'DB_UNAVAILABLE'))
    fail(new HttpException('Bad Gateway', 502))
    fail(serviceDown('c', 'CACHE_UNAVAILABLE'))

    expect(sink.reports).toHaveLength(3)
  })

  it.each([500, 502, 503, 599])(
    'reports an HttpException of status %p, the first one of the server range',
    (status) => {
      const sink = new RecordingSink()
      const { fail } = harness({ sink })

      fail(new HttpException('server failure', status))

      expect(sink.reports).toHaveLength(1)
    }
  )

  it('uses the status and the derived code when the exception carries none', () => {
    const sink = new RecordingSink()
    const { fail } = harness({ sink })

    fail(new HttpException('Service Unavailable', 503))
    fail(new HttpException('Service Unavailable', 503))

    expect(sink.reports).toHaveLength(1)
  })

  it('honours the configured window', () => {
    const sink = new RecordingSink()
    const { fail } = harness({ sink, windowMs: 5_000 })
    fail(serviceDown('a'))
    fail(serviceDown('b'))

    jest.advanceTimersByTime(4_999)
    expect(sink.reports).toHaveLength(1)
    jest.advanceTimersByTime(1)

    expect(sink.reports).toHaveLength(2)
  })

  /**
   * A 4xx never reaches the sink.
   */
  it.each([400, 401, 404, 409, 422, 429, 499])(
    'never hands a %p HttpException to the sink',
    (status) => {
      const sink = new RecordingSink()
      const { fail } = harness({ sink })

      fail(new HttpException({ code: 'ANY_CODE', message: 'caller mistake' }, status))
      fail(new HttpException({ code: 'ANY_CODE', message: 'caller mistake' }, status))
      jest.advanceTimersByTime(WINDOW_MS)

      expect(sink.reports).toEqual([])
      expect(jest.getTimerCount()).toBe(0)
    }
  )

  /**
   * The response does not change.
   */
  it('answers a reported 503 exactly as it did before, with no cause and no repeats in the body', () => {
    const { fail } = harness({ sink: new RecordingSink() })
    const unreported = harness()

    const reported = fail(serviceDown('x'))
    const repeat = fail(serviceDown('y'))
    const withoutSink = unreported.fail(serviceDown('x'))

    expect(reported).toMatchObject({
      statusCode: 503,
      code: 'CACHE_UNAVAILABLE',
      message: 'The cache is unavailable'
    })
    expect(JSON.stringify([reported, repeat])).not.toMatch(/hunter2|ECONNREFUSED|repeated/)
    expect(withoutSink).toEqual({ ...reported, timestamp: withoutSink.timestamp })
    expect(repeat).toEqual({ ...reported, timestamp: repeat.timestamp })
  })

  it('keeps the sink out of the way when none is bound, and holds no timer for it to read', () => {
    const { fail } = harness()

    expect(() => fail(serviceDown('x'))).not.toThrow()
    jest.advanceTimersByTime(WINDOW_MS)
  })

  /**
   * An unexpected error that is not an HttpException is a defect: it is reported every time.
   */
  it('still reports every unexpected non-HttpException error, with no window', () => {
    const sink = new RecordingSink()
    const { fail } = harness({ sink })

    fail(new Error('boom'))
    fail(new Error('boom'))
    fail(new Error('boom'))
    jest.advanceTimersByTime(WINDOW_MS)

    expect(sink.reports).toHaveLength(3)
    expect(sink.reports.every((report) => !('repeated' in report))).toBe(true)
    expect(jest.getTimerCount()).toBe(0)
  })

  it('calls the protected hook for the first occurrence and for the summary, with the count', () => {
    const { fail, filter } = harness({ hooked: true })
    const first = serviceDown('first')
    const latest = serviceDown('latest')
    fail(first)
    fail(serviceDown('middle'))
    fail(latest)

    jest.advanceTimersByTime(WINDOW_MS)

    expect((filter as HookedFilter).hooked).toEqual([
      { error: first, repeated: undefined },
      { error: latest, repeated: 2 }
    ])
  })

  it('lets a throwing sink fail silently at the summary, without a throw from the timer', () => {
    const { fail } = harness({
      sink: {
        record: () => {
          throw new Error('the log pipeline is down')
        }
      }
    })
    fail(serviceDown('a'))
    fail(serviceDown('b'))

    expect(() => jest.advanceTimersByTime(WINDOW_MS)).not.toThrow()
  })

  it('reports the summary still due when the application shuts down, and holds no timer after', () => {
    const sink = new RecordingSink()
    const { fail, filter } = harness({ sink })
    fail(serviceDown('a'))
    fail(serviceDown('b'))
    fail(serviceDown('c'))

    filter.onModuleDestroy()

    expect(sink.reports).toHaveLength(2)
    expect(sink.reports[1]).toMatchObject({ repeated: 2 })
    expect(jest.getTimerCount()).toBe(0)
  })
})

/** Throws a library-style 503 carrying a cause. */
@Controller('down')
class DownController {
  @Get()
  down(): never {
    throw serviceDown('integration')
  }
}

@Module({ controllers: [DownController] })
class DownModule {}

/** The sink the application under test binds, from a module of its own marked global. */
const applicationSink = new RecordingSink()

@Global()
@Module({
  providers: [{ provide: BYMAX_UNEXPECTED_ERROR_SINK, useValue: applicationSink }],
  exports: [BYMAX_UNEXPECTED_ERROR_SINK]
})
class SinkModule {}

describe('BymaxExceptionFilter, server failures in a running application', () => {
  it('reports a 503 once, answers every request unchanged, and flushes the summary on close', async () => {
    const sink = applicationSink
    sink.reports.length = 0
    const moduleRef = await Test.createTestingModule({
      imports: [
        SinkModule,
        BymaxCoreModule.forRoot({ envelope: { serverErrorWindowMs: 60_000 } }),
        DownModule
      ]
    }).compile()
    const app = moduleRef.createNestApplication()
    await app.init()
    const server = app.getHttpServer()

    const bodies: unknown[] = []
    for (let index = 0; index < 3; index += 1) {
      const response = await request(server).get('/down').expect(503)
      bodies.push({ ...(response.body as object), timestamp: undefined })
    }

    expect(sink.reports).toHaveLength(1)
    expect(bodies[0]).toEqual(bodies[1])
    expect(JSON.stringify(bodies)).not.toMatch(/hunter2|ECONNREFUSED/)
    await app.close()
    expect(sink.reports).toHaveLength(2)
    expect(sink.reports[1]).toMatchObject({ repeated: 2, route: '/down' })
  })

  it('does the same on the asynchronous registration path, where the filter comes from a factory', async () => {
    const sink = applicationSink
    sink.reports.length = 0
    const moduleRef = await Test.createTestingModule({
      imports: [
        SinkModule,
        BymaxCoreModule.forRootAsync({
          useFactory: () => ({ envelope: { serverErrorWindowMs: 60_000 } })
        }),
        DownModule
      ]
    }).compile()
    const app = moduleRef.createNestApplication()
    await app.init()

    for (let index = 0; index < 3; index += 1) {
      await request(app.getHttpServer()).get('/down').expect(503)
    }

    expect(sink.reports).toHaveLength(1)
    await app.close()
    expect(sink.reports).toHaveLength(2)
    expect(sink.reports[1]).toMatchObject({ repeated: 2, route: '/down' })
  })
})
