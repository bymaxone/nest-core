/**
 * Unit tests for BymaxExceptionFilter, around the mapping.
 *
 * Layer: unit.
 * Goal: prove the filter rethrows non-HTTP contexts, reads path and method
 * through neutral adapter accessors, hands unexpected errors to the
 * observability seam, and omits the correlation and trace ids it does not have.
 * Mocks: the ArgumentsHost and HttpAdapter built by the shared harness.
 */
import { NotFoundException } from '@nestjs/common'

import { normalizeCoreOptions } from '../core.options'

import type { TraceContext } from '../telemetry/trace-context'
import { BymaxExceptionFilter } from './exception.filter'
import {
  buildHarness,
  stubCorrelation,
  stubTraceContext
} from './__tests__/exception-filter.harness'

describe('BymaxExceptionFilter, context handling', () => {
  /**
   * Non-HTTP contexts are rethrown untouched.
   *
   * GraphQL and RPC are out of scope this release, so the filter must rethrow
   * the original exception rather than format an HTTP body.
   */
  it('rethrows the original exception for a non-HTTP context', () => {
    const { filter, host, captured } = buildHarness({ contextType: 'rpc' })
    const error = new Error('rpc failure')

    expect(() => filter.catch(error, host)).toThrow(error)
    expect(captured.body).toBeUndefined()
  })

  /**
   * Unknown errors collapse to the production-safe 500.
   *
   * A plain Error must never leak: it collapses to 500 / BYMAX_INTERNAL_ERROR
   * with the fixed generic message and no details when internals stay hidden.
   */
  it('collapses an unknown error to a generic 500 envelope', () => {
    const { filter, host, captured } = buildHarness()

    filter.catch(new Error('database exploded'), host)

    expect(captured.status).toBe(500)
    expect(captured.body).toMatchObject({
      statusCode: 500,
      code: 'BYMAX_INTERNAL_ERROR',
      message: 'Internal server error'
    })
    expect(captured.body?.details).toBeUndefined()
  })

  /**
   * An exposed 4xx error from the body pipeline keeps its status.
   *
   * `body-parser` throws `http-errors` instances before any handler runs — a payload past the
   * limit is `PayloadTooLargeError`, a plain `Error` with `status: 413` and `expose: true`. It is
   * not a Nest `HttpException`, so it used to collapse to 500: a client that sent too large a body
   * was told the server failed. The status and the safe message are honoured now.
   */
  it('honours the status of an exposed 4xx error raised outside a handler', () => {
    const { filter, host, captured } = buildHarness()
    const tooLarge = Object.assign(new Error('request entity too large'), {
      status: 413,
      statusCode: 413,
      expose: true
    })

    filter.catch(tooLarge, host)

    expect(captured.status).toBe(413)
    expect(captured.body).toMatchObject({
      statusCode: 413,
      code: 'BYMAX_PAYLOAD_TOO_LARGE',
      message: 'request entity too large'
    })
  })

  /**
   * An exposed 4xx error with no dedicated catalogue row falls back to the client-error code.
   *
   * A 405 has no `BYMAX_*` row of its own, so it must derive `BYMAX_CLIENT_ERROR` rather than
   * leaking an unmapped value — the same derivation an uncatalogued `HttpException` status takes.
   */
  it('derives the client-error code for an exposed 4xx status without a catalogue row', () => {
    const { filter, host, captured } = buildHarness()
    const methodNotAllowed = Object.assign(new Error('method not allowed'), {
      statusCode: 405,
      expose: true
    })

    filter.catch(methodNotAllowed, host)

    expect(captured.status).toBe(405)
    expect(captured.body?.code).toBe('BYMAX_CLIENT_ERROR')
  })

  /**
   * A self-reported 5xx never escapes the generic collapse, even with `expose` set.
   *
   * The point of the 500 collapse is that a server failure never surfaces its own account of
   * itself. A library that flags a 5xx as exposable does not change that, so a 502 stays a generic
   * 500 with no leaked message.
   */
  it('still collapses an exposed 5xx to the generic 500', () => {
    const { filter, host, captured } = buildHarness()
    const upstream = Object.assign(new Error('upstream said 502'), {
      status: 502,
      expose: true
    })

    filter.catch(upstream, host)

    expect(captured.status).toBe(500)
    expect(captured.body).toMatchObject({
      code: 'BYMAX_INTERNAL_ERROR',
      message: 'Internal server error'
    })
    expect(JSON.stringify(captured.body)).not.toContain('upstream said')
  })

  /**
   * The 5xx boundary is exactly 500.
   *
   * The range that gets honoured is `[400, 500)`, so status 500 itself is a server error and must
   * collapse — pinning the boundary at 500 rather than one either side. Its message must not leak.
   */
  it('collapses an exposed status of exactly 500 without leaking its message', () => {
    const { filter, host, captured } = buildHarness()
    const boundary = Object.assign(new Error('five hundred leak'), { status: 500, expose: true })

    filter.catch(boundary, host)

    expect(captured.status).toBe(500)
    expect(captured.body?.code).toBe('BYMAX_INTERNAL_ERROR')
    expect(JSON.stringify(captured.body)).not.toContain('five hundred leak')
  })

  /**
   * A status below the client-error range is not honoured.
   *
   * The lower bound is 400, so a status like 399 — a redirect or an informational code that has no
   * business on a thrown error — collapses to the generic 500 rather than being surfaced.
   */
  it('collapses an exposed status below 400', () => {
    const { filter, host, captured } = buildHarness()
    const belowRange = Object.assign(new Error('not a client error'), { status: 399, expose: true })

    filter.catch(belowRange, host)

    expect(captured.status).toBe(500)
  })

  /**
   * A thrown `null` collapses without the exposed-error probe crashing on it.
   *
   * `null` is the one non-object value `typeof` reports as `'object'`, so the exposed-error check
   * has to exclude it explicitly before reading a property; a caught `null` must still reach the
   * generic 500 like any other unrecognised throw.
   */
  it('collapses a thrown null to the generic 500', () => {
    const { filter, host, captured } = buildHarness()

    filter.catch(null, host)

    expect(captured.status).toBe(500)
    expect(captured.body?.code).toBe('BYMAX_INTERNAL_ERROR')
  })

  /**
   * An error carrying a status but not marked exposable stays collapsed.
   *
   * `expose` is the http-errors flag that means "safe to show the client". Without it — a plain
   * error that happens to have a `status` property — the status is not trusted, and the error
   * collapses to the generic 500 rather than surfacing a status the thrower never vouched for.
   */
  it('does not honour a status on an error that is not marked exposable', () => {
    const { filter, host, captured } = buildHarness()
    const notExposed = Object.assign(new Error('internal with a status field'), { status: 418 })

    filter.catch(notExposed, host)

    expect(captured.status).toBe(500)
    expect(captured.body?.code).toBe('BYMAX_INTERNAL_ERROR')
  })

  /**
   * A NaN or non-integer status is not honoured.
   *
   * `typeof NaN === 'number'` and `NaN` slips past both range comparisons, so a guard that only
   * checked `typeof` would carry `NaN` — or a fraction like `413.5` — into the envelope and on to
   * the adapter as a status. Both must collapse to the generic 500.
   */
  it.each([NaN, 413.5, Infinity])('collapses an exposed error whose status is %p', (status) => {
    const { filter, host, captured } = buildHarness()
    const weird = Object.assign(new Error('odd status'), { status, expose: true })

    filter.catch(weird, host)

    expect(captured.status).toBe(500)
    expect(captured.body?.code).toBe('BYMAX_INTERNAL_ERROR')
  })

  /**
   * `statusCode` is honoured when `status` is absent or invalid.
   *
   * `http-errors` sets both `status` and `statusCode`; some libraries set only `statusCode`. When
   * `status` is missing (or not an integer), the code falls back to `statusCode`.
   */
  it('reads statusCode when status is absent', () => {
    const { filter, host, captured } = buildHarness()
    const onlyStatusCode = Object.assign(new Error('payload too large'), {
      statusCode: 413,
      expose: true
    })

    filter.catch(onlyStatusCode, host)

    expect(captured.status).toBe(413)
  })

  /**
   * A non-`Error` object marked exposable keeps its status but not its (absent) message.
   *
   * `expose` and `status` can sit on a plain object that is not an `Error`. Its status is honoured,
   * and because there is no `Error` message to trust, the generic message stands in — proving the
   * message only ever comes from an actual `Error`.
   */
  it('honours the status of an exposed non-Error object with the generic message', () => {
    const { filter, host, captured } = buildHarness()

    filter.catch({ status: 400, expose: true }, host)

    expect(captured.status).toBe(400)
    expect(captured.body?.message).toBe('Internal server error')
  })

  /**
   * A throwing observability hook must not break error formatting.
   *
   * The `onUnexpectedError` seam is documented as never throwing, but an
   * integration override might; the filter must swallow that failure and still
   * deliver the production-safe 500 envelope.
   */
  it('swallows a throwing onUnexpectedError hook and still formats the envelope', () => {
    class ThrowingHookFilter extends BymaxExceptionFilter {
      protected override onUnexpectedError(): void {
        throw new Error('hook failure')
      }
    }
    const { filter, host, captured } = buildHarness({ filterCtor: ThrowingHookFilter })

    expect(() => filter.catch(new Error('database exploded'), host)).not.toThrow()

    expect(captured.status).toBe(500)
    expect(captured.body?.code).toBe('BYMAX_INTERNAL_ERROR')
  })
})

