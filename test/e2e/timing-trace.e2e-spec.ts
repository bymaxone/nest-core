/**
 * End-to-end suite: timing samples carry the active span's identifiers.
 *
 * Layer: e2e.
 * Goal: prove a sample joins the trace an operator is reading, for a span
 * opened by instrumentation registered as Nest middleware — which runs *after*
 * `BymaxTimingMiddleware` and therefore did not exist when it captured a
 * context. Recording from the response's `'close'` event made that ordering
 * matter in a way the interceptor it replaced never had to care about, since
 * that ran after all middleware. Nothing covered it, so the regression was
 * invisible; this is the test that would have caught it.
 * Mocks: a middleware opening a span with fixed identifiers, standing in for
 * OpenTelemetry's HTTP instrumentation reduced to what this feature reads, plus
 * a spy sink bound through the documented consumer-override pattern. A real
 * `AsyncLocalStorageContextManager` is registered, because without one
 * `@opentelemetry/api` does not propagate context across an async boundary at
 * all and no emit-time reader of any kind could see the span.
 */
import { Controller, Get, Global, Module } from '@nestjs/common'
import type {
  DynamicModule,
  INestApplication,
  MiddlewareConsumer,
  NestModule
} from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { context, trace } from '@opentelemetry/api'
import type { ContextManager } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import request from 'supertest'

import { BymaxCoreModule, BYMAX_TIMING_SINK } from '@bymax-one/nest-core'
import type { ITimingSink, RequestTimingSample } from '@bymax-one/nest-core'

/** Identifiers the stub span carries, asserted verbatim on the sample. */
const TRACE_ID = '0af7651916cd43dd8448eb211c80319c'
const SPAN_ID = 'b7ad6b7169203331'

/** Collects every sample the library hands to the bound sink. */
const samples: RequestTimingSample[] = []

/** Bind the collecting sink the way the README documents a consumer doing it. */
function sinkModule(): DynamicModule {
  const sink: ITimingSink = {
    record: (sample: RequestTimingSample): void => {
      samples.push(sample)
    }
  }
  @Global()
  @Module({
    providers: [{ provide: BYMAX_TIMING_SINK, useValue: sink }],
    exports: [BYMAX_TIMING_SINK]
  })
  class SinkModule {}
  return { module: SinkModule }
}

/** One reachable route, enough to produce a sample. */
@Controller()
class ProbeController {
  @Get('ok')
  ok(): { ok: boolean } {
    return { ok: true }
  }
}

/**
 * The consuming application, opening a span per request from its own
 * middleware — downstream of the library's, which is the ordering under test.
 */
@Module({ controllers: [ProbeController] })
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
      .forRoutes('/')
  }
}

describe('timing samples and the active span', () => {
  let app: INestApplication | undefined
  let contextManager: ContextManager | undefined

  beforeEach(() => {
    samples.length = 0
    contextManager = new AsyncLocalStorageContextManager().enable()
    context.setGlobalContextManager(contextManager)
  })

  afterEach(async () => {
    await app?.close()
    app = undefined
    // Disabled and disposed so the manager cannot leak into another suite: a
    // stray global one would make unrelated context assertions pass or fail for
    // reasons that have nothing to do with what they test.
    contextManager?.disable()
    context.disable()
    contextManager = undefined
  })

  /**
   * A span opened downstream still reaches the sample.
   *
   * The library's middleware runs first, so at the moment it subscribes to
   * `'close'` this span does not exist. Reading only the context captured then
   * — the obvious way to make an aborted request resolve its trace — drops the
   * identifiers for every consumer whose instrumentation is Nest middleware.
   * The live read at emit time is what covers it.
   */
  it('carries the identifiers of a span opened by downstream middleware', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        BymaxCoreModule.forRoot({ timing: { enabled: true }, telemetry: { enabled: true } }),
        sinkModule(),
        TracedAppModule
      ]
    }).compile()
    app = moduleRef.createNestApplication()
    await app.init()

    await request(app.getHttpServer()).get('/ok').expect(200, { ok: true })

    expect(samples).toEqual([
      expect.objectContaining({ route: '/ok', traceId: TRACE_ID, spanId: SPAN_ID })
    ])
  })

  /**
   * No instrumentation, no trace fields — and no `undefined` either.
   *
   * The keys must be absent rather than present-and-empty, so a sink cannot
   * mistake a missing identifier for one, and the counter still works: an
   * application without tracing must still get its security signal.
   */
  it('omits the identifiers entirely when nothing opened a span', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        BymaxCoreModule.forRoot({ timing: { enabled: true }, telemetry: { enabled: true } }),
        sinkModule()
      ],
      controllers: [ProbeController]
    }).compile()
    app = moduleRef.createNestApplication()
    await app.init()

    await request(app.getHttpServer()).get('/ok').expect(200, { ok: true })

    expect(samples).toHaveLength(1)
    expect(Object.hasOwn(samples[0] ?? {}, 'traceId')).toBe(false)
    expect(Object.hasOwn(samples[0] ?? {}, 'spanId')).toBe(false)
  })
})
