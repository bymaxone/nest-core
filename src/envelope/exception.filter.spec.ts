/**
 * Unit tests for BymaxExceptionFilter.
 *
 * Layer: unit.
 * Goal: prove the filter formats HttpExceptions into the stable envelope with
 * the right status, message, and catalog-derived or passed-through code; reads
 * path and method through neutral adapter accessors; rethrows non-HTTP
 * contexts; and collapses unknown errors to the production-safe 500.
 * Mocks: a hand-built ArgumentsHost and HttpAdapter; the correlation provider
 * is a stub returning no id (correlation stamping is covered in the contract
 * suite).
 */
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  ImATeapotException,
  NotFoundException
} from '@nestjs/common'
import type { ArgumentsHost } from '@nestjs/common'
import type { HttpAdapterHost } from '@nestjs/core'

import { normalizeCoreOptions } from '../core.options'
import type { ResolvedCoreOptions } from '../core.options'

import type { ICorrelationIdProvider } from './correlation.interfaces'
import type { ITraceContextProvider, TraceContext } from '../telemetry/trace-context'
import { BymaxExceptionFilter } from './exception.filter'
import type { ErrorEnvelope } from './error-envelope'

/** Captured arguments of the adapter's `reply` call. */
interface Captured {
  body: ErrorEnvelope | undefined
  status: number | undefined
}

/** A stub correlation provider that resolves the given id (default: none). */
function stubCorrelation(id?: string): ICorrelationIdProvider {
  return { getCorrelationId: (): string | undefined => id }
}

/** Build a trace-context provider resolving the given trace, or nothing. */
function stubTraceContext(traceId?: string): ITraceContextProvider {
  return {
    getTraceContext: (): TraceContext | undefined =>
      traceId === undefined ? undefined : { traceId, spanId: 'b'.repeat(16) }
  }
}

/** Build a filter plus an HTTP host wired to capture the reply. */
function buildHarness(params?: {
  options?: ResolvedCoreOptions
  correlation?: ICorrelationIdProvider
  /** Trace-context provider; omitted leaves the filter's own no-op fallback. */
  traceContext?: ITraceContextProvider
  /** Pass `undefined` for the correlation provider instead of the default stub. */
  noCorrelation?: boolean
  contextType?: string
  url?: string
  method?: string
  filterCtor?: new (
    options: ResolvedCoreOptions,
    correlation: ICorrelationIdProvider | undefined,
    adapterHost: HttpAdapterHost,
    traceContext?: ITraceContextProvider
  ) => BymaxExceptionFilter
}): {
  filter: BymaxExceptionFilter
  host: ArgumentsHost
  captured: Captured
  adapterHost: HttpAdapterHost
} {
  const captured: Captured = { body: undefined, status: undefined }
  const request = { url: params?.url ?? '/invoices/inv_123', method: params?.method ?? 'GET' }
  const httpAdapter = {
    getRequestUrl: (req: { url: string }): string => req.url,
    getRequestMethod: (req: { method: string }): string => req.method,
    reply: (_response: unknown, body: ErrorEnvelope, status: number): void => {
      captured.body = body
      captured.status = status
    }
  }
  const adapterHost = { httpAdapter } as unknown as HttpAdapterHost
  const host = {
    getType: (): string => params?.contextType ?? 'http',
    switchToHttp: () => ({
      getRequest: (): unknown => request,
      getResponse: (): unknown => ({})
    })
  } as unknown as ArgumentsHost
  const FilterCtor = params?.filterCtor ?? BymaxExceptionFilter
  const correlation = params?.noCorrelation ? undefined : (params?.correlation ?? stubCorrelation())
  const filter = new FilterCtor(
    params?.options ?? normalizeCoreOptions(),
    correlation,
    adapterHost,
    params?.traceContext
  )
  return { filter, host, captured, adapterHost }
}

