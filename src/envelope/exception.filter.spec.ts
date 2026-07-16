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
}): { filter: BymaxExceptionFilter; host: ArgumentsHost; captured: Captured } {
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
  const filter = new BymaxExceptionFilter(
    params?.options ?? normalizeCoreOptions(),
    params?.correlation ?? stubCorrelation(),
    adapterHost
  )
  return { filter, host, captured }
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
   * A non-string message value falls back to the exception message.
   *
   * When `message` is present but not a string (for example an array), extraction
   * must fall back to `exception.message`, covering the non-string branch.
   */
  it('falls back to the exception message when the response message is not a string', () => {
    const { filter, host, captured } = buildHarness()

    filter.catch(new HttpException({ message: ['a', 'b'] }, 400), host)

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
})
