/**
 * Unit tests for the tap on a raw response and the replacement of a replay's write.
 *
 * Layer: unit.
 * Goal: a held answer reaches `settle` as it was written and is then sent unchanged, what is too large or
 * streamed is sent as written, an answer ended by something else is not sent twice, and a replay replaces
 * the first write that is not an error answer.
 * Mocks: a recording raw response.
 */
import { rawOf, substitute, tap } from './idempotency.wire'
import type { Wire, WireResponse } from './idempotency.wire'

type Recorder = {
  -readonly [K in keyof WireResponse]: WireResponse[K]
} & { sent: unknown[][] }

/** A raw response that records the writes that reach it. */
function recorder(headers: Record<string, unknown> = {}): Recorder {
  const sent: unknown[][] = []
  const raw = {
    statusCode: 200,
    headersSent: false,
    writableEnded: false,
    sent,
    destroy: jest.fn(),
    getHeaders: () => headers,
    removeHeader: (name: string) => {
      delete headers[name]
    },
    writeHead(status: number, ...rest: unknown[]) {
      sent.push(['head', status, ...rest])
      raw.headersSent = true
    },
    write(chunk: unknown) {
      sent.push(['write', chunk])
      return true
    },
    end(chunk?: unknown) {
      sent.push(['end', chunk])
      raw.writableEnded = true
    }
  }
  return raw as Recorder
}

const settled = (): { settle: jest.Mock<Promise<void>, [Wire]>; wire: () => Wire } => {
  const settle = jest.fn<Promise<void>, [Wire]>(async () => undefined)
  return { settle, wire: () => settle.mock.calls[0]![0] }
}

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

describe('rawOf', () => {
  it('reads the raw response of a Fastify reply and the response of Express', () => {
    const raw = recorder()

    expect(rawOf({ raw })).toBe(raw)
    expect(rawOf(raw)).toBe(raw)
  })
})

describe('tap', () => {
  it('holds what is written, tells settle, then sends it unchanged', async () => {
    const raw = recorder({ 'content-type': 'text/plain' })
    const { settle, wire } = settled()
    tap(raw, 100, false, settle)

    raw.writeHead(201, { ETag: 'x' })
    raw.write('aGk=', 'base64')
    raw.end('!')
    expect(raw.sent).toEqual([])
    await flush()

    expect(wire()).toEqual({
      status: 201,
      headers: { 'content-type': 'text/plain', etag: 'x' },
      body: 'hi!'
    })
    expect(raw.sent).toEqual([
      ['head', 201, { ETag: 'x', 'content-length': 3 }],
      ['write', Buffer.from('hi')],
      ['write', Buffer.from('!')],
      ['end', undefined]
    ])
  })

  it('reports no body for bytes that are not UTF-8, and sends them unchanged', async () => {
    const raw = recorder()
    const { settle, wire } = settled()
    tap(raw, 100, false, settle)

    raw.end(Buffer.from([0xff, 0xfe]))
    await flush()

    expect(wire().body).toBeUndefined()
    expect(raw.sent).toContainEqual(['write', Buffer.from([0xff, 0xfe])])
  })

  it('reports no body for an encoded answer', async () => {
    const raw = recorder({ 'content-encoding': 'gzip' })
    const { settle, wire } = settled()
    tap(raw, 100, false, settle)

    raw.end('x')
    await flush()

    expect(wire().body).toBeUndefined()
  })

  it('sends a body past the limit as it is written, and reports none', async () => {
    const raw = recorder()
    const { settle, wire } = settled()
    tap(raw, 3, false, settle)

    raw.writeHead(200)
    raw.write('abcd')
    raw.write('ef')
    raw.end()
    await flush()

    expect(wire().body).toBeUndefined()
    expect(raw.sent).toEqual([
      ['head', 200, {}],
      ['write', Buffer.from('abcd')],
      ['write', 'ef'],
      ['end', undefined]
    ])
  })

  it('sends a streamed answer as it is written and ends it', async () => {
    const raw = recorder()
    const { settle, wire } = settled()
    tap(raw, 100, true, settle)

    raw.writeHead(200, { a: 'b' })
    raw.write('x')
    raw.end('y')
    await flush()

    expect(wire().body).toBeUndefined()
    expect(raw.sent).toEqual([
      ['head', 200, { a: 'b' }],
      ['write', 'x'],
      ['write', Buffer.from('y')],
      ['end', undefined]
    ])
  })

  it('lets a second end through and does not send the held answer after it', async () => {
    const raw = recorder()
    const { settle } = settled()
    tap(raw, 100, false, settle)

    raw.end('held')
    raw.writeHead(504, {})
    raw.end('deadline')
    await flush()

    expect(raw.sent).toEqual([
      ['head', 504, {}],
      ['end', 'deadline']
    ])
  })

  it('destroys the response when sending the held answer throws', async () => {
    const raw = recorder()
    const { settle } = settled()
    tap(raw, 100, false, settle)
    jest.spyOn(raw, 'write').mockImplementation(() => {
      throw new Error('socket')
    })
    tap(raw, 100, false, settle)

    raw.end('x')
    await flush()

    expect(raw.destroy).toHaveBeenCalledTimes(1)
  })

  it('writes through once the answer is released', async () => {
    const raw = recorder()
    const { settle } = settled()
    tap(raw, 1, false, settle)

    raw.write('ab')
    raw.write('cd')
    raw.end()
    await flush()

    expect(raw.sent.filter(([kind]) => kind === 'write')).toHaveLength(2)
  })
})

