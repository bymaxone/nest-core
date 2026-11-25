/**
 * Unit tests for a thrown value that is not an object in BymaxExceptionFilter.
 *
 * Layer: unit.
 * Goal: prove a thrown `undefined` collapses to the generic 500 envelope, because the probe for an
 * exposed client error has to refuse every non-object by its `typeof` before it reads `expose`.
 * Mocks: a hand-built ArgumentsHost and HttpAdapter that capture the reply.
 */
import type { ArgumentsHost } from '@nestjs/common'
import type { HttpAdapterHost } from '@nestjs/core'

import { normalizeCoreOptions } from '../core.options'

import { BymaxExceptionFilter } from './exception.filter'
import type { ErrorEnvelope } from './error-envelope'

/** Build a filter plus an HTTP host wired to capture the reply. */
function buildHarness(): {
  filter: BymaxExceptionFilter
  host: ArgumentsHost
  captured: { body?: ErrorEnvelope; status?: number }
} {
  const captured: { body?: ErrorEnvelope; status?: number } = {}
  const request = { url: '/invoices/inv_123', method: 'GET' }
  const adapterHost = {
    httpAdapter: {
      getRequestUrl: (req: { url: string }): string => req.url,
      getRequestMethod: (req: { method: string }): string => req.method,
      reply: (_response: unknown, body: ErrorEnvelope, status: number): void => {
        captured.body = body
        captured.status = status
      }
    }
  } as unknown as HttpAdapterHost
  const host = {
    getType: (): string => 'http',
    switchToHttp: () => ({ getRequest: (): unknown => request, getResponse: (): unknown => ({}) })
  } as unknown as ArgumentsHost
  const filter = new BymaxExceptionFilter(
    normalizeCoreOptions(),
    { getCorrelationId: (): string | undefined => undefined },
    adapterHost
  )
  return { filter, host, captured }
}

describe('BymaxExceptionFilter, a thrown value that is not an object', () => {
  /**
   * A thrown `undefined` collapses without the exposed-error probe crashing on it.
   *
   * Unlike a string or a number, `undefined` has no properties to read, so a probe that only
   * excluded `null` would throw on `.expose` instead of answering.
   */
  it('collapses a thrown undefined to the generic 500', () => {
    const { filter, host, captured } = buildHarness()

    filter.catch(undefined, host)

    expect(captured.status).toBe(500)
    expect(captured.body?.code).toBe('BYMAX_INTERNAL_ERROR')
  })
})
