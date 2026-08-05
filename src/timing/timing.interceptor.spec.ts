/**
 * Unit tests for `TimingInterceptor`.
 *
 * Layer: unit.
 * Goal: prove exactly one sample reaches the sink per completed request, on
 * both the success and error paths, with the route template, the final status
 * (including error statuses), a monotonic-clock-derived duration, and the slow
 * flag computed against the configured threshold; prove a throwing sink is
 * swallowed on both paths and a non-HTTP context passes through untouched.
 * Mocks: a hand-built `ExecutionContext` and `CallHandler` (family convention,
 * no supertest here), plus a stub `MonotonicClock` advancing by controlled
 * amounts.
 */
import { HttpException, NotFoundException } from '@nestjs/common'
import type { CallHandler, ExecutionContext } from '@nestjs/common'
import { of, throwError } from 'rxjs'

import { normalizeCoreOptions } from '../core.options'
import type { ResolvedCoreOptions } from '../core.options'
import type { ITimingSink, RequestTimingSample } from './timing.interfaces'
import type { ITraceContextProvider, TraceContext } from '../telemetry/trace-context'
import type { MonotonicClock } from './timing.clock'
import { TimingInterceptor } from './timing.interceptor'

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

/** Build a minimal `ExecutionContext` for the given contextType, request, and response. */
function contextFor(params: {
  contextType?: string
  request?: object
  response?: object
}): ExecutionContext {
  return {
    getType: (): string => params.contextType ?? 'http',
    switchToHttp: () => ({
      getRequest: (): unknown => params.request ?? { method: 'GET', route: { path: '/probe' } },
      getResponse: (): unknown => params.response ?? { statusCode: 200 }
    })
  } as unknown as ExecutionContext
}

/** Build a `CallHandler` whose `handle()` returns the given observable factory. */
function handlerReturning(factory: () => ReturnType<CallHandler['handle']>): CallHandler {
  return { handle: factory }
}

/** Build an interceptor wired to the given sink and a controlled stub clock. */
function buildInterceptor(params: {
  options?: ResolvedCoreOptions
  ticks?: readonly number[]
  sink: ITimingSink
  /** Trace-context provider; omitted leaves the interceptor's no-op fallback. */
  traceContext?: ITraceContextProvider
}): TimingInterceptor {
  const clock = stubClock(params.ticks ?? [0, 10])
  return new TimingInterceptor(
    params.options ?? normalizeCoreOptions(),
    params.sink,
    clock,
    params.traceContext
  )
}

/** Build a trace-context provider resolving the given trace, or nothing. */
function stubTraceContext(trace?: TraceContext): ITraceContextProvider {
  return { getTraceContext: (): TraceContext | undefined => trace }
}

describe('TimingInterceptor, success path', () => {
  /**
   * One sample per successful request.
   *
   * A completed response must record exactly one sample carrying the method,
   * route template, final status, and the clock-derived duration.
   */
  it('records exactly one sample with the route template and status on success', (done) => {
    const sink = recordingSink()
    const interceptor = buildInterceptor({ ticks: [100, 140], sink })
    const context = contextFor({
      request: { method: 'GET', route: { path: '/invoices/:id' } },
      response: { statusCode: 201 }
    })
    const handler = handlerReturning(() => of({ ok: true }))

    interceptor.intercept(context, handler).subscribe({
      next: (value) => expect(value).toEqual({ ok: true }),
      complete: () => {
        expect(sink.samples).toHaveLength(1)
        expect(sink.samples[0]).toEqual({
          method: 'GET',
          route: '/invoices/:id',
          statusCode: 201,
          durationMs: 40,
          slow: false
        })
        done()
      }
    })
  })

  /**
   * A multi-value stream still records exactly one sample.
   *
   * Recording on stream completion (not per emission) keeps the one-sample
   * contract for handlers that return an observable emitting many values.
   */
  it('records a single sample for a handler that emits multiple values', (done) => {
    const sink = recordingSink()
    const interceptor = buildInterceptor({ sink })
    const context = contextFor({
      request: { method: 'GET', route: { path: '/stream' } },
      response: { statusCode: 200 }
    })
    const handler = handlerReturning(() => of(1, 2, 3))

    interceptor.intercept(context, handler).subscribe({
      complete: () => {
        expect(sink.samples).toHaveLength(1)
        expect(sink.samples[0]?.route).toBe('/stream')
        done()
      }
    })
  })

  /**
   * Missing status code defaults to 200.
   *
   * A response object that never received an explicit status still yields a
   * usable sample instead of an undefined statusCode.
   */
  it('defaults the success status to 200 when the response carries none', (done) => {
    const sink = recordingSink()
    const interceptor = buildInterceptor({ sink })
    const context = contextFor({ response: {} })
    const handler = handlerReturning(() => of('done'))

    interceptor.intercept(context, handler).subscribe({
      complete: () => {
        expect(sink.samples[0]?.statusCode).toBe(200)
        done()
      }
    })
  })
})

