/**
 * Contract tests for the error envelope.
 *
 * Layer: unit (contract).
 * Goal: pin the EXACT serialized JSON of the envelope for every mapping rule,
 * so any field addition, rename, or value drift is caught as a breaking change.
 * The envelope is a versioned public contract: these assertions are the
 * regression fence around it.
 * Mocks: a hand-built ArgumentsHost and HttpAdapter; a fixed system clock via
 * fake timers so the timestamp is deterministic; a stub correlation provider.
 */
import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common'
import type { ArgumentsHost } from '@nestjs/common'
import type { HttpAdapterHost } from '@nestjs/core'

import { normalizeCoreOptions } from '../core.options'
import type { ResolvedCoreOptions } from '../core.options'
import type { ICorrelationIdProvider } from './correlation.interfaces'
import { BymaxExceptionFilter } from './exception.filter'
import type { ErrorEnvelope } from './error-envelope'

/** The frozen instant every contract assertion pins the timestamp to. */
const FIXED_ISO = '2026-07-06T12:00:00.000Z'

/** The request path every contract assertion pins. */
const FIXED_PATH = '/invoices/inv_123'

/** A stub correlation provider resolving the given id (default: none). */
function stubCorrelation(id?: string): ICorrelationIdProvider {
  return { getCorrelationId: (): string | undefined => id }
}

/** Run the filter against a mocked HTTP host and return the serialized reply body. */
function serializeCatch(
  exception: unknown,
  params?: { options?: ResolvedCoreOptions; correlation?: ICorrelationIdProvider }
): Record<string, unknown> {
  let body: ErrorEnvelope | undefined
  const request = { url: FIXED_PATH, method: 'GET' }
  const httpAdapter = {
    getRequestUrl: (req: { url: string }): string => req.url,
    getRequestMethod: (req: { method: string }): string => req.method,
    reply: (_response: unknown, replied: ErrorEnvelope): void => {
      body = replied
    }
  }
  const adapterHost = { httpAdapter } as unknown as HttpAdapterHost
  const host = {
    getType: (): string => 'http',
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
  filter.catch(exception, host)
  // Round-trip through JSON to assert the SERIALIZED shape, not the TS type:
  // any undefined-valued key would vanish here and any extra key would surface.
  return JSON.parse(JSON.stringify(body)) as Record<string, unknown>
}

describe('error envelope contract', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(FIXED_ISO))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  /**
   * Mapped HttpException, exact JSON.
   *
   * A NotFoundException must serialize to exactly these five fields with the
   * catalog code and no details or correlationId, pinning the mapped-exception
   * contract.
   */
  it('pins the JSON for a mapped HttpException', () => {
    const body = serializeCatch(new NotFoundException('Invoice inv_123 was not found'))

    expect(body).toEqual({
      statusCode: 404,
      code: 'BYMAX_NOT_FOUND',
      message: 'Invoice inv_123 was not found',
      timestamp: FIXED_ISO,
      path: FIXED_PATH
    })
  })

  /**
   * Validation error, exact JSON.
   *
   * A validation-shaped BadRequestException must serialize to
   * BYMAX_VALIDATION_FAILED with one structured details entry per violation,
   * pinning the validation contract.
   */
  it('pins the JSON for a validation error', () => {
    const body = serializeCatch(new BadRequestException(['email must be an email']))

    expect(body).toEqual({
      statusCode: 400,
      code: 'BYMAX_VALIDATION_FAILED',
      message: 'Validation failed',
      details: [{ issue: 'email must be an email' }],
      timestamp: FIXED_ISO,
      path: FIXED_PATH
    })
  })

  /**
   * Unknown error with internals hidden, exact JSON.
   *
   * A plain thrown Error must collapse to the generic 500 with no details and no
   * leak, pinning the production-safe contract.
   */
  it('pins the JSON for an unknown error with internals hidden', () => {
    const body = serializeCatch(new Error('secret db dsn'))

    expect(body).toEqual({
      statusCode: 500,
      code: 'BYMAX_INTERNAL_ERROR',
      message: 'Internal server error',
      timestamp: FIXED_ISO,
      path: FIXED_PATH
    })
  })

  /**
   * Unknown error with internals exposed, exact JSON.
   *
   * With exposeInternals on, a thrown non-Error must surface its stringified
   * form in details.message (no stack for a non-Error), pinning the development
   * internals contract deterministically.
   */
  it('pins the JSON for an unknown error with internals exposed', () => {
    const body = serializeCatch(
      { toString: (): string => 'boom' },
      { options: normalizeCoreOptions({ envelope: { exposeInternals: true } }) }
    )

    expect(body).toEqual({
      statusCode: 500,
      code: 'BYMAX_INTERNAL_ERROR',
      message: 'Internal server error',
      details: { message: 'boom' },
      timestamp: FIXED_ISO,
      path: FIXED_PATH
    })
  })

  /**
   * A bound correlation provider stamps the id.
   *
   * When the provider resolves an id, it must appear as `correlationId` in the
   * envelope, pinning the correlation contract; the no-op default (covered
   * above) omits the field entirely.
   */
  it('stamps correlationId from a bound provider', () => {
    const body = serializeCatch(new NotFoundException('missing'), {
      correlation: stubCorrelation('8f14e45f-ceea-4677-a9de-6ec3f1f0a1b2')
    })

    expect(body).toEqual({
      statusCode: 404,
      code: 'BYMAX_NOT_FOUND',
      message: 'missing',
      correlationId: '8f14e45f-ceea-4677-a9de-6ec3f1f0a1b2',
      timestamp: FIXED_ISO,
      path: FIXED_PATH
    })
  })
})