describe('substitute', () => {
  const stored = { 'content-type': 'application/json' }

  it('replaces the write that carries the stored status and sets the length of the stored bytes', () => {
    const raw = recorder({ etag: 'new', 'content-length': '99' })
    substitute(raw, 201, stored, '{"a":1}')

    raw.writeHead(201, { 'X-Own': '1', 'Content-Length': 5 })
    raw.write('ignored')
    raw.end('ignored')

    expect(raw.sent).toEqual([
      ['head', 201, { 'X-Own': '1', 'content-type': 'application/json', 'content-length': 7 }],
      ['end', Buffer.from('{"a":1}')]
    ])
  })

  it('replaces a write that carries the status the route had before the handler', () => {
    const raw = recorder()
    raw.statusCode = 201
    substitute(raw, 400, stored, 'x')

    raw.end()

    expect(raw.sent[0]).toEqual([
      'head',
      400,
      { 'content-type': 'application/json', 'content-length': 1 }
    ])
  })

  it('replaces a write at the client-error status the route already had, and sends another error as it is', () => {
    const replaced = recorder()
    replaced.statusCode = 400
    substitute(replaced, 400, stored, 'x')
    replaced.end()
    const other = recorder()
    other.statusCode = 400
    substitute(other, 400, stored, 'x')
    other.writeHead(403, {})
    other.end('err')

    expect(replaced.sent[0]).toEqual([
      'head',
      400,
      { 'content-type': 'application/json', 'content-length': 1 }
    ])
    expect(other.sent).toEqual([
      ['head', 403, {}],
      ['end', 'err']
    ])
  })

  it('sends any other first write as it is, and every later one too', () => {
    const raw = recorder()
    substitute(raw, 201, stored, 'x')

    raw.writeHead(403, {})
    raw.write('err')
    raw.end('err')

    expect(raw.sent).toEqual([
      ['head', 403, {}],
      ['write', 'err'],
      ['end', 'err']
    ])
  })

  it('does not send the stored answer over one that has ended', () => {
    const raw = recorder()
    substitute(raw, 200, stored, 'x')
    raw.writableEnded = true

    raw.end()

    expect(raw.sent).toEqual([])
  })

  it('sends the stored answer when the write has no header call of its own', () => {
    const raw = recorder()
    substitute(raw, 200, stored, 'x')

    raw.write('first')
    raw.end()

    expect(raw.sent).toEqual([
      ['head', 200, { 'content-type': 'application/json', 'content-length': 1 }],
      ['end', Buffer.from('x')]
    ])
  })
})

