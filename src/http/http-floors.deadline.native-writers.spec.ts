/**
 * Tests for the response writers called after the request deadline answered, with its `end` finished at once
 * or later by a host wrapper.
 *
 * Layer: integration.
 * Goal: a late call from a handler throws nothing and adds nothing to the answer, and a host that defers `end`
 * still delivers the `504` envelope.
 * Mocks: none; a real `node:http` server with the deadline middleware in front of a late handler.
 */
import { createServer, OutgoingMessage, request as send, ServerResponse } from 'node:http'
import type { IncomingHttpHeaders, Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { requestDeadline } from './http-floors.deadline'

/** The late calls under test, each with the arguments a handler would pass. */
const CALLS: ReadonlyArray<readonly [string, (response: ServerResponse) => unknown]> = [
  ['writeHead', (response) => response.writeHead(200, { 'x-late': '1' })],
  [
    'writeHead with the status already set',
    (response) => response.writeHead(504, { 'x-late': '1' })
  ],
  ['removeHeader', (response) => response.removeHeader('x-late')],
  ['writeContinue', (response) => response.writeContinue()],
  ['writeEarlyHints', (response) => response.writeEarlyHints({ link: '</a.css>; rel=preload' })],
  ['writeProcessing', (response) => response.writeProcessing()],
  [
    'writeInformation',
    (response) => response.writeInformation(103, { link: '</a.css>; rel=preload' })
  ],
  [
    'writeHeader',
    (response) => (response as unknown as { writeHeader(status: number): void }).writeHeader(200)
  ],
  ['appendHeader', (response) => response.appendHeader('x-late', '1')],
  ['setHeaders', (response) => response.setHeaders(new Headers({ 'x-late': '1' }))],
  ['writeHead with a reason phrase', (response) => response.writeHead(504, 'Late')],
  ['setHeader', (response) => response.setHeader('x-late', '1')],
  ['write', (response) => response.write('late')],
  ['end', (response) => response.end('late')]
]

/** A method called by name. */
type Fn = (...args: unknown[]) => unknown

/** Functions of the response prototypes that write nothing to the answer, or are not callable late with data. */
const NOT_WRITERS = new Set([
  'constructor',
  'destroy',
  'setTimeout',
  'cork',
  'uncork',
  'pipe',
  'assignSocket',
  'detachSocket',
  'getHeader',
  'getHeaderNames',
  'getHeaders',
  'getRawHeaderNames',
  'hasHeader'
])

/** Arguments the walk passes where a name is not `('x-late', '1')`. */
const ARGUMENTS: Record<string, unknown[]> = {
  writeHead: [504],
  writeHeader: [504],
  writeInformation: [103, { link: '</a.css>; rel=preload' }],
  writeContinue: [],
  writeProcessing: [],
  writeEarlyHints: [{ link: '</a.css>; rel=preload' }],
  setHeaders: [new Headers({ 'x-late': '1' })],
  write: ['late'],
  end: ['late'],
  removeHeader: ['x-late'],
  addTrailers: [{ 'x-late': '1' }],
  flushHeaders: []
}

/** The exact answer of the deadline for the path `/late`. */
const ENVELOPE =
  /^\{"statusCode":504,"code":"BYMAX_GATEWAY_TIMEOUT","message":"The request took too long to answer","timestamp":"\d{4}-\d\d-\d\dT[\d:.]+Z","path":"\/late"\}$/

/** What a late handler saw. */
interface Late {
  thrown?: unknown
}

/** Whether a host wrapper defers `end` past the late call, and the late call. */
interface Setup {
  readonly deferEnd: boolean
  readonly call: (response: ServerResponse) => unknown
}

/** What a client read. */
interface Answer {
  readonly status: number
  readonly reason: string
  readonly headers: IncomingHttpHeaders
  readonly body: string
  /** The status codes of the interim responses that came before the final one. */
  readonly interim: number[]
}

/** Start a server whose handler calls `setup.call` once the deadline has answered, before or after the flush. */
function serve(setup: Setup, late: Late): Promise<Server> {
  const middleware = requestDeadline({ timeoutMs: 30, excludePaths: [] })
  const server = createServer((req, res) => {
    if (setup.deferEnd) {
      const end = res.end.bind(res) as (body?: string) => ServerResponse
      res.end = ((body?: string) => {
        setTimeout(() => end(body), 100)
        return res
      }) as typeof res.end
    }
    middleware({ url: req.url ?? '/' }, res, () => {
      setTimeout(
        () => {
          try {
            setup.call(res)
          } catch (error) {
            late.thrown = error
          }
        },
        setup.deferEnd ? 80 : 120
      )
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

/** The status, headers and body of a GET, read to the end of the answer. */
function get(server: Server): Promise<Answer> {
  const { port } = server.address() as AddressInfo
  return new Promise((resolve, reject) => {
    const interim: number[] = []
    send({ host: '127.0.0.1', port, path: '/late', agent: false }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => (body += chunk))
      res.on('end', () =>
        resolve({
          status: res.statusCode as number,
          reason: res.statusMessage ?? '',
          headers: res.headers,
          body,
          interim
        })
      )
    })
      .on('information', (info) => interim.push(info.statusCode))
      .on('error', reject)
      .end()
  })
}

/** Resolves after `ms` milliseconds. */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Run one request against a server built from `setup`, then close it. */
async function exchange(setup: Setup): Promise<{ answer: Answer; late: Late }> {
  const late: Late = {}
  const server = await serve(setup, late)
  try {
    const answer = await get(server)
    await sleep(200)
    return { answer, late }
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}

describe('the request deadline and the writers called after its answer', () => {
  it.each(CALLS)(
    '%s after the 504 was sent throws nothing and adds nothing to it',
    async (_name, call) => {
      const { answer, late } = await exchange({ deferEnd: false, call })

      expect(late.thrown).toBeUndefined()
      expect(answer.status).toBe(504)
      expect(answer.reason).toBe('Gateway Timeout')
      expect(answer.headers['x-late']).toBeUndefined()
      expect(answer.body).toMatch(ENVELOPE)
    }
  )

  it('delivers the 504 envelope when a host wrapper finishes `end` later', async () => {
    const { answer, late } = await exchange({ deferEnd: true, call: () => undefined })

    expect(late.thrown).toBeUndefined()
    expect(answer.status).toBe(504)
    expect(answer.headers['content-type']).toBe('application/json; charset=utf-8')
    expect(answer.body).toMatch(ENVELOPE)
  })

  it.each(CALLS)(
    '%s before a deferred end is flushed leaves the client the 504 envelope, byte for byte, and no interim response',
    async (_name, call) => {
      const { answer, late } = await exchange({ deferEnd: true, call })

      expect(late.thrown).toBeUndefined()
      expect(answer.status).toBe(504)
      expect(answer.reason).toBe('Gateway Timeout')
      expect(answer.headers['x-late']).toBeUndefined()
      expect(answer.body).toMatch(ENVELOPE)
      expect(answer.interim).toEqual([])
    }
  )

  it('leaves no function of the running Node response prototypes throwing ERR_HTTP_HEADERS_SENT late', async () => {
    const calls: Array<(response: ServerResponse) => unknown> = []
    const seen = new Set<string>()
    for (const prototype of [ServerResponse.prototype, OutgoingMessage.prototype]) {
      for (const name of Object.getOwnPropertyNames(prototype)) {
        const descriptor = Object.getOwnPropertyDescriptor(prototype, name)
        if (typeof descriptor?.value !== 'function' || seen.has(name)) continue
        seen.add(name)
        if (name.startsWith('_') || NOT_WRITERS.has(name)) continue
        const args = ARGUMENTS[name] ?? ['x-late', '1']
        calls.push((response) => (response as unknown as Record<string, Fn>)[name]?.(...args))
      }
    }
    const thrown: string[] = []
    const { late } = await exchange({
      deferEnd: false,
      call: (response) => {
        for (const [index, call] of calls.entries()) {
          try {
            call(response)
          } catch (error) {
            if ((error as { code?: string }).code === 'ERR_HTTP_HEADERS_SENT') {
              thrown.push(String(index))
            }
          }
        }
      }
    })

    expect(late.thrown).toBeUndefined()
    expect(calls.length).toBeGreaterThanOrEqual(12)
    expect(thrown).toEqual([])
  })
})
