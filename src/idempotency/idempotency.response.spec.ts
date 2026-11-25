/**
 * Unit tests for what is kept of an answer and how it is put back.
 *
 * Layer: unit.
 * Goal: only a replayable answer is stored with its body, only a stable client error is kept, and the
 * replay sets its headers on either response API.
 * Mocks: plain reply objects.
 */
import { BadRequestException, HttpException } from '@nestjs/common'

import { captureClientError, captureResult, replay, setReplyHeader } from './idempotency.response'

const reply = (headers: Record<string, unknown> = {}): { getHeader(name: string): unknown } => ({
  getHeader: (name) => headers[name]
})

describe('captureResult', () => {
  it('stores the JSON and the kept headers', () => {
    expect(captureResult(201, { a: 1 }, reply({ location: '/x', etag: 'e' }), 100)).toEqual({
      status: 201,
      headers: { location: '/x' },
      body: '{"a":1}'
    })
  })

  it('stores an empty answer as an empty body', () => {
    expect(captureResult(204, undefined, {}, 100)).toEqual({ status: 204, headers: {}, body: '' })
  })

  it.each([
    ['over the bound', { text: 'x'.repeat(50) }, {}],
    ['not JSON', Buffer.from('x'), {}],
    ['with headers over the bound', { a: 1 }, { location: 'x'.repeat(70_000) }]
  ])('stores no body for an answer %s', (_name, value, headers) => {
    expect(captureResult(200, value, reply(headers), 10)).toEqual({ status: 200, headers: {} })
  })
})

describe('captureClientError', () => {
  it('keeps a 4xx HttpException with its response', () => {
    expect(captureClientError(new BadRequestException({ code: 'X' }), 100)).toEqual({
      status: 400,
      headers: {},
      body: '{"code":"X"}'
    })
  })

  it.each([
    ['a server error', new HttpException('x', 500)],
    ['a 408', new HttpException('x', 408)],
    ['a 429', new HttpException('x', 429)],
    ['a redirect', new HttpException('x', 302)],
    ['a plain Error', new Error('x')]
  ])('keeps nothing for %s', (_name, error) => {
    expect(captureClientError(error, 100)).toBeUndefined()
  })

  it('keeps no body for an error response over the bound', () => {
    expect(captureClientError(new BadRequestException('x'.repeat(50)), 10)).toEqual({
      status: 400,
      headers: {}
    })
  })
})

describe('replay', () => {
  it('sets the kept headers and the marker on a header() reply', () => {
    const set: Array<[string, string]> = []
    const value = replay({ status: 201, headers: { location: '/x' }, body: '{"a":1}' }, '{"a":1}', {
      header: (name, v) => set.push([name, v])
    })

    expect(value).toEqual({ a: 1 })
    expect(set).toEqual([
      ['location', '/x'],
      ['Idempotent-Replayed', 'true']
    ])
  })

  it('falls back to setHeader and tolerates a reply with neither', () => {
    const set: string[] = []
    replay({ status: 200, headers: {}, body: '' }, '', { setHeader: (name) => set.push(name) })
    setReplyHeader({}, 'x', 'y')

    expect(set).toEqual(['Idempotent-Replayed'])
  })

  it('replays an empty body as undefined and a stored client error as an HttpException', () => {
    expect(replay({ status: 204, headers: {}, body: '' }, '', {})).toBeUndefined()
    expect(() =>
      replay({ status: 400, headers: {}, body: '{"code":"X"}' }, '{"code":"X"}', {})
    ).toThrow(HttpException)
  })
})