describe('TimingInterceptor, error path', () => {
  /**
   * HttpException carries its own status into the sample.
   *
   * An error response must still produce exactly one sample, using the
   * exception's status rather than a generic fallback, and the original error
   * must still propagate to the caller unchanged.
   */
  it('records the HttpException status and rethrows the same error', (done) => {
    const sink = recordingSink()
    const interceptor = buildInterceptor({ sink })
    const context = contextFor({})
    const original = new NotFoundException('missing')
    const handler = handlerReturning(() => throwError(() => original))

    interceptor.intercept(context, handler).subscribe({
      error: (error: unknown) => {
        expect(error).toBe(original)
        expect(sink.samples).toHaveLength(1)
        expect(sink.samples[0]?.statusCode).toBe(404)
        done()
      }
    })
  })

  /**
   * Non-HttpException errors collapse to 500.
   *
   * An unexpected error (not an HttpException) must still be sampled, with a
   * generic 500 status standing in for the unknown outcome.
   */
  it('records status 500 for a non-HttpException error', (done) => {
    const sink = recordingSink()
    const interceptor = buildInterceptor({ sink })
    const context = contextFor({})
    const handler = handlerReturning(() => throwError(() => new Error('boom')))

    interceptor.intercept(context, handler).subscribe({
      error: () => {
        expect(sink.samples[0]?.statusCode).toBe(500)
        done()
      }
    })
  })
})

describe('TimingInterceptor, slow flag', () => {
  /**
   * Above the threshold is slow.
   *
   * A duration strictly greater than the configured threshold must flag the
   * sample as slow.
   */
  it('flags slow true when the duration exceeds the threshold', (done) => {
    const options = normalizeCoreOptions({ timing: { slowRequestThresholdMs: 50 } })
    const sink = recordingSink()
    const interceptor = buildInterceptor({ options, ticks: [0, 51], sink })
    const handler = handlerReturning(() => of('x'))

    interceptor.intercept(contextFor({}), handler).subscribe({
      complete: () => {
        expect(sink.samples[0]?.slow).toBe(true)
        done()
      }
    })
  })

  /**
   * Exactly at the threshold is not slow.
   *
   * The boundary is exclusive: a duration equal to the threshold must not be
   * flagged as slow.
   */
  it('flags slow false when the duration equals the threshold exactly', (done) => {
    const options = normalizeCoreOptions({ timing: { slowRequestThresholdMs: 50 } })
    const sink = recordingSink()
    const interceptor = buildInterceptor({ options, ticks: [0, 50], sink })
    const handler = handlerReturning(() => of('x'))

    interceptor.intercept(contextFor({}), handler).subscribe({
      complete: () => {
        expect(sink.samples[0]?.slow).toBe(false)
        done()
      }
    })
  })

  /**
   * No threshold configured means never slow.
   *
   * With `slowRequestThresholdMs` unset, even a large duration must not be
   * flagged as slow.
   */
  it('flags slow false when no threshold is configured, regardless of duration', (done) => {
    const sink = recordingSink()
    const interceptor = buildInterceptor({ ticks: [0, 100_000], sink })
    const handler = handlerReturning(() => of('x'))

    interceptor.intercept(contextFor({}), handler).subscribe({
      complete: () => {
        expect(sink.samples[0]?.slow).toBe(false)
        done()
      }
    })
  })
})

