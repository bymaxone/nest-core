/**
 * Unit tests for the unexpected-error sink on BymaxExceptionFilter.
 *
 * Layer: unit.
 * Goal: prove the bound `IUnexpectedErrorSink` receives the original thrown
 * value with the method, the route template and the request's ids, for every
 * unexpected error and for nothing else; that the report carries no raw URL,
 * query, body or headers; and that a sink which throws or rejects never changes
 * the response.
 * Mocks: a hand-built ArgumentsHost and HttpAdapter; stub correlation and
 * trace-context providers.
 */
import { NotFoundException } from '@nestjs/common'
import type { ArgumentsHost } from '@nestjs/common'
import type { HttpAdapterHost } from '@nestjs/core'

import { normalizeCoreOptions } from '../core.options'
import { UNMATCHED_ROUTE } from '../timing/request-info.accessor'

import type { ErrorEnvelope } from './error-envelope'
import { BymaxExceptionFilter } from './exception.filter'
import type { FilterErrorContext } from './exception.filter'
import type { IUnexpectedErrorSink, UnexpectedErrorReport } from './unexpected-error.sink'

/** A trace id the stub provider resolves. */
const TRACE_ID = 'a'.repeat(32)

/** The reply the adapter was asked to send. */
interface Captured {
  body: ErrorEnvelope | undefined
  status: number | undefined
}

/** A sink that keeps every report it receives. */
class RecordingSink implements IUnexpectedErrorSink {
  readonly reports: UnexpectedErrorReport[] = []

  record(report: UnexpectedErrorReport): void {
    this.reports.push(report)
  }
}

/**
 * Build a filter wired to a stub adapter, and a host for one request.
 *
 * The request object is passed whole, so a test chooses which framework's
 * route metadata it carries; the adapter reads `url` and `method` off it.
 */
function buildHarness(params: {
  sink?: IUnexpectedErrorSink
  request?: Record<string, unknown>
  correlationId?: string
  traceId?: string
  filterCtor?: typeof BymaxExceptionFilter
  exposeInternals?: boolean
}): { filter: BymaxExceptionFilter; host: ArgumentsHost; captured: Captured } {
  const captured: Captured = { body: undefined, status: undefined }
  const request = params.request ?? {
    url: '/invoices/inv_123',
    method: 'GET',
    route: { path: '/invoices/:id' }
  }
  const httpAdapter = {
    getRequestUrl: (req: { url: string }): string => req.url,
    getRequestMethod: (req: { method: string }): string => req.method,
    reply: (_response: unknown, body: ErrorEnvelope, status: number): void => {
      captured.body = body
      captured.status = status
    }
  }
  const host = {
    getType: (): string => 'http',
    switchToHttp: () => ({
      getRequest: (): unknown => request,
      getResponse: (): unknown => ({})
    })
  } as unknown as ArgumentsHost
  const FilterCtor = params.filterCtor ?? BymaxExceptionFilter
  const filter = new FilterCtor(
    normalizeCoreOptions({
      telemetry: { enabled: true },
      envelope: { exposeInternals: params.exposeInternals ?? false }
    }),
    { getCorrelationId: () => params.correlationId },
    { httpAdapter } as unknown as HttpAdapterHost,
    {
      getTraceContext: () =>
        params.traceId === undefined
          ? undefined
          : { traceId: params.traceId, spanId: 'b'.repeat(16) }
    },
    params.sink
  )
  return { filter, host, captured }
}

