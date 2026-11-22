/**
 * Unit tests for the filter and a response that was answered before it ran.
 *
 * Layer: unit.
 * Goal: a response whose headers were already sent, or that has ended, on Express (the response itself)
 * or on Fastify (its `raw`), is not replied to a second time, so a late error cannot raise
 * `ERR_HTTP_HEADERS_SENT` or write a second body; an unanswered one still gets the envelope.
 * Mocks: a hand-built ArgumentsHost and HttpAdapter that record every `reply`.
 */
import { NotFoundException } from '@nestjs/common'
import type { ArgumentsHost } from '@nestjs/common'
import type { HttpAdapterHost } from '@nestjs/core'

import { normalizeCoreOptions } from '../core.options'
import { BymaxExceptionFilter } from './exception.filter'

/** How many times the adapter was asked to reply, for a filter run over `response`. */
function repliesFor(response: object): number {
  let replies = 0
  const httpAdapter = {
    getRequestUrl: (): string => '/items',
    getRequestMethod: (): string => 'GET',
    reply: (): void => {
      replies += 1
    }
  }
  const host = {
    getType: (): string => 'http',
    switchToHttp: () => ({ getRequest: (): unknown => ({}), getResponse: (): unknown => response })
  } as unknown as ArgumentsHost
  const filter = new BymaxExceptionFilter(normalizeCoreOptions(), undefined, {
    httpAdapter
  } as unknown as HttpAdapterHost)
  filter.catch(new NotFoundException('gone'), host)
  return replies
}

describe('BymaxExceptionFilter, a response that was already answered', () => {
  it.each([
    ['headers sent on the response', { headersSent: true }],
    ['ended on the response', { writableEnded: true }],
    ['headers sent on the raw response', { raw: { headersSent: true } }],
    ['ended on the raw response', { raw: { writableEnded: true } }],
    ['headers sent on the response beside a clean raw one', { headersSent: true, raw: {} }],
    ['ended on the response beside a clean raw one', { writableEnded: true, raw: {} }],
    [
      'headers sent on the raw response beside a clean one',
      { raw: { headersSent: true, writableEnded: false }, headersSent: false }
    ],
    [
      'ended on the raw response beside a clean one',
      { raw: { headersSent: false, writableEnded: true }, writableEnded: false }
    ]
  ])('does not reply when it is %s', (_name, response) => {
    expect(repliesFor(response)).toBe(0)
  })

  it('replies once when the response was not answered', () => {
    expect(
      repliesFor({ headersSent: false, raw: { headersSent: false, writableEnded: false } })
    ).toBe(1)
    expect(repliesFor({})).toBe(1)
  })
})
