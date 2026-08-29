/**
 * Unit tests for `BymaxTimingMiddleware`.
 *
 * Layer: unit.
 * Goal: prove one sample reaches the sink for every request the connection
 * closes, whatever ended it — a handler, a guard rejection, no matching route,
 * or a client that hung up — carrying the route template, the final status, a
 * monotonic duration and the slow flag; prove the recorded route is the bounded
 * `<unmatched>` label rather than a raw path when nothing matched; prove a
 * throwing sink is swallowed; prove the listener carries the request's async
 * context, which is what makes the trace lookup work on the aborted path.
 * Mocks: a fake response exposing only `on('close')` and `statusCode`, a stub
 * `MonotonicClock` advancing by controlled amounts, and a spy sink. No HTTP
 * server: the middleware's contract is "record when `close` fires", so firing
 * it directly is the smallest thing that exercises it. The registration spec
 * covers the wiring end to end through a real app.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

import { normalizeCoreOptions } from '../core.options'
import type { ResolvedCoreOptions } from '../core.options'
import type { ITraceContextProvider, TraceContext } from '../telemetry/trace-context'
import { UNMATCHED_ROUTE } from './request-info.accessor'
import type { RequestShape } from './request-info.accessor'
import type { MonotonicClock } from './timing.clock'
import type { ITimingSink, RequestTimingSample } from './timing.interfaces'
import { BymaxTimingMiddleware } from './timing.middleware'

/** A stub clock returning each value of `ticks` in sequence, then the last forever. */
function stubClock(ticks: readonly number[]): MonotonicClock {
  let index = 0
  return {
    now: (): number => {
      const value = ticks[Math.min(index, ticks.length - 1)] ?? 0
      index += 1
      return value
    }
  }
}

/** A sink spy recording every sample it receives. */
function recordingSink(): ITimingSink & { samples: RequestTimingSample[] } {
  const samples: RequestTimingSample[] = []
  return {
    samples,
    record: (sample: RequestTimingSample): void => {
      samples.push(sample)
    }
  }
}

/** The response stand-in, holding the `'close'` listener so a test can fire it. */
interface FakeResponse {
  /** Registers the listener the middleware wants to run on close. */
  on(event: 'close', listener: () => void): unknown
  /** The status the middleware reads when it records. */
  statusCode: number | undefined
  /** Runs every registered listener, standing in for the connection closing. */
  close(): void
}

/** Build a response whose `close()` fires whatever the middleware registered. */
function fakeResponse(statusCode?: number): FakeResponse {
  const listeners: (() => void)[] = []
  return {
    on(_event: 'close', listener: () => void): unknown {
      listeners.push(listener)
      return this
    },
    statusCode,
    close(): void {
      for (const listener of listeners) {
        listener()
      }
    }
  }
}

/** Build a middleware wired to the given sink and a controlled stub clock. */
function buildMiddleware(params: {
  options?: ResolvedCoreOptions
  ticks?: readonly number[]
  /** Sink binding; `undefined` leaves the middleware's own no-op fallback. */
  sink?: ITimingSink
  /** Trace provider; omitted leaves the middleware's no-op fallback. */
  traceContext?: ITraceContextProvider
}): BymaxTimingMiddleware {
  return new BymaxTimingMiddleware(
    params.options ?? normalizeCoreOptions(),
    params.sink,
    stubClock(params.ticks ?? [0, 10]),
    params.traceContext
  )
}

/** An Express-shaped request whose router match is already resolved. */
function matchedRequest(method: string, path: string): RequestShape {
  return { method, route: { path } } as RequestShape
}

