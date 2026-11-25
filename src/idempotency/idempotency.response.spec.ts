/**
 * Unit tests for what is kept of an answer and how a replay sets its header.
 *
 * Layer: unit.
 * Goal: only a replayable answer is stored with its body, a server error or a transient client error gives
 * the claim back, a client error is kept only when the route keeps them, and a stream or bytes are never held.
 * Mocks: none.
 */
import { StreamableFile } from '@nestjs/common'
import { Readable } from 'node:stream'

import { setReplyHeader, storable, streamed } from './idempotency.response'

const answer = (
  status: number,
  body: string | null = '{}',
  headers: Record<string, unknown> = {}
) => ({
  status,
  headers,
  body: body ?? undefined
})

describe('storable', () => {
  it('keeps the status, the allow-listed headers and the body of a success', () => {
    const wire = answer(201, '{"a":1}', {
      'content-type': 'application/json',
      location: '/x',
      'content-location': '/y',
      etag: 'W/"1"',
      'set-cookie': 'a=1',
      'x-other': 'z',
      'content-length': 7
    })

    expect(storable(wire, true)).toEqual({
      status: 201,
      headers: {
        'content-type': 'application/json',
        location: '/x',
        'content-location': '/y',
        etag: 'W/"1"'
      },
      body: '{"a":1}'
    })
  })

  it.each([500, 503, 504, 408, 425, 429])('gives the claim back for %s', (status) => {
    expect(storable(answer(status), true)).toBeUndefined()
  })

  it('keeps a client error only when the route keeps them', () => {
    expect(storable(answer(400), true)).toEqual({ status: 400, headers: {}, body: '{}' })
    expect(storable(answer(400), false)).toBeUndefined()
  })

  it.each([
    ['has no body', answer(200, null)],
    ['is a 304', answer(304, '')]
  ])('keeps an answer that %s without one, so its replay is refused', (_name, wire) => {
    expect(storable(wire, true)).toEqual({ status: wire.status, headers: {} })
  })
})

describe('streamed', () => {
  it.each([
    ['a Buffer', Buffer.from('a')],
    ['an ArrayBuffer', new ArrayBuffer(1)],
    ['a StreamableFile', new StreamableFile(Buffer.from('a'))],
    ['a stream', Readable.from(['a'])]
  ])('is true for %s', (_name, value) => {
    expect(streamed(value)).toBe(true)
  })

  it.each([
    ['an object', { a: 1 }],
    ['a string', 'a'],
    ['null', null],
    ['undefined', undefined]
  ])('is false for %s', (_name, value) => {
    expect(streamed(value)).toBe(false)
  })
})

describe('setReplyHeader', () => {
  it('uses header on a Fastify reply and setHeader on an Express response', () => {
    const header = jest.fn()
    const setHeader = jest.fn()

    setReplyHeader({ header }, 'a', '1')
    setReplyHeader({ setHeader }, 'b', '2')
    setReplyHeader({}, 'c', '3')

    expect(header).toHaveBeenCalledWith('a', '1')
    expect(setHeader).toHaveBeenCalledWith('b', '2')
  })
})
