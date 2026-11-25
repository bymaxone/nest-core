/**
 * Unit tests for what is kept of an answer and how it is put back.
 *
 * Layer: unit.
 * Goal: only a replayable answer is stored with its body, only a stable client error is kept, and the
 * replay sets its headers on either response API.
 * Mocks: plain reply objects.
 */
import { Readable } from 'node:stream'

import { BadRequestException, HttpException, StreamableFile } from '@nestjs/common'

import { captureClientError, captureResult, replay, setReplyHeader } from './idempotency.response'

const ignore = (): void => undefined

const reply = (headers: Record<string, unknown> = {}): { getHeader(name: string): unknown } => ({
  getHeader: (name) => headers[name]
})

describe('captureResult', () => {
  it('stores the JSON and the kept headers', () => {
    expect(captureResult(201, { a: 1 }, reply({ location: '/x', etag: 'e' }), 100, ignore)).toEqual(
      {
        status: 201,
        headers: { location: '/x' },
        body: '{"a":1}'
      }
    )
  })

  it('stores an empty answer as an empty body', () => {
    expect(captureResult(204, undefined, {}, 100, ignore)).toEqual({
      status: 204,
      headers: {},
      body: ''
    })
  })

  it.each([
    ['over the bound', { text: 'x'.repeat(50) }, {}],
    ['a Buffer', Buffer.from('x'), {}],
    ['a typed array', new Uint8Array(1), {}],
    ['a StreamableFile', new StreamableFile(Buffer.from('x')), {}],
    ['a stream', Readable.from(['x']), {}],
    ['a Date, which would replay as text', new Date(0), {}],
    ['an object whose toJSON is undefined', { toJSON: () => undefined }, {}],
    ['with headers over the bound', { a: 1 }, { location: 'x'.repeat(70_000) }]
  ])('stores no body for an answer %s', (_name, value, headers) => {
    expect(captureResult(200, value, reply(headers), 10, ignore)).toEqual({
      status: 200,
      headers: {}
    })
  })
})

describe('captureResult, the status and what does not serialise', () => {
  it('keeps the status the handler set on the response, and the default without one', () => {
    expect(captureResult(201, { a: 1 }, { statusCode: 202 }, 100, ignore).status).toBe(202)
    expect(captureResult(201, { a: 1 }, {}, 100, ignore).status).toBe(201)
  })

  it('stores no body for a status of 400 or more set through the response', () => {
    expect(captureResult(201, { a: 1 }, { statusCode: 500 }, 100, ignore)).toEqual({
      status: 500,
      headers: {}
    })
  })

  it.each([
    ['a BigInt', { n: BigInt(1) }],
    [
      'a throwing toJSON',
      {
        toJSON: (): never => {
          throw new Error('no json')
        }
      }
    ]
  ])('stores no body for %s and says why', (_name, value) => {
    const failed: unknown[] = []

    expect(captureResult(200, value, {}, 100, (cause) => failed.push(cause))).toEqual({
      status: 200,
      headers: {}
    })
    expect(failed).toHaveLength(1)
  })

  it('stores a string and a number as their JSON', () => {
    expect(captureResult(200, 'a"b', {}, 100, ignore).body).toBe('"a\\"b"')
    expect(captureResult(200, 5, {}, 100, ignore).body).toBe('5')
  })

  it('keeps no body for a client error whose response does not serialise', () => {
    const response: Record<string, unknown> = {}
    response['self'] = response
    const failed: unknown[] = []

    expect(
      captureClientError(new BadRequestException(response), 100, (cause) => failed.push(cause))
    ).toEqual({ status: 400, headers: {} })
    expect(failed).toHaveLength(1)
  })
})

describe('captureClientError', () => {
  it('keeps a 4xx HttpException with its response', () => {
    expect(captureClientError(new BadRequestException({ code: 'X' }), 100, ignore)).toEqual({
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
    expect(captureClientError(error, 100, ignore)).toBeUndefined()
  })

  it('keeps no body for an error response over the bound', () => {
    expect(captureClientError(new BadRequestException('x'.repeat(50)), 10, ignore)).toEqual({
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

  it('sets the stored status of a success on the response, and none for an error', () => {
    const codes: number[] = []
    replay({ status: 202, headers: {}, body: '' }, '', { status: (code) => codes.push(code) })
    expect(() =>
      replay({ status: 409, headers: {}, body: '"x"' }, '"x"', {
        status: (code) => codes.push(code)
      })
    ).toThrow(HttpException)

    expect(codes).toEqual([202])
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