describe('BymaxExceptionFilter, observability seam', () => {
  /** A subclass that records every error passed to the observability seam. */
  class RecordingFilter extends BymaxExceptionFilter {
    public readonly recorded: unknown[] = []

    protected override onUnexpectedError(error: unknown): void {
      this.recorded.push(error)
    }
  }

  /**
   * The seam receives the original error before collapse.
   *
   * An unexpected error must be handed to the overridable seam before it
   * collapses to the generic 500, so an integration can log the original error;
   * HttpExceptions must not reach the seam.
   */
  it('hands an unexpected error to the seam and skips it for HttpExceptions', () => {
    const { host, adapterHost } = buildHarness()
    const filter = new RecordingFilter(normalizeCoreOptions(), stubCorrelation(), adapterHost)
    const original = new Error('unexpected')

    filter.catch(original, host)
    filter.catch(new NotFoundException('missing'), host)

    expect(filter.recorded).toEqual([original])
  })
})

describe('BymaxExceptionFilter, correlation-provider fallback', () => {
  /**
   * No correlation provider resolves.
   *
   * `BymaxCoreModule` binds no local default for `BYMAX_CORRELATION_PROVIDER`
   * (see `defaults.providers.ts`): when nothing is injected, the constructor
   * must fall back to a no-op provider so the envelope simply omits
   * `correlationId`, matching the previously-documented default behavior.
   */
  it('omits correlationId when constructed with no correlation provider', () => {
    const { filter, host, captured } = buildHarness({ noCorrelation: true })

    filter.catch(new NotFoundException('missing'), host)

    expect(captured.body).not.toHaveProperty('correlationId')
    // The KEY has to be absent, not present holding `undefined`. `toHaveProperty` does not
    // separate those and `JSON.stringify` erases the difference, so nothing here could tell a
    // conditional spread from an unconditional one — but anything that reads the envelope as an
    // object rather than as a response body can: an `onEnvelope` hook, a structured log, a
    // snapshot. Both spreads are conditional on purpose, so that is what is asserted.
    expect(Object.hasOwn(captured.body as object, 'correlationId')).toBe(false)
  })
})