describe('BymaxExceptionFilter, HttpException mapping', () => {
  /**
   * Catalogued status derives the catalog code.
   *
   * A NotFoundException must produce status 404 with the catalog code
   * BYMAX_NOT_FOUND and the exception's message, the baseline mapping contract.
   */
  it('maps NotFoundException to 404 and BYMAX_NOT_FOUND', () => {
    const { filter, host, captured } = buildHarness()

    filter.catch(new NotFoundException('Invoice inv_123 was not found'), host)

    expect(captured.status).toBe(404)
    expect(captured.body).toMatchObject({
      statusCode: 404,
      code: 'BYMAX_NOT_FOUND',
      message: 'Invoice inv_123 was not found',
      path: '/invoices/inv_123'
    })
  })

  /**
   * Explicit domain code passes through verbatim.
   *
   * When the exception response carries an explicit `code`, the filter must not
   * override it with a catalog code: domain codes own the semantics.
   */
  it('passes an explicit response code through verbatim', () => {
    const { filter, host, captured } = buildHarness()

    filter.catch(new BadRequestException({ code: 'INVOICE_OVERDUE', message: 'Overdue' }), host)

    expect(captured.body?.code).toBe('INVOICE_OVERDUE')
    expect(captured.body?.message).toBe('Overdue')
    expect(captured.status).toBe(400)
  })

  /**
   * A domain error's own details reach the caller.
   *
   * A code the caller can branch on is only half the contract: an exception that
   * attached structured context did so because the caller needs it. Dropping it
   * left a client able to tell *that* something failed and not *what*.
   */
  it('passes an explicit response details array through verbatim', () => {
    const { filter, host, captured } = buildHarness()

    filter.catch(
      new BadRequestException({
        code: 'INVOICE_OVERDUE',
        message: 'Overdue',
        details: [{ field: 'dueDate', message: 'is in the past' }]
      }),
      host
    )

    expect(captured.body?.details).toEqual([{ field: 'dueDate', message: 'is in the past' }])
  })

  /**
   * The nested shape is read as readily as the flat one.
   *
   * `@bymax-one/nest-auth` builds `{ error: { code, message, details } }`, so a
   * backend wiring both libraries saw every distinct auth failure — a duplicate
   * e-mail, a short password, a missing field — render as one opaque
   * `BYMAX_BAD_REQUEST` / "Auth Exception". Neither the client nor whoever was
   * debugging could tell them apart.
   */
  it('reads code, message and details from a nested error object', () => {
    const { filter, host, captured } = buildHarness()

    filter.catch(
      new BadRequestException({
        error: {
          code: 'auth.validation',
          message: 'Validation failed',
          details: [{ field: 'tenantId', message: 'tenantId is required' }]
        }
      }),
      host
    )

    expect(captured.body?.code).toBe('auth.validation')
    expect(captured.body?.message).toBe('Validation failed')
    expect(captured.body?.details).toEqual([{ field: 'tenantId', message: 'tenantId is required' }])
  })

  /**
   * A nested object without a string code is not a domain error.
   *
   * `error` is an ordinary word for a response body to use — a passthrough from
   * an upstream service, a hand-built payload. Following it unconditionally
   * would read the message from a place that means something else, so the code
   * is what marks the object as a carrier.
   */
  it('ignores a nested error object that carries no string code', () => {
    const { filter, host, captured } = buildHarness()

    filter.catch(new HttpException({ error: { message: 'upstream said so' } }, 409), host)

    expect(captured.body?.code).toBe('BYMAX_CONFLICT')
    expect(captured.body?.details).toBeUndefined()
  })

  /**
   * A flat code wins over a nested one.
   *
   * Only reachable if a response carried both, which no library here does. The
   * flat form is the one this filter documented first, so it is the one that
   * decides, rather than the answer depending on property order.
   */
  it('prefers a flat code over a nested one', () => {
    const { filter, host, captured } = buildHarness()

    filter.catch(new HttpException({ code: 'FLAT', error: { code: 'NESTED' } }, 400), host)

    expect(captured.body?.code).toBe('FLAT')
  })

  /**
   * `null` details are absent details.
   *
   * `AuthException` writes `details: null` to mean "none", and the envelope's
   * contract is that the field is present only when structured context exists.
   * A literal `null` in the body would be a third state for a client to handle.
   */
  it('omits details when the carrier sets them to null', () => {
    const { filter, host, captured } = buildHarness()

    filter.catch(
      new BadRequestException({ error: { code: 'auth.invalid', message: 'no', details: null } }),
      host
    )

    expect(captured.body?.code).toBe('auth.invalid')
    expect(captured.body).not.toHaveProperty('details')
  })

  /**
   * The object form of details passes through as readily as the array form.
   *
   * `ErrorDetails` admits both — the array for one entry per violation, the
   * object for context that is not a list. A domain error using the second must
   * not be silently reduced to no details at all.
   */
  it('passes an explicit details object through verbatim', () => {
    const { filter, host, captured } = buildHarness()

    filter.catch(
      new BadRequestException({ code: 'QUOTA', message: 'over', details: { limit: 10, used: 11 } }),
      host
    )

    expect(captured.body?.details).toEqual({ limit: 10, used: 11 })
  })

  /**
   * A details value of a shape the contract does not admit is dropped.
   *
   * `ErrorDetails` is an array or an object. A scalar is neither, and reshaping
   * it into one would publish something the throwing library never wrote.
   */
  it('drops a scalar details value rather than reshaping it', () => {
    const { filter, host, captured } = buildHarness()

    filter.catch(new BadRequestException({ code: 'X', message: 'y', details: 'nope' }), host)

    expect(captured.body).not.toHaveProperty('details')
  })

  /**
   * Uncatalogued 4xx derives the client-error fallback.
   *
   * A 418 has no dedicated catalog row, so the code must fall back to
   * BYMAX_CLIENT_ERROR rather than leaking an unmapped value.
   */
  it('derives BYMAX_CLIENT_ERROR for an uncatalogued 4xx status', () => {
    const { filter, host, captured } = buildHarness()

    filter.catch(new ImATeapotException(), host)

    expect(captured.status).toBe(HttpStatus.I_AM_A_TEAPOT)
    expect(captured.body?.code).toBe('BYMAX_CLIENT_ERROR')
  })

  /**
   * String response body becomes the message.
   *
   * An HttpException constructed with a plain string response must use that
   * string as the envelope message, exercising the string branch of extraction.
   */
  it('uses a string exception response as the message', () => {
    const { filter, host, captured } = buildHarness()

    filter.catch(new HttpException('Plain failure', 409), host)

    expect(captured.body).toMatchObject({
      statusCode: 409,
      code: 'BYMAX_CONFLICT',
      message: 'Plain failure'
    })
  })

  /**
   * A string response wins over the exception's own message.
   *
   * Nest normally keeps `exception.message` in sync with a string response, which
   * hides whether extraction reads the response or the fallback. Forcing them
   * apart proves the string-response branch returns the RESPONSE string, not
   * `exception.message`: without that branch this envelope would carry the
   * fallback instead.
   */
  it('returns the string response over a diverging exception message', () => {
    const { filter, host, captured } = buildHarness()
    const exception = new HttpException('response body wins', 409)
    Object.defineProperty(exception, 'message', { value: 'exception fallback' })

    filter.catch(exception, host)

    expect(captured.body?.message).toBe('response body wins')
  })

  /**
   * A response object's string message wins over the exception's own message.
   *
   * The object-response branch must read `response.message` when it is a string,
   * not `exception.message`. Diverging the two proves both the outer object guard
   * and the inner string-message return are load-bearing: emptying either would
   * yield the fallback message instead of the response's.
   */
  it('returns the object response message over a diverging exception message', () => {
    const { filter, host, captured } = buildHarness()
    const exception = new HttpException({ message: 'object body wins' }, 403)
    Object.defineProperty(exception, 'message', { value: 'exception fallback' })

    filter.catch(exception, host)

    expect(captured.body?.code).toBe('BYMAX_FORBIDDEN')
    expect(captured.body?.message).toBe('object body wins')
  })

  /**
   * Object response without a string message falls back to the exception message.
   *
   * When the response object carries no usable string `message`, extraction must
   * fall back to `exception.message`, covering the fallback branch.
   */
  it('falls back to the exception message when the response has no string message', () => {
    const { filter, host, captured } = buildHarness()

    filter.catch(new HttpException({ reason: 'x' }, 403), host)

    expect(captured.body).toMatchObject({ statusCode: 403, code: 'BYMAX_FORBIDDEN' })
    expect(typeof captured.body?.message).toBe('string')
  })

  /**
   * A non-string response code is ignored, not passed through.
   *
   * Only string codes are domain codes; a non-string `code` must be discarded so
   * the envelope falls back to the catalog derivation, protecting code integrity.
   */
  it('ignores a non-string response code and derives from status', () => {
    const { filter, host, captured } = buildHarness()

    filter.catch(new HttpException({ code: 123, message: 'Broken' }, 409), host)

    expect(captured.body?.code).toBe('BYMAX_CONFLICT')
    expect(captured.body?.message).toBe('Broken')
  })

  /**
   * A non-string, non-array message value falls back to the exception message.
   *
   * When `message` is present but neither a string nor a validation array (for
   * example a number), the response is not a validation shape, so the code is
   * derived from the status and the message falls back to `exception.message`.
   */
  it('falls back to the exception message when the response message is not a string', () => {
    const { filter, host, captured } = buildHarness()

    filter.catch(new HttpException({ message: 42 }, 400), host)

    expect(captured.body?.code).toBe('BYMAX_BAD_REQUEST')
    expect(typeof captured.body?.message).toBe('string')
  })

  /**
   * A null exception response must not crash the filter.
   *
   * `HttpException.getResponse()` can return null; the `in` checks would throw a
   * TypeError without a null guard. The filter must still derive the code from
   * the status and fall back to the exception message.
   */
  it('formats an HttpException whose response is null without throwing', () => {
    const { filter, host, captured } = buildHarness()

    expect(() =>
      filter.catch(new HttpException(null as unknown as string, 400), host)
    ).not.toThrow()

    expect(captured.status).toBe(400)
    expect(captured.body?.code).toBe('BYMAX_BAD_REQUEST')
    expect(typeof captured.body?.message).toBe('string')
  })

  /**
   * A non-object primitive response must not crash the filter.
   *
   * The `in` operator throws when its right operand is a primitive, so a numeric
   * response (reachable at runtime) requires a `typeof === 'object'` guard. The
   * filter must derive the code from the status and use the exception message.
   */
  it('formats an HttpException whose response is a primitive without throwing', () => {
    const { filter, host, captured } = buildHarness()

    expect(() => filter.catch(new HttpException(42 as unknown as string, 400), host)).not.toThrow()

    expect(captured.status).toBe(400)
    expect(captured.body?.code).toBe('BYMAX_BAD_REQUEST')
    expect(typeof captured.body?.message).toBe('string')
  })
})

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