describe('tap, every signature of the writers', () => {
  it('keeps the reason phrase and the headers of writeHead(status, reason, headers)', async () => {
    const raw = recorder()
    const { settle, wire } = settled()
    tap(raw, 100, false, settle)

    raw.writeHead(201, 'Made', { Location: '/x' })
    raw.end('{}')
    await flush()

    expect(wire().headers).toEqual({ location: '/x' })
    expect(raw.sent[0]).toEqual(['head', 201, 'Made', { Location: '/x', 'content-length': 2 }])
  })

  it('reads the headers of a flat list and of a list of pairs, joining a repeated name', async () => {
    const flat = recorder()
    const pairs = recorder()
    const first = settled()
    const second = settled()
    tap(flat, 100, false, first.settle)
    tap(pairs, 100, false, second.settle)

    flat.writeHead(200, ['Location', '/a', 'X-Own', '1', 'Set-Cookie', 'a=1', 'set-cookie', 'b=2'])
    pairs.writeHead(200, [['ETag', 'e']])
    flat.end()
    pairs.end()
    await flush()

    expect(first.wire().headers).toEqual({
      location: '/a',
      'x-own': '1',
      'set-cookie': ['a=1', 'b=2']
    })
    expect(second.wire().headers).toEqual({ etag: 'e' })
  })

  it('answers the callback of a held write and passes the one of end to the real end', async () => {
    const raw = recorder()
    const realEnd = jest.spyOn(raw, 'end')
    const { settle } = settled()
    tap(raw, 100, false, settle)
    const written = jest.fn()
    const ended = jest.fn()

    raw.write('a', 'utf8', written)
    raw.write('b', written)
    raw.end('c', ended)
    await flush()

    expect(written).toHaveBeenCalledTimes(2)
    expect(realEnd).toHaveBeenLastCalledWith(ended)
  })

  it('takes a callback given in place of the chunk as the end callback', async () => {
    const raw = recorder()
    const realEnd = jest.spyOn(raw, 'end')
    const { settle, wire } = settled()
    tap(raw, 100, false, settle)
    const ended = jest.fn()

    raw.end(ended)
    await flush()

    expect(wire().body).toBe('')
    expect(realEnd).toHaveBeenLastCalledWith(ended)
  })

  it('leaves the head alone for a held body with a length, a chunked one and none', async () => {
    const sized = recorder({ 'content-length': '5' })
    const chunked = recorder({ 'transfer-encoding': 'chunked' })
    const empty = recorder()
    for (const raw of [sized, chunked, empty]) tap(raw, 100, false, settled().settle)

    for (const raw of [sized, chunked]) raw.writeHead(200, {})
    empty.writeHead(204, {})
    for (const raw of [sized, chunked, empty]) raw.end(raw === empty ? undefined : 'hello')
    await flush()

    expect(sized.sent[0]).toEqual(['head', 200, {}])
    expect(chunked.sent[0]).toEqual(['head', 200, {}])
    expect(empty.sent[0]).toEqual(['head', 204, {}])
  })
})

describe('substitute, every write and signature', () => {
  const stored = { 'content-type': 'application/json' }

  it('replaces a first write below 400 whatever its status, and the writes after it', () => {
    const raw = recorder()
    substitute(raw, 201, { location: '/real' }, '{"a":1}')

    raw.writeHead(302, { Location: '/default' })
    raw.write('x')
    raw.end('y')

    expect(raw.sent).toEqual([
      ['head', 201, { location: '/real', 'content-length': 7 }],
      ['end', Buffer.from('{"a":1}')]
    ])
  })

  it('sends a first write at 400 or above as it is', () => {
    const raw = recorder()
    substitute(raw, 201, stored, 'x')

    raw.writeHead(400, 'Bad', { a: 'b' })
    raw.end('err')

    expect(raw.sent).toEqual([
      ['head', 400, 'Bad', { a: 'b' }],
      ['end', 'err']
    ])
  })

  it('keeps the headers of writeHead(status, reason, headers) and forwards the end callback', () => {
    const raw = recorder()
    const realEnd = jest.spyOn(raw, 'end')
    substitute(raw, 200, stored, 'x')
    const written = jest.fn()
    const ended = jest.fn()

    raw.writeHead(200, 'OK', ['X-Own', '1'])
    raw.write('a', written)
    raw.end(ended)

    expect(raw.sent[0]).toEqual([
      'head',
      200,
      { 'x-own': '1', 'content-type': 'application/json', 'content-length': 1 }
    ])
    expect(written).toHaveBeenCalledTimes(0)
    expect(realEnd).toHaveBeenLastCalledWith(Buffer.from('x'), ended)
  })

  it('answers the write callback of a replaced write on the next tick', async () => {
    const raw = recorder()
    substitute(raw, 200, stored, 'x')
    const written = jest.fn()

    raw.write('a', 'utf8', written)
    await new Promise((resolve) => process.nextTick(resolve))

    expect(written).toHaveBeenCalledTimes(1)
  })

  it('sends a 204 without a length', () => {
    const raw = recorder()
    substitute(raw, 204, {}, '')

    raw.end()

    expect(raw.sent[0]).toEqual(['head', 204, {}])
  })
})