describe('TimingInterceptor, sink safety', () => {
  /**
   * A throwing sink is silenced on the success path.
   *
   * The success response must still complete normally even though the sink
   * threw while recording the sample.
   */
  it('silences a sink that throws on the success path', (done) => {
    const throwingSink: ITimingSink = {
      record: (): void => {
        throw new Error('sink exploded')
      }
    }
    const interceptor = buildInterceptor({ sink: throwingSink })
    const handler = handlerReturning(() => of('ok'))

    expect(() => {
      interceptor.intercept(contextFor({}), handler).subscribe({
        next: (value) => expect(value).toBe('ok'),
        complete: done
      })
    }).not.toThrow()
  })

  /**
   * A throwing sink is silenced on the error path.
   *
   * The original error must still reach the subscriber unaffected, even
   * though the sink threw while recording the sample.
   */
  it('silences a sink that throws on the error path and still propagates the original error', (done) => {
    const throwingSink: ITimingSink = {
      record: (): void => {
        throw new Error('sink exploded')
      }
    }
    const interceptor = buildInterceptor({ sink: throwingSink })
    const original = new HttpException('bad', 400)
    const handler = handlerReturning(() => throwError(() => original))

    interceptor.intercept(contextFor({}), handler).subscribe({
      error: (error: unknown) => {
        expect(error).toBe(original)
        done()
      }
    })
  })
})

describe('TimingInterceptor, default clock', () => {
  /**
   * Omitting the clock argument uses the real monotonic default.
   *
   * The DI container resolves the clock through the same explicit token in
   * production; constructing without the third argument must fall back to
   * `DEFAULT_MONOTONIC_CLOCK` and still produce a valid, non-negative duration.
   */
  it('measures a real, non-negative duration when no clock is injected', (done) => {
    const sink = recordingSink()
    const interceptor = new TimingInterceptor(normalizeCoreOptions(), sink)
    const handler = handlerReturning(() => of('ok'))

    interceptor.intercept(contextFor({}), handler).subscribe({
      complete: () => {
        expect(sink.samples[0]?.durationMs).toBeGreaterThanOrEqual(0)
        done()
      }
    })
  })
})

describe('TimingInterceptor, non-HTTP context', () => {
  /**
   * Non-HTTP contexts pass through untouched.
   *
   * GraphQL and RPC execution contexts are out of scope for this HTTP-first
   * feature: the interceptor must forward the handler stream without
   * measuring or recording anything.
   */
  it('forwards the handler stream without recording a sample', (done) => {
    const sink = recordingSink()
    const interceptor = buildInterceptor({ sink })
    const handler = handlerReturning(() => of('rpc-result'))

    interceptor.intercept(contextFor({ contextType: 'rpc' }), handler).subscribe({
      next: (value) => expect(value).toBe('rpc-result'),
      complete: () => {
        expect(sink.samples).toHaveLength(0)
        done()
      }
    })
  })
})

describe('TimingInterceptor, sink fallback', () => {
  /**
   * No sink resolves.
   *
   * `BymaxCoreModule` binds no local default for `BYMAX_TIMING_SINK` when the
   * metrics bridge is not registered (see `defaults.providers.ts`): when
   * nothing is injected, the constructor must fall back to a no-op sink so a
   * request still completes normally instead of failing to resolve the
   * interceptor.
   */
  it('completes a request without throwing when constructed with no sink', (done) => {
    const clock = stubClock([0, 5])
    const interceptor = new TimingInterceptor(normalizeCoreOptions(), undefined, clock)
    const handler = handlerReturning(() => of('ok'))

    interceptor.intercept(contextFor({}), handler).subscribe({
      next: (value) => expect(value).toBe('ok'),
      complete: () => done()
    })
  })
})