describe('BymaxExceptionFilter, validation mapping', () => {
  /**
   * Validation array translates to structured details.
   *
   * A BadRequestException carrying a message array (the validation-pipe shape)
   * must become BYMAX_VALIDATION_FAILED with one structured entry per violation,
   * so clients receive machine-readable issues rather than a flat string.
   */
  it('maps a validation message array to BYMAX_VALIDATION_FAILED with structured details', () => {
    const { filter, host, captured } = buildHarness()

    filter.catch(
      new BadRequestException(['email must be an email', 'name should not be empty']),
      host
    )

    expect(captured.status).toBe(400)
    expect(captured.body).toMatchObject({
      statusCode: 400,
      code: 'BYMAX_VALIDATION_FAILED',
      message: 'Validation failed',
      details: [{ issue: 'email must be an email' }, { issue: 'name should not be empty' }]
    })
  })

  /**
   * Already-structured violations pass through verbatim.
   *
   * When a violation is an object rather than a string, it is already
   * structured, so it must be kept as-is, exercising the object branch of the
   * detail translation.
   */
  it('keeps already-structured violation objects verbatim', () => {
    const { filter, host, captured } = buildHarness()

    filter.catch(
      new BadRequestException({ message: [{ field: 'id', issue: 'unknown identifier' }] }),
      host
    )

    expect(captured.body?.code).toBe('BYMAX_VALIDATION_FAILED')
    expect(captured.body?.details).toEqual([{ field: 'id', issue: 'unknown identifier' }])
  })
})