describe('tap and substitute, the boundaries', () => {
  it('reads a null head as no headers', async () => {
    const raw = recorder()
    const { settle, wire } = settled()
    tap(raw, 100, false, settle)

    raw.writeHead(200, null)
    raw.end('x')
    await flush()

    expect(wire()).toEqual({ status: 200, headers: {}, body: 'x' })
  })

  it('holds a body of exactly the limit', async () => {
    const raw = recorder()
    const { settle, wire } = settled()
    tap(raw, 3, false, settle)

    raw.end('abc')
    await flush()

    expect(wire().body).toBe('abc')
  })

  it('sends nothing of a held answer when the head is already out and the response is not ended', async () => {
    const raw = recorder()
    const { settle } = settled()
    tap(raw, 100, false, settle)
    raw.headersSent = true

    raw.end('x')
    await flush()

    expect(raw.sent).toEqual([])
  })

  it('does not end a streamed answer that something else has ended', async () => {
    const raw = recorder()
    const { settle } = settled()
    tap(raw, 100, true, settle)
    raw.writableEnded = true

    raw.end()
    await flush()

    expect(raw.sent).toEqual([])
  })

  it('writes a chunk given after end straight through, before the answer is released', () => {
    const raw = recorder()
    const { settle } = settled()
    tap(raw, 100, false, settle)

    raw.end('a')
    raw.write('b')

    expect(raw.sent).toEqual([['write', 'b']])
  })

  it.each(['content-length', 'content-type', 'content-encoding', 'etag', 'transfer-encoding'])(
    'drops %s of the route, set or passed, when the stored body is sent',
    (name) => {
      const raw = recorder({ [name]: 'route', 'x-keep': '1' })
      substitute(raw, 200, {}, 'x')

      raw.writeHead(200, { [name.toUpperCase()]: 'route', 'X-Own': '1' })
      raw.end()

      expect(raw.getHeaders()).toEqual({ 'x-keep': '1' })
      expect(raw.sent[0]).toEqual(['head', 200, { 'X-Own': '1', 'content-length': 1 }])
    }
  )
})

describe('tap and substitute, the return values and the arguments they pass on', () => {
  it('reads a flat header list whose value is a list', async () => {
    const raw = recorder()
    const { settle, wire } = settled()
    tap(raw, 100, false, settle)

    raw.writeHead(200, ['Set-Cookie', ['a=1', 'b=2']])
    raw.end('x')
    await flush()

    expect(wire().headers).toEqual({ 'set-cookie': ['a=1', 'b=2'] })
  })

  it('sets the length of a one-byte body, with or without a head of its own', async () => {
    const implicit = recorder()
    const explicit = recorder()
    for (const raw of [implicit, explicit]) tap(raw, 100, false, settled().settle)

    explicit.writeHead(200, {})
    implicit.end('x')
    explicit.end('x')
    await flush()

    expect(implicit.sent[0]).toEqual(['head', 200, { 'content-length': 1 }])
    expect(explicit.sent[0]).toEqual(['head', 200, { 'content-length': 1 }])
  })

  it('answers true to a held write, and to a replaced one', () => {
    const held = recorder()
    const replaced = recorder()
    tap(held, 100, false, settled().settle)
    substitute(replaced, 200, {}, 'x')

    expect(held.write('a')).toBe(true)
    expect(replaced.write('a')).toBe(true)
  })

  it('replaces a first write at 399, the last status below 400', () => {
    const raw = recorder()
    substitute(raw, 201, {}, 'x')

    raw.writeHead(399, {})
    raw.end('route')

    expect(raw.sent).toEqual([
      ['head', 201, { 'content-length': 1 }],
      ['end', Buffer.from('x')]
    ])
  })

  it('passes the encoding and the callback of an error answer to the write', () => {
    const raw = recorder()
    const write = jest.spyOn(raw, 'write')
    substitute(raw, 200, {}, 'x')
    const done = jest.fn()

    raw.writeHead(500, {})
    raw.write('a', 'latin1', done)

    expect(write).toHaveBeenCalledWith('a', 'latin1', done)
  })
})