describe('TimingInterceptor, trace correlation', () => {
  /** A recording span's identifiers. */
  const TRACE: TraceContext = { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) }

  /**
   * The sample carries the trace it ran under.
   *
   * A sink that forwards samples to logs or to a trace backend needs both ids to
   * tie the measurement to the request; without them the sample is an orphan.
   */
  it('stamps the sample with the active trace and span ids', (done) => {
    const sink = recordingSink()
    const interceptor = buildInterceptor({ sink, traceContext: stubTraceContext(TRACE) })
    const context = contextFor({
      request: { method: 'GET', route: { path: '/invoices' } },
      response: { statusCode: 200 }
    })

    interceptor
      .intercept(
        context,
        handlerReturning(() => of('ok'))
      )
      .subscribe({
        complete: () => {
          expect(sink.samples[0]).toMatchObject({ traceId: TRACE.traceId, spanId: TRACE.spanId })
          done()
        }
      })
  })

  /**
   * An untraced request leaves the keys off entirely. Edge case.
   *
   * `exactOptionalPropertyTypes` distinguishes an absent key from one set to
   * `undefined`, and a sink serializing the sample must not emit `traceId: null`
   * for every request made before instrumentation started.
   */
  it('omits the trace keys when nothing is recording', (done) => {
    const sink = recordingSink()
    const interceptor = buildInterceptor({ sink, traceContext: stubTraceContext(undefined) })
    const context = contextFor({
      request: { method: 'GET', route: { path: '/invoices' } },
      response: { statusCode: 200 }
    })

    interceptor
      .intercept(
        context,
        handlerReturning(() => of('ok'))
      )
      .subscribe({
        complete: () => {
          expect(sink.samples[0]).not.toHaveProperty('traceId')
          expect(sink.samples[0]).not.toHaveProperty('spanId')
          done()
        }
      })
  })

  /**
   * A throwing trace provider cannot break the request. Regression guard.
   *
   * The provider contract says it never throws, but this interceptor's guarantee
   * is that request timing can never break a request — and a guarantee that
   * assumes another component's good behavior is not one. A broken tracer must
   * cost the trace fields, not the response.
   */
  it('completes the request when the trace provider throws', (done) => {
    const sink = recordingSink()
    const interceptor = buildInterceptor({
      sink,
      traceContext: {
        getTraceContext: (): TraceContext | undefined => {
          throw new Error('tracer exploded')
        }
      }
    })
    const context = contextFor({
      request: { method: 'GET', route: { path: '/invoices' } },
      response: { statusCode: 200 }
    })

    interceptor
      .intercept(
        context,
        handlerReturning(() => of('ok'))
      )
      .subscribe({
        complete: () => {
          expect(sink.samples).toHaveLength(0)
          done()
        },
        error: () => done(new Error('the request must not fail because telemetry did'))
      })
  })

  /**
   * No bound provider behaves like no trace. Edge case: nothing injected.
   *
   * The interceptor is constructible on its own, so its in-code fallback must
   * make an unbound token indistinguishable from an untraced request.
   */
  it('omits the trace keys when no provider is bound at all', (done) => {
    const sink = recordingSink()
    const interceptor = buildInterceptor({ sink })
    const context = contextFor({
      request: { method: 'GET', route: { path: '/invoices' } },
      response: { statusCode: 200 }
    })

    interceptor
      .intercept(
        context,
        handlerReturning(() => of('ok'))
      )
      .subscribe({
        complete: () => {
          expect(sink.samples[0]).not.toHaveProperty('traceId')
          done()
        }
      })
  })
})