describe('BymaxTimingMiddleware', () => {
  /**
   * The happy path, and the shape of every sample.
   *
   * One request, one sample, carrying the route template rather than the
   * concrete URL — the label has to be bounded, because an unbounded one turns
   * a burst of distinct paths into a metrics-cardinality explosion — plus the
   * final status and a duration derived from the clock seam.
   */
  it('records one sample carrying route, status and duration', () => {
    const sink = recordingSink()
    const middleware = buildMiddleware({ sink, ticks: [5, 17] })
    const response = fakeResponse(200)

    middleware.use(matchedRequest('GET', '/items/:id'), response, () => undefined)
    response.close()

    expect(sink.samples).toEqual([
      { method: 'GET', route: '/items/:id', statusCode: 200, durationMs: 12, slow: false }
    ])
  })

  /**
   * The chain continues, synchronously and unconditionally.
   *
   * Middleware that forgets `next()` hangs every request in the application, so
   * the observer must be provably transparent: the call happens, and it happens
   * before `use` returns rather than from inside the close listener.
   */
  it('calls next synchronously', () => {
    const middleware = buildMiddleware({ sink: recordingSink() })
    let called = 0

    middleware.use(matchedRequest('GET', '/probe'), fakeResponse(200), () => {
      called += 1
    })

    expect(called).toBe(1)
  })

  /**
   * The requests an interceptor never saw.
   *
   * A guard rejection and an unmatched path are the cases this middleware
   * exists for: 401/403/429 is what a credential-stuffing or brute-force run
   * looks like, and 404 is what route enumeration looks like. All of them
   * closed the connection, so all of them must be counted — and the unmatched
   * one under the fixed `<unmatched>` label, never the path the scanner chose,
   * which would let the attacker mint one time series per probe.
   */
  it.each([
    ['a guard rejection', matchedRequest('POST', '/session'), 401, '/session'],
    ['a forbidden request', matchedRequest('GET', '/admin'), 403, '/admin'],
    ['a throttled request', matchedRequest('POST', '/session'), 429, '/session'],
    [
      'a scanner probe matching no route',
      { method: 'GET', url: '/.env?x=1' } as RequestShape,
      404,
      UNMATCHED_ROUTE
    ]
  ])('records %s', (_case, request, statusCode, route) => {
    const sink = recordingSink()
    const middleware = buildMiddleware({ sink })
    const response = fakeResponse(statusCode)

    middleware.use(request, response, () => undefined)
    response.close()

    expect(sink.samples).toHaveLength(1)
    expect(sink.samples[0]).toMatchObject({ route, statusCode })
  })

  /**
   * A response that closed before a status was set.
   *
   * `statusCode` is typed optional and a client can hang up early enough that
   * nothing settled it. Recording `0` keeps the sample — the request happened,
   * and a flood of aborted requests is itself a signal — instead of emitting
   * `undefined` into a label a sink would have to guess at.
   */
  it('records status zero when the response never settled one', () => {
    const sink = recordingSink()
    const middleware = buildMiddleware({ sink })
    const response = fakeResponse(undefined)

    middleware.use(matchedRequest('GET', '/probe'), response, () => undefined)
    response.close()

    expect(sink.samples[0]).toMatchObject({ statusCode: 0 })
  })

  /**
   * The slow flag is computed against the configured threshold.
   *
   * Strictly greater than, so a request landing exactly on the threshold is not
   * slow; the boundary is asserted because it is the value most likely to be
   * wrong and least likely to be noticed.
   */
  it.each([
    [10, false],
    [11, true]
  ])('flags a %sms request as slow=%s against a 10ms threshold', (elapsed, slow) => {
    const sink = recordingSink()
    const middleware = buildMiddleware({
      sink,
      options: normalizeCoreOptions({ timing: { slowRequestThresholdMs: 10 } }),
      ticks: [0, elapsed]
    })
    const response = fakeResponse(200)

    middleware.use(matchedRequest('GET', '/probe'), response, () => undefined)
    response.close()

    expect(sink.samples[0]).toMatchObject({ slow })
  })

  /**
   * A throwing sink cannot reach the request.
   *
   * The sink contract is fire-and-forget: an observer that can break the thing
   * it observes is worse than no observer, and a metrics backend failing mid
   * incident is exactly when this would fire.
   */
  it('swallows a throwing sink', () => {
    const middleware = buildMiddleware({
      sink: {
        record: (): void => {
          throw new Error('sink is down')
        }
      }
    })
    const response = fakeResponse(200)

    middleware.use(matchedRequest('GET', '/probe'), response, () => undefined)

    expect(() => {
      response.close()
    }).not.toThrow()
  })

  /**
   * A sink that rejects asynchronously cannot reach the request either.
   *
   * `record` is declared `void`, but TypeScript accepts any return value in a
   * void-returning position, so `async record()` compiles — and it is what a
   * consumer writes when the backend it delegates to is async. The rejection
   * settles after the synchronous guard has exited, so uncontained it is an
   * unhandled rejection that can take the process down: the observer breaking
   * what it observes, which is exactly what fire-and-forget rules out.
   *
   * The containment is what lets this test finish — an escaping rejection fails
   * the run itself rather than this assertion.
   */
  it('swallows a sink that rejects asynchronously', async () => {
    const middleware = buildMiddleware({
      sink: {
        record: async (): Promise<void> => {
          throw new Error('sink is down later')
        }
      }
    })
    const response = fakeResponse(200)

    middleware.use(matchedRequest('GET', '/probe'), response, () => undefined)

    expect(() => {
      response.close()
    }).not.toThrow()
    // Give the rejection the microtask turn it was deferred onto.
    await Promise.resolve()
  })

  /**
   * No sink bound anywhere.
   *
   * The token is optional, so the middleware must stand up and run against its
   * own in-code no-op rather than failing to construct — that is the default
   * configuration for anyone who enabled timing without metrics.
   */
  it('records against its own no-op when no sink is bound', () => {
    const middleware = buildMiddleware({})
    const response = fakeResponse(200)

    middleware.use(matchedRequest('GET', '/probe'), response, () => undefined)

    expect(() => {
      response.close()
    }).not.toThrow()
  })

  /**
   * Trace identifiers are attached when a provider resolves them.
   *
   * They are what joins a sample to the trace an operator is reading; a
   * provider that resolves nothing must leave the keys off entirely rather than
   * writing `undefined`, so a sink cannot mistake the absence for an id.
   */
  it.each([
    ['attaches', { traceId: 'trace-1', spanId: 'span-1' } as TraceContext],
    ['omits', undefined]
  ])('%s trace identifiers', (_case, trace) => {
    const sink = recordingSink()
    const middleware = buildMiddleware({
      sink,
      traceContext: { getTraceContext: (): TraceContext | undefined => trace }
    })
    const response = fakeResponse(200)

    middleware.use(matchedRequest('GET', '/probe'), response, () => undefined)
    response.close()

    expect(sink.samples[0]).toMatchObject(
      trace === undefined ? { route: '/probe' } : { traceId: 'trace-1', spanId: 'span-1' }
    )
    expect(Object.hasOwn(sink.samples[0] ?? {}, 'traceId')).toBe(trace !== undefined)
  })

  /**
   * A span opened UPSTREAM survives an aborted request.
   *
   * This is the auto-instrumented HTTP server: the context exists before this
   * middleware runs, so the bound capture holds it. On an aborted request
   * `'close'` is emitted from the socket — an async resource that predates the
   * request — so the live context holds nothing and only the capture answers.
   * Firing `close` from outside the store reproduces exactly that.
   */
  it('resolves an upstream span when close fires outside the request context', () => {
    const storage = new AsyncLocalStorage<TraceContext>()
    const sink = recordingSink()
    const middleware = buildMiddleware({
      sink,
      traceContext: { getTraceContext: (): TraceContext | undefined => storage.getStore() }
    })
    const response = fakeResponse(200)

    storage.run({ traceId: 'trace-1', spanId: 'span-1' }, () => {
      middleware.use(matchedRequest('GET', '/probe'), response, () => undefined)
    })
    response.close()

    expect(sink.samples[0]).toMatchObject({ traceId: 'trace-1', spanId: 'span-1' })
  })

  /**
   * A span opened DOWNSTREAM is still read on a completed request.
   *
   * Consumer instrumentation registered as Nest middleware runs *after* this
   * one, so its span does not exist when `use()` captures a context. Reading
   * only the captured context would therefore drop the identifiers for every
   * such consumer — a regression against the interceptor this replaced, which
   * ran after all middleware and saw those spans. The live read at emit time is
   * what covers it, and this asserts the two-context order rather than the
   * capture alone.
   */
  it('resolves a downstream span from the live context at emit time', () => {
    const storage = new AsyncLocalStorage<TraceContext>()
    const sink = recordingSink()
    const middleware = buildMiddleware({
      sink,
      traceContext: { getTraceContext: (): TraceContext | undefined => storage.getStore() }
    })
    const response = fakeResponse(200)

    // No store yet: the span is opened only after this middleware has run.
    middleware.use(matchedRequest('GET', '/probe'), response, () => undefined)
    storage.run({ traceId: 'trace-2', spanId: 'span-2' }, () => {
      response.close()
    })

    expect(sink.samples[0]).toMatchObject({ traceId: 'trace-2', spanId: 'span-2' })
  })

  /**
   * The live context wins when both hold a span.
   *
   * A request can be inside an upstream span and a narrower downstream one at
   * the same time. The sample should carry the innermost span active when the
   * request ended, which is what an operator reading the trace expects to join
   * on — not the outer one that merely happened to be capturable earlier.
   */
  it('prefers the live span over the captured one', () => {
    const storage = new AsyncLocalStorage<TraceContext>()
    const sink = recordingSink()
    const middleware = buildMiddleware({
      sink,
      traceContext: { getTraceContext: (): TraceContext | undefined => storage.getStore() }
    })
    const response = fakeResponse(200)

    storage.run({ traceId: 'outer', spanId: 'outer-span' }, () => {
      middleware.use(matchedRequest('GET', '/probe'), response, () => undefined)
    })
    storage.run({ traceId: 'inner', spanId: 'inner-span' }, () => {
      response.close()
    })

    expect(sink.samples[0]).toMatchObject({ traceId: 'inner', spanId: 'inner-span' })
  })

  /**
   * The clock argument has a working default.
   *
   * The token is always bound by the module, so the default only shows up when
   * something constructs the middleware directly; it must still measure with a
   * monotonic source rather than leaving `now()` unresolvable.
   */
  it('falls back to the default monotonic clock', () => {
    const sink = recordingSink()
    const middleware = new BymaxTimingMiddleware(normalizeCoreOptions(), sink, undefined)
    const response = fakeResponse(200)

    middleware.use(matchedRequest('GET', '/probe'), response, () => undefined)
    response.close()

    expect(sink.samples[0]?.durationMs).toBeGreaterThanOrEqual(0)
  })
})