describe('BymaxExceptionFilter, exposeInternals switch', () => {
  /** Options with the development-only internals switch turned on. */
  const exposedOptions = normalizeCoreOptions({ envelope: { exposeInternals: true } })

  /**
   * Internals hidden by default, no message or stack leak.
   *
   * The production default must never serialize the original message or any
   * stack frame; the entire collapsed body may contain neither, protecting the
   * error-disclosure surface.
   */
  it('never leaks the original message or stack when internals are hidden', () => {
    const { filter, host, captured } = buildHarness()

    filter.catch(new Error('secret db dsn leaked here'), host)

    const serialized = JSON.stringify(captured.body)
    expect(serialized).not.toContain('secret db dsn leaked here')
    expect(serialized).not.toContain('stack')
    expect(serialized.toLowerCase()).not.toContain('.spec.ts')
  })

  /**
   * A thrown non-Error value also collapses without leaking.
   *
   * Throwing a string (or any non-Error) must still collapse to the generic 500
   * with no details when internals are hidden, covering the non-Error path.
   */
  it('collapses a thrown non-Error value without leaking when internals are hidden', () => {
    const { filter, host, captured } = buildHarness()

    filter.catch('raw string failure', host)

    expect(captured.body).toMatchObject({ statusCode: 500, code: 'BYMAX_INTERNAL_ERROR' })
    expect(captured.body?.details).toBeUndefined()
  })

  /**
   * Internals on, an Error carries its message and stack.
   *
   * In development the details must carry the original message and stack so a
   * developer can debug, exercising the Error branch of the internals dump.
   */
  it('attaches the message and stack of an Error when internals are on', () => {
    const { filter, host, captured } = buildHarness({ options: exposedOptions })
    const error = new Error('boom in service')

    filter.catch(error, host)

    expect(captured.body?.details).toEqual({ message: 'boom in service', stack: error.stack })
  })

  /**
   * Internals on, an Error without a stack still carries its message.
   *
   * A stack-less Error must degrade to a message-only detail rather than
   * emitting a `stack: undefined` key, covering the stack-absent branch.
   */
  it('omits the stack when an Error has none and internals are on', () => {
    const { filter, host, captured } = buildHarness({ options: exposedOptions })
    const error = new Error('no stack here')
    Object.defineProperty(error, 'stack', { value: undefined })

    filter.catch(error, host)

    expect(captured.body?.details).toEqual({ message: 'no stack here' })
  })

  /**
   * Internals on, a non-Error carries a stringified message.
   *
   * A thrown non-Error value must surface its string form as the message so the
   * developer still sees what was thrown, covering the non-Error internals branch.
   */
  it('stringifies a thrown non-Error value into the details message when internals are on', () => {
    const { filter, host, captured } = buildHarness({ options: exposedOptions })

    filter.catch({ toString: (): string => 'weird throwable' }, host)

    expect(captured.body?.details).toEqual({ message: 'weird throwable' })
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