describe('BymaxExceptionFilter, unexpected-error sink', () => {
  /**
   * The sink gets the cause the response withholds.
   *
   * The whole point of the sink: the envelope collapses to a fixed 500, and the
   * thrown value must reach the sink by identity — not a copy, not a message —
   * together with what identifies the request in a log.
   */
  it('hands the original error, method, route template and ids to the sink', () => {
    const sink = new RecordingSink()
    const { filter, host, captured } = buildHarness({
      sink,
      correlationId: 'corr-1',
      traceId: TRACE_ID
    })
    const original = new Error('boom')

    filter.catch(original, host)

    expect(captured.status).toBe(500)
    expect(captured.body?.code).toBe('BYMAX_INTERNAL_ERROR')
    expect(captured.body?.message).toBe('Internal server error')
    expect(sink.reports).toHaveLength(1)
    expect(sink.reports[0]?.error).toBe(original)
    expect(sink.reports[0]).toEqual({
      error: original,
      method: 'GET',
      route: '/invoices/:id',
      correlationId: 'corr-1',
      traceId: TRACE_ID
    })
  })

  /**
   * The trace id reaches the sink even when the body withholds it.
   *
   * `exposeTraceId` is off by default and governs the response only; the sink
   * feeds a log, where the trace id is what makes the error findable.
   */
  it('reports the trace id while the envelope omits it', () => {
    const sink = new RecordingSink()
    const { filter, host, captured } = buildHarness({ sink, traceId: TRACE_ID })

    filter.catch(new Error('boom'), host)

    expect(captured.body).not.toHaveProperty('traceId')
    expect(sink.reports[0]?.traceId).toBe(TRACE_ID)
  })

  /**
   * Unknown ids are absent keys, not keys holding `undefined`.
   *
   * A sink that spreads the report into a structured log line would otherwise
   * write empty fields. `toEqual` cannot see the difference, so the key set is
   * asserted directly.
   */
  it('omits correlationId and traceId keys when neither resolves', () => {
    const sink = new RecordingSink()
    const { filter, host } = buildHarness({ sink })

    filter.catch(new Error('boom'), host)

    expect(Object.keys(sink.reports[0] as object).sort()).toEqual(['error', 'method', 'route'])
  })

  /**
   * Fastify's template is read as well as Express's.
   *
   * Fastify carries the matched template on `routeOptions.url`, not on
   * `route.path`; the filter must not report a Fastify route as unmatched.
   */
  it('reads the route template from a Fastify request', () => {
    const sink = new RecordingSink()
    const { filter, host } = buildHarness({
      sink,
      request: { url: '/orders/9', method: 'POST', routeOptions: { url: '/orders/:id' } }
    })

    filter.catch(new Error('boom'), host)

    expect(sink.reports[0]?.method).toBe('POST')
    expect(sink.reports[0]?.route).toBe('/orders/:id')
  })

  /**
   * A request that matched no route reports the shared label, never its URL.
   *
   * An error raised by middleware before routing has no template. The raw URL
   * is what a query-string token or a scanner's probe path would leak through,
   * so it must not stand in for one.
   */
  it('reports UNMATCHED_ROUTE and no part of the raw URL when nothing matched', () => {
    const sink = new RecordingSink()
    const { filter, host, captured } = buildHarness({
      sink,
      request: {
        url: '/login?token=s3cr3t-value',
        method: 'GET',
        headers: { authorization: 'Bearer h3ader-value' },
        body: { password: 'b0dy-value' }
      }
    })

    filter.catch(new Error('boom'), host)

    expect(sink.reports[0]?.route).toBe(UNMATCHED_ROUTE)
    const reportText = JSON.stringify({ ...sink.reports[0], error: undefined })
    expect(reportText).not.toContain('/login')
    expect(reportText).not.toContain('s3cr3t-value')
    expect(reportText).not.toContain('h3ader-value')
    expect(reportText).not.toContain('b0dy-value')
    expect(captured.status).toBe(500)
  })

  /**
   * Only unexpected errors reach the sink.
   *
   * An `HttpException` is a deliberate answer, and an exposed 4xx from the body
   * pipeline is a client mistake. Neither is a server failure, and a sink fed
   * both would bury the failures it exists to surface.
   */
  it('is not called for an HttpException or an exposed client error', () => {
    const sink = new RecordingSink()
    const { filter, host, captured } = buildHarness({ sink })

    filter.catch(new NotFoundException('missing'), host)
    expect(captured.status).toBe(404)
    filter.catch(Object.assign(new Error('payload too large'), { status: 413, expose: true }), host)
    expect(captured.status).toBe(413)

    expect(sink.reports).toEqual([])
  })

  /**
   * A thrown non-`Error` value is reported as it was thrown.
   *
   * `throw 'text'` and `throw { ... }` are legal and occur; the sink receives
   * the value itself rather than a wrapper the filter invented.
   */
  it('reports a thrown non-Error value by identity', () => {
    const sink = new RecordingSink()
    const { filter, host } = buildHarness({ sink })
    const thrown = { reason: 'not an Error' }

    filter.catch(thrown, host)

    expect(sink.reports[0]?.error).toBe(thrown)
  })

  /**
   * A throwing sink never changes the response.
   *
   * The envelope with a sink that throws must be the envelope with no sink at
   * all; the comparison is against a filter built without one, so a sink
   * failure that altered any field would show.
   */
  it('delivers the same envelope when the sink throws', () => {
    const throwing: IUnexpectedErrorSink = {
      record: (): void => {
        throw new Error('sink is broken')
      }
    }
    const withSink = buildHarness({ sink: throwing, correlationId: 'corr-1' })
    const without = buildHarness({ correlationId: 'corr-1' })

    withSink.filter.catch(new Error('boom'), withSink.host)
    without.filter.catch(new Error('boom'), without.host)

    expect(withSink.captured.status).toBe(500)
    expect({ ...withSink.captured.body, timestamp: '' }).toEqual({
      ...without.captured.body,
      timestamp: ''
    })
  })

  /**
   * An `async record()` that rejects is contained.
   *
   * It compiles against the `void` return type, and uncontained it is an
   * unhandled rejection — able to end the process under
   * `--unhandled-rejections=strict`.
   */
  it('contains a rejection from an async sink', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      const rejecting: IUnexpectedErrorSink = {
        record: async (): Promise<void> => {
          throw new Error('async sink is broken')
        }
      }
      const { filter, host, captured } = buildHarness({ sink: rejecting })

      filter.catch(new Error('boom'), host)
      await new Promise((resolve) => setImmediate(resolve))

      expect(captured.status).toBe(500)
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  /**
   * The sink and the protected seam both run, and neither can stop the other.
   *
   * A subclass overriding `onUnexpectedError` must keep receiving every call
   * when a sink is bound, and a seam that throws must not cost the sink its
   * report.
   */
  it('runs alongside a throwing onUnexpectedError override', () => {
    const seen: unknown[] = []
    class ThrowingSeamFilter extends BymaxExceptionFilter {
      protected override onUnexpectedError(error: unknown, _context: FilterErrorContext): void {
        seen.push(error)
        throw new Error('seam is broken')
      }
    }
    const sink = new RecordingSink()
    const { filter, host, captured } = buildHarness({ sink, filterCtor: ThrowingSeamFilter })
    const original = new Error('boom')

    filter.catch(original, host)

    expect(seen).toEqual([original])
    expect(sink.reports.map((report) => report.error)).toEqual([original])
    expect(captured.status).toBe(500)
  })

  /**
   * No sink bound is the default, and costs nothing observable.
   */
  it('formats the envelope normally with no sink bound', () => {
    const { filter, host, captured } = buildHarness({})

    filter.catch(new Error('boom'), host)

    expect(captured.status).toBe(500)
    expect(captured.body?.code).toBe('BYMAX_INTERNAL_ERROR')
  })

  /**
   * A sink that mutates the thrown value cannot reach the response.
   *
   * The sink receives the original `Error`, and a logging sink may redact or
   * enrich it in place. With `exposeInternals` on, the envelope carries that
   * error's message and stack, so they must be read before the sink runs —
   * otherwise the response would depend on what the sink did.
   */
  it('builds the envelope from the error as thrown, before the sink can change it', () => {
    const redacting: IUnexpectedErrorSink = {
      record: ({ error }): void => {
        if (error instanceof Error) {
          error.message = 'redacted by the sink'
          error.stack = 'redacted stack'
        }
      }
    }
    const { filter, host, captured } = buildHarness({ sink: redacting, exposeInternals: true })

    filter.catch(new Error('original failure'), host)

    expect(captured.body?.details).toMatchObject({ message: 'original failure' })
    expect(JSON.stringify(captured.body)).not.toContain('redacted')
  })

  /**
   * The protected seam is held to the same rule as the sink.
   *
   * A subclass overriding `onUnexpectedError` receives the same mutable value;
   * redacting it there must not reach the response either.
   */
  it('builds the envelope before an onUnexpectedError override can change the error', () => {
    class RedactingFilter extends BymaxExceptionFilter {
      protected override onUnexpectedError(error: unknown): void {
        if (error instanceof Error) {
          error.message = 'redacted by the seam'
        }
      }
    }
    const { filter, host, captured } = buildHarness({
      filterCtor: RedactingFilter,
      exposeInternals: true
    })

    filter.catch(new Error('original failure'), host)

    expect(captured.body?.details).toMatchObject({ message: 'original failure' })
  })
})