describe('BymaxExceptionFilter, trace correlation', () => {
  /** A trace id the stub provider resolves. */
  const TRACE_ID = 'a'.repeat(32)

  /**
   * The trace id reaches the body only when publishing it was opted into.
   *
   * With telemetry on but `exposeTraceId` off, the identifier still travels to
   * the observability seam; the response must not carry it, because putting it
   * there is a decision about what clients see.
   */
  it('omits traceId from the body while exposeTraceId is off', () => {
    const { filter, host, captured } = buildHarness({
      options: normalizeCoreOptions({ telemetry: { enabled: true } }),
      traceContext: stubTraceContext(TRACE_ID)
    })

    filter.catch(new NotFoundException('missing'), host)

    expect(captured.body).not.toHaveProperty('traceId')
    expect(Object.hasOwn(captured.body as object, 'traceId')).toBe(false)
  })

  /**
   * Opting in publishes the trace id.
   *
   * This is what a support team asks for: the identifier that ties the response
   * a caller is holding to the trace an engineer can open.
   */
  it('includes traceId in the body when exposeTraceId is on', () => {
    const { filter, host, captured } = buildHarness({
      options: normalizeCoreOptions({ telemetry: { enabled: true, exposeTraceId: true } }),
      traceContext: stubTraceContext(TRACE_ID)
    })

    filter.catch(new NotFoundException('missing'), host)

    expect(captured.body?.traceId).toBe(TRACE_ID)
  })

  /**
   * An untraced request carries no key. Edge case: nothing recording.
   *
   * Even with the option on, a request outside any trace must omit the field
   * rather than serialize an empty or null one.
   */
  it('omits traceId when no span is active', () => {
    const { filter, host, captured } = buildHarness({
      options: normalizeCoreOptions({ telemetry: { enabled: true, exposeTraceId: true } }),
      traceContext: stubTraceContext(undefined)
    })

    filter.catch(new NotFoundException('missing'), host)

    expect(captured.body).not.toHaveProperty('traceId')
    expect(Object.hasOwn(captured.body as object, 'traceId')).toBe(false)
  })

  /**
   * A throwing correlation provider still yields an envelope. Regression guard.
   *
   * The correlation provider is supplied by the consumer — it commonly reads a
   * request-scoped context that may simply not exist for a given call. If that
   * read could throw here, an application would lose the error response instead
   * of one optional field, on exactly the requests it most needs to see.
   */
  it('still serves the envelope when the correlation provider throws', () => {
    const { filter, host, captured } = buildHarness({
      correlation: {
        getCorrelationId: (): string | undefined => {
          throw new Error('no request context')
        }
      }
    })

    filter.catch(new NotFoundException('missing'), host)

    expect(captured.body).toMatchObject({ statusCode: 404, code: 'BYMAX_NOT_FOUND' })
    expect(captured.body).not.toHaveProperty('correlationId')
    expect(Object.hasOwn(captured.body as object, 'correlationId')).toBe(false)
  })

  /**
   * A throwing trace provider still yields an envelope. Regression guard.
   *
   * This filter is the last thing between an error and the client. If a
   * telemetry read could throw here, a broken tracer would turn every error
   * response into no response at all — the one failure this feature exists to
   * prevent.
   */
  it('still serves the envelope when the trace provider throws', () => {
    const { filter, host, captured } = buildHarness({
      options: normalizeCoreOptions({ telemetry: { enabled: true, exposeTraceId: true } }),
      traceContext: {
        getTraceContext: (): TraceContext | undefined => {
          throw new Error('tracer exploded')
        }
      }
    })

    filter.catch(new NotFoundException('missing'), host)

    expect(captured.body).toMatchObject({ statusCode: 404, code: 'BYMAX_NOT_FOUND' })
    expect(captured.body).not.toHaveProperty('traceId')
    expect(Object.hasOwn(captured.body as object, 'traceId')).toBe(false)
  })

  /**
   * No bound provider behaves like no trace. Edge case: nothing injected.
   *
   * The filter is constructible on its own, and its in-code fallback must make
   * an unbound token indistinguishable from an untraced request.
   */
  it('omits traceId when no trace provider is bound at all', () => {
    const { filter, host, captured } = buildHarness({
      options: normalizeCoreOptions({ telemetry: { enabled: true, exposeTraceId: true } })
    })

    filter.catch(new NotFoundException('missing'), host)

    expect(captured.body).not.toHaveProperty('traceId')
    expect(Object.hasOwn(captured.body as object, 'traceId')).toBe(false)
  })
})
