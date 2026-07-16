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

/** Build a filter plus an HTTP host wired to capture the reply. */
function buildHarness(params?: {
  options?: ResolvedCoreOptions
  correlation?: ICorrelationIdProvider
  contextType?: string
  url?: string
  method?: string
  filterCtor?: new (
    options: ResolvedCoreOptions,
    correlation: ICorrelationIdProvider,
    adapterHost: HttpAdapterHost
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
  const filter = new FilterCtor(
    params?.options ?? normalizeCoreOptions(),
    params?.correlation ?? stubCorrelation(),
    adapterHost
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
