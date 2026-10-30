/**
 * Unit tests for the request data a client error echoes in BymaxExceptionFilter.
 *
 * Layer: unit.
 * Goal: prove the router's own 404 message, `Cannot ${method} ${url}`, is answered with the
 * request path and never the query string or the authority of an absolute-form target, while a
 * message the application wrote, and any message that is not that exact string, is untouched.
 * Mocks: a hand-built ArgumentsHost and HttpAdapter that capture the reply for a chosen request.
 */
import { HttpException, NotFoundException } from '@nestjs/common'
import type { ArgumentsHost } from '@nestjs/common'
import type { HttpAdapterHost } from '@nestjs/core'

import { normalizeCoreOptions } from '../core.options'

import { BymaxExceptionFilter } from './exception.filter'
import type { ErrorEnvelope } from './error-envelope'

/** Build a filter plus an HTTP host wired to capture the reply for the given request. */
function buildHarness(
  method: string,
  url: string
): {
  filter: BymaxExceptionFilter
  host: ArgumentsHost
  captured: { body?: ErrorEnvelope }
} {
  const captured: { body?: ErrorEnvelope } = {}
  const request = { url, method }
  const adapterHost = {
    httpAdapter: {
      getRequestUrl: (req: { url: string }): string => req.url,
      getRequestMethod: (req: { method: string }): string => req.method,
      reply: (_response: unknown, body: ErrorEnvelope): void => {
        captured.body = body
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

describe('BymaxExceptionFilter, request data in a client error message', () => {
  /**
   * The router's 404 carries the path, not the query.
   *
   * Nest builds the message from the adapter's raw URL, query included, and a query string is
   * where reset codes and tokens travel; the envelope's `path` already drops it, so the message
   * must too.
   */
  it('answers the router 404 with the path and no query string', () => {
    const url = '/unknown-route?token=s3cr3t'
    const { filter, host, captured } = buildHarness('GET', url)

    filter.catch(new NotFoundException(`Cannot GET ${url}`), host)

    expect(captured.body).toMatchObject({
      statusCode: 404,
      code: 'BYMAX_NOT_FOUND',
      message: 'Cannot GET /unknown-route',
      path: '/unknown-route'
    })
    expect(JSON.stringify(captured.body)).not.toContain('s3cr3t')
  })

  /**
   * An absolute-form target loses its authority and credentials too.
   *
   * A proxy sends `GET http://user:pass@host/p?q`; the raw URL then carries the credentials, and
   * the message must read only the path, as `path` does.
   */
  it('drops the authority and the credentials of an absolute-form target', () => {
    const url = 'http://user:pw@example.com/nope?token=s3cr3t'
    const { filter, host, captured } = buildHarness('GET', url)

    filter.catch(new NotFoundException(`Cannot GET ${url}`), host)

    expect(captured.body?.message).toBe('Cannot GET /nope')
    expect(JSON.stringify(captured.body)).not.toContain('user:pw')
    expect(JSON.stringify(captured.body)).not.toContain('s3cr3t')
  })

  /**
   * The method is read from the request, so any verb works.
   *
   * A request with no matching route answers 404 for every method, and the message names the
   * method that was sent.
   */
  it('keeps the method in the rewritten message', () => {
    const url = '/nope?token=s3cr3t'
    const { filter, host, captured } = buildHarness('POST', url)

    filter.catch(new NotFoundException(`Cannot POST ${url}`), host)

    expect(captured.body?.message).toBe('Cannot POST /nope')
  })

  /**
   * A message with no query is already right.
   *
   * The rewrite changes nothing when the framework's message carries only the path.
   */
  it('leaves the router 404 alone when the URL has no query', () => {
    const { filter, host, captured } = buildHarness('GET', '/nope')

    filter.catch(new NotFoundException('Cannot GET /nope'), host)

    expect(captured.body?.message).toBe('Cannot GET /nope')
  })

  /**
   * The application's own 404 message is never touched.
   *
   * A NotFoundException the application throws carries text it chose for the caller, whatever the
   * request URL holds.
   */
  it('keeps the message of a NotFoundException the application threw', () => {
    const { filter, host, captured } = buildHarness('GET', '/missing?token=s3cr3t')

    filter.catch(new NotFoundException('Invoice inv_123 was not found'), host)

    expect(captured.body?.message).toBe('Invoice inv_123 was not found')
  })

  /**
   * Only the exact framework message is rewritten.
   *
   * A message that merely starts like the router's, for another URL, is the application's text and
   * stays as written.
   */
  it('keeps a message that only resembles the router message', () => {
    const { filter, host, captured } = buildHarness('GET', '/x?token=s3cr3t')

    filter.catch(new NotFoundException('Cannot GET /other?page=2'), host)

    expect(captured.body?.message).toBe('Cannot GET /other?page=2')
  })

  /**
   * A domain error's message is never rewritten.
   *
   * An exception that carries its own code keeps the message that belongs to that code, even when
   * the text equals the router's.
   */
  it('keeps the message of a domain error that carries its own code', () => {
    const url = '/x?token=s3cr3t'
    const { filter, host, captured } = buildHarness('GET', url)

    filter.catch(new HttpException({ code: 'CUSTOM_404', message: `Cannot GET ${url}` }, 404), host)

    expect(captured.body).toMatchObject({ code: 'CUSTOM_404', message: `Cannot GET ${url}` })
  })
})
