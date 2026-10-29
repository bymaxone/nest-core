/**
 * Unit tests for the `details` of a server error in BymaxExceptionFilter.
 *
 * Layer: unit.
 * Goal: prove an `HttpException` with a status of 500 or above answers without its `details`
 * unless `envelope.exposeInternals` is on, in both response shapes and on the validation shape,
 * while a 4xx keeps them and the `message` of a 5xx is untouched.
 * Mocks: a hand-built ArgumentsHost and HttpAdapter that capture the reply.
 */
import { BadRequestException, HttpException } from '@nestjs/common'
import type { ArgumentsHost } from '@nestjs/common'
import type { HttpAdapterHost } from '@nestjs/core'

import { normalizeCoreOptions } from '../core.options'
import type { ResolvedCoreOptions } from '../core.options'

import { BymaxExceptionFilter } from './exception.filter'
import type { ErrorEnvelope } from './error-envelope'

/** Build a filter plus an HTTP host wired to capture the reply. */
function buildHarness(options: ResolvedCoreOptions = normalizeCoreOptions()): {
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
    options,
    { getCorrelationId: (): string | undefined => undefined },
    adapterHost
  )
  return { filter, host, captured }
}

describe('BymaxExceptionFilter, details on a server error', () => {
  /** Options with the development-only internals switch turned on. */
  const exposedOptions = normalizeCoreOptions({ envelope: { exposeInternals: true } })
  /** A payload fragment of the kind a library puts in `details` and a client must not see. */
  const leaky = { preview: 'SECRET-PAYLOAD-0123456789' }

  /**
   * A server error's details never reach the client by default.
   *
   * A library that throws an HttpException with a 5xx status and a flat `details` object (a cache
   * preview, a query fragment) must not have it serialized: the domain `code` and `message`
   * survive, the free-form blob does not.
   */
  it('omits flat details from a 5xx envelope when internals are hidden', () => {
    const { filter, host, captured } = buildHarness()

    filter.catch(
      new HttpException({ code: 'CACHE_FAILED', message: 'cache failed', details: leaky }, 500),
      host
    )

    expect(captured.status).toBe(500)
    expect(captured.body).toMatchObject({ code: 'CACHE_FAILED', message: 'cache failed' })
    expect(captured.body).not.toHaveProperty('details')
    expect(JSON.stringify(captured.body)).not.toContain('SECRET-PAYLOAD')
  })

  /**
   * The nested shape is covered by the same rule.
   *
   * `{ error: { code, message, details } }` is what `@bymax-one/nest-auth` and the cache library
   * build, and it reaches the same envelope builder, so it must be cut exactly like the flat one.
   */
  it('omits nested details from a 5xx envelope when internals are hidden', () => {
    const { filter, host, captured } = buildHarness()

    filter.catch(
      new HttpException(
        { error: { code: 'CACHE_FAILED', message: 'cache failed', details: leaky } },
        503
      ),
      host
    )

    expect(captured.status).toBe(503)
    expect(captured.body).toMatchObject({ code: 'CACHE_FAILED', message: 'cache failed' })
    expect(captured.body).not.toHaveProperty('details')
    expect(JSON.stringify(captured.body)).not.toContain('SECRET-PAYLOAD')
  })

  /**
   * The development switch keeps them.
   *
   * `exposeInternals` is the one documented opt-in for internals in the body, so a developer who
   * turned it on sees a 5xx's details in both shapes.
   */
  it('keeps flat and nested details on a 5xx when exposeInternals is on', () => {
    const flat = buildHarness(exposedOptions)
    const nested = buildHarness(exposedOptions)

    flat.filter.catch(
      new HttpException({ code: 'X', message: 'm', details: leaky }, 500),
      flat.host
    )
    nested.filter.catch(
      new HttpException({ error: { code: 'X', message: 'm', details: leaky } }, 502),
      nested.host
    )

    expect(flat.captured.body?.details).toEqual(leaky)
    expect(nested.captured.body?.details).toEqual(leaky)
  })

  /**
   * Client errors are untouched: their details are the contract.
   *
   * A 4xx carries validation and quota details the caller needs to correct the request, in both
   * shapes, so the rule must not reach them. 499 is the last status below the boundary.
   */
  it('keeps flat and nested details on a 4xx, including the status just below 500', () => {
    const flat = buildHarness()
    const nested = buildHarness()

    flat.filter.catch(
      new HttpException({ code: 'X', message: 'm', details: leaky }, 499),
      flat.host
    )
    nested.filter.catch(
      new BadRequestException({ error: { code: 'X', message: 'm', details: leaky } }),
      nested.host
    )

    expect(flat.captured.body?.details).toEqual(leaky)
    expect(nested.captured.body?.details).toEqual(leaky)
  })

  /**
   * The boundary is exactly 500, and the whole 5xx range is covered.
   *
   * Pins the comparison at 500 rather than one either side: 500 itself is a server error, and the
   * top of the range behaves the same.
   */
  it('drops details at exactly 500 and at 599', () => {
    for (const status of [500, 599]) {
      const { filter, host, captured } = buildHarness()

      filter.catch(new HttpException({ code: 'X', message: 'm', details: leaky }, status), host)

      expect(captured.status).toBe(status)
      expect(captured.body).not.toHaveProperty('details')
    }
  })

  /**
   * A validation-shaped 5xx is cut too.
   *
   * The validation branch builds `details` from the violations; a server error that happens to
   * carry that shape must not publish them either, because every path shares one builder.
   */
  it('omits validation-shaped details from a 5xx envelope', () => {
    const { filter, host, captured } = buildHarness()

    filter.catch(
      new HttpException(
        { message: ['SECRET-PAYLOAD must be valid'], error: 'Bad', statusCode: 500 },
        500
      ),
      host
    )

    expect(captured.body).toMatchObject({ statusCode: 500, code: 'BYMAX_VALIDATION_FAILED' })
    expect(captured.body).not.toHaveProperty('details')
  })

  /**
   * The message of a server error is the thrower's client-facing text and stays.
   *
   * A plain HttpException carries a message its author chose for the caller, as Nest's own
   * default does, so only the free-form `details` blob is withheld.
   */
  it('keeps the message of a 5xx HttpException', () => {
    const { filter, host, captured } = buildHarness()

    filter.catch(new HttpException('Upstream timed out', 504), host)

    expect(captured.body).toMatchObject({ statusCode: 504, message: 'Upstream timed out' })
    expect(captured.body).not.toHaveProperty('details')
  })
})
