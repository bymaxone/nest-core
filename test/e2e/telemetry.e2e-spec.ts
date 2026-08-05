/**
 * End-to-end suite: trace correlation.
 *
 * Layer: e2e.
 * Goal: prove the promise the feature makes to an instrumented application, over
 * real HTTP: with a span actually active for the request, the error envelope
 * carries its trace id when the operator opted into publishing it and omits it
 * otherwise; and with telemetry off, or with nothing recording, every response
 * is byte-for-byte what it was before the feature existed.
 * Mocks: none of this package. A real `AsyncLocalStorage` context manager and a
 * middleware that opens a context per request stand in for the instrumentation a
 * production service would already be running.
 */
import { Controller, Get, Module, NotFoundException } from '@nestjs/common'
import type { INestApplication, MiddlewareConsumer, NestModule } from '@nestjs/common'
import { context, trace } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { BymaxCoreModule } from '@bymax-one/nest-core'
import type { BymaxCoreModuleOptions } from '@bymax-one/nest-core'

/** The trace every request in this suite runs under. */
const TRACE_ID = '0af7651916cd43dd8448eb211c80319c'

/** The span every request in this suite runs under. */
const SPAN_ID = 'b7ad6b7169203331'

/** A route that always fails, so every request produces an error envelope. */
@Controller()
class FailingController {
  /** Throws a mapped `HttpException`. */
  @Get('missing')
  missing(): never {
    throw new NotFoundException('nothing here')
  }
}

/**
 * The consuming application, with a middleware opening a span context per
 * request — the same thing OpenTelemetry's HTTP instrumentation does, reduced to
 * what this feature actually reads.
 */
@Module({ controllers: [FailingController] })
class TracedAppModule implements NestModule {
  /**
   * Run every request inside a context carrying a valid, recording span.
   *
   * @param consumer - Nest's middleware consumer.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply((_request: unknown, _response: unknown, next: () => void) => {
        const span = trace.wrapSpanContext({ traceId: TRACE_ID, spanId: SPAN_ID, traceFlags: 1 })
        context.with(trace.setSpan(context.active(), span), next)
      })
      .forRoutes('*path')
  }
}

/** The application with no instrumentation at all, for the untraced case. */
@Module({ controllers: [FailingController] })
class PlainAppModule {}

/** Boot an application with the given core options and application module. */
async function bootApp(
  options: BymaxCoreModuleOptions,
  appModule: typeof TracedAppModule | typeof PlainAppModule
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [BymaxCoreModule.forRoot(options), appModule]
  }).compile()
  const app = moduleRef.createNestApplication()
  await app.init()
  return app
}

describe('trace correlation', () => {
  let app: INestApplication | undefined

  beforeAll(() => {
    // Without a context manager the API cannot propagate a context across the
    // request's async boundaries, so `getActiveSpan()` would always answer
    // "nothing recording" and every case below would look alike.
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable())
  })

  afterAll(() => {
    context.disable()
  })

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  /**
   * The feature, end to end.
   *
   * An instrumented application that opted into publishing the id serves an
   * envelope carrying the very trace the request ran under — the identifier that
   * takes an engineer from the response a caller pasted to the trace itself.
   */
  it('serves the active trace id in the error envelope when opted in', async () => {
    app = await bootApp({ telemetry: { enabled: true, exposeTraceId: true } }, TracedAppModule)

    const response = await request(app.getHttpServer()).get('/missing')

    expect(response.status).toBe(404)
    expect(response.body.traceId).toBe(TRACE_ID)
  })

  /**
   * Reading the trace does not mean publishing it.
   *
   * With telemetry on but the exposure option off, the response must be exactly
   * what it was before: the identifiers still travel internally, and the client
   * learns nothing new.
   */
  it('omits the trace id from the envelope while exposure is off', async () => {
    app = await bootApp({ telemetry: { enabled: true } }, TracedAppModule)

    const response = await request(app.getHttpServer()).get('/missing')

    expect(response.status).toBe(404)
    expect(response.body).not.toHaveProperty('traceId')
  })

  /**
   * An uninstrumented request carries nothing. Edge case: nothing recording.
   *
   * The option asks for the id when there is one; with no active span the field
   * must be absent rather than a string of zeros.
   */
  it('omits the trace id when no span is active', async () => {
    app = await bootApp({ telemetry: { enabled: true, exposeTraceId: true } }, PlainAppModule)

    const response = await request(app.getHttpServer()).get('/missing')

    expect(response.body).not.toHaveProperty('traceId')
  })

  /**
   * Telemetry off is the previous behavior, exactly. Regression guard.
   *
   * The same instrumented application with the feature disabled must serve the
   * same envelope it served before this feature existed.
   */
  it('serves the unchanged envelope while telemetry is disabled', async () => {
    app = await bootApp({}, TracedAppModule)

    const response = await request(app.getHttpServer()).get('/missing')

    expect(response.body).not.toHaveProperty('traceId')
    expect(response.body).toMatchObject({
      statusCode: 404,
      code: 'BYMAX_NOT_FOUND',
      message: 'nothing here',
      path: '/missing'
    })
  })
})
