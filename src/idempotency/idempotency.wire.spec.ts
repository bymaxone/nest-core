/**
 * Unit tests for the tap on a raw response and the replacement of a replay's write.
 *
 * Layer: unit.
 * Goal: a held answer reaches `settle` as it was written and is then sent unchanged, what is too large or
 * streamed is sent as written, an answer ended by something else is not sent twice, and a replay replaces
 * only the write that carries its status.
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
    writeHead(status: number, passed?: unknown) {
      sent.push(['head', status, passed])
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
      ['head', 201, { ETag: 'x' }],
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

  it('sends a streamed answer as it is written and ends it after settle', async () => {
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

  it('lets a second end through at once and does not send the held answer after it', async () => {
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
