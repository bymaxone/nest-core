/**
 * Unit tests for the request-deadline middleware against hand-built requests and responses.
 *
 * Layer: unit.
 * Goal: the middleware answers or closes by what the response has done at the deadline, matches the
 * excluded prefixes by the request's path, and clears its timer when the response ends.
 * Mocks: hand-built request and response objects; jest fake timers.
 */
import { DEADLINE_SIGNAL } from '../request-deadline-signal'
import { requestDeadline } from './http-floors.deadline'

/** A response that records what was done to it. */
function response(state: { headersSent?: boolean; writableEnded?: boolean } = {}): {
  headersSent: boolean
  writableEnded: boolean
  writableFinished: boolean
  statusCode: number
  body: string | undefined
  destroyed: boolean
  listeners: Record<string, () => void>
  setHeader: () => void
  removeHeader: () => void
  end: (body?: string) => void
  destroy: () => void
  once: (event: string, listener: () => void) => void
} {
  const held = {
    headersSent: state.headersSent ?? false,
    writableEnded: state.writableEnded ?? false,
    writableFinished: false,
    statusCode: 200,
    body: undefined as string | undefined,
    destroyed: false,
    listeners: {} as Record<string, () => void>,
    setHeader: (): void => undefined,
    removeHeader: (): void => undefined,
    end: (body?: string): void => {
      held.body = body
    },
    destroy: (): void => {
      held.destroyed = true
    },
    once: (event: string, listener: () => void): void => {
      held.listeners[event] = listener
    }
  }
  return held
}

describe('the request-deadline middleware', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it.each([
    ['headers already sent', { headersSent: true }],
    ['the answer already ended', { writableEnded: true }]
  ])('closes the connection, and writes nothing, when %s at the deadline', (_name, state) => {
    const answer = response(state)
    requestDeadline({ timeoutMs: 50, excludePaths: [] })({ url: '/a' }, answer, () => undefined)

    jest.advanceTimersByTime(60)

    expect(answer.destroyed).toBe(true)
    expect(answer.body).toBeUndefined()
  })

  it('writes the 504 envelope for an unanswered request, from its url when it has no original one', () => {
    const answer = response()
    requestDeadline({ timeoutMs: 50, excludePaths: [] })({ url: '/a?x=1' }, answer, () => undefined)

    jest.advanceTimersByTime(60)

    expect(answer.statusCode).toBe(504)
    expect(JSON.parse(answer.body as string)).toMatchObject({ statusCode: 504, path: '/a' })
  })

  it('writes an empty path when the request has none, and does not exclude it', () => {
    const answer = response()
    requestDeadline({ timeoutMs: 50, excludePaths: ['/'] })({}, answer, () => undefined)

    jest.advanceTimersByTime(60)

    expect(JSON.parse(answer.body as string)).toMatchObject({ path: '' })
  })

  it.each([
    ['the root', ['/'], '/anything'],
    ['a prefix', ['/events'], '/events'],
    ['under a prefix', ['/events'], '/events/stream?x=1']
  ])('leaves %s unbounded', (_name, excludePaths, url) => {
    const answer = response()
    const next = jest.fn()
    requestDeadline({ timeoutMs: 50, excludePaths })({ originalUrl: url }, answer, next)

    jest.advanceTimersByTime(60)

    expect(next).toHaveBeenCalledTimes(1)
    expect(answer.body).toBeUndefined()
  })

  it('does not exclude a path that only shares the characters of a prefix', () => {
    const answer = response()
    requestDeadline({ timeoutMs: 50, excludePaths: ['/events'] })(
      { originalUrl: '/events-old' },
      answer,
      () => undefined
    )

    jest.advanceTimersByTime(60)

    expect(answer.statusCode).toBe(504)
  })

  it.each(['close', 'finish'])('clears its timer when the response emits %s', (event) => {
    const answer = response()
    requestDeadline({ timeoutMs: 50, excludePaths: [] })({ url: '/a' }, answer, () => undefined)

    answer.listeners[event]?.()
    jest.advanceTimersByTime(60)

    expect(answer.body).toBeUndefined()
  })

  it('leaves every writer of the answered response a no-op that returns the response', () => {
    const names = [
      'send',
      'json',
      'jsonp',
      'sendStatus',
      'sendFile',
      'redirect',
      'render',
      'status',
      'set',
      'header',
      'type',
      'append',
      'cookie',
      'setHeader',
      'write',
      'end'
    ]
    const answer = response() as unknown as Record<string, unknown>
    for (const name of names.filter((writer) => writer !== 'setHeader' && writer !== 'end')) {
      answer[name] = (): never => {
        throw new Error('ERR_HTTP_HEADERS_SENT ' + name)
      }
    }
    requestDeadline({ timeoutMs: 50, excludePaths: [] })(
      { url: '/a' },
      answer as never,
      () => undefined
    )

    jest.advanceTimersByTime(60)

    for (const name of names) {
      const write = answer[name] as () => unknown
      expect(write()).toBe(answer)
      expect(Object.getOwnPropertyDescriptor(answer, name)).toMatchObject({
        configurable: true,
        writable: true
      })
    }
  })

  it('leaves the head writers of an answered response configurable and writable', () => {
    const answer = response() as unknown as Record<string, unknown>
    requestDeadline({ timeoutMs: 50, excludePaths: [] })(
      { url: '/a' },
      answer as never,
      () => undefined
    )

    jest.advanceTimersByTime(60)

    for (const name of ['writeHead', 'removeHeader']) {
      expect(Object.getOwnPropertyDescriptor(answer, name)).toMatchObject({
        configurable: true,
        writable: true
      })
    }
  })

  it('leaves the deadline signal on the request, aborted with the reason, and survives a second pass', () => {
    const answer = response()
    const request: Record<symbol, unknown> & { url: string } = { url: '/a' }
    const middleware = requestDeadline({ timeoutMs: 50, excludePaths: [] })

    middleware(request, answer, () => undefined)
    expect(() => middleware(request, answer, () => undefined)).not.toThrow()
    jest.advanceTimersByTime(60)

    const signal = request[DEADLINE_SIGNAL] as AbortSignal
    expect(signal.aborted).toBe(true)
    expect((signal.reason as Error).message).toBe('Request deadline exceeded')
    expect(JSON.parse(answer.body as string).message).toBe('The request took too long to answer')
  })

  it('does not exclude the root of a path that has none of the prefixes, and excludes under the root', () => {
    const bare = response()
    requestDeadline({ timeoutMs: 50, excludePaths: ['/a/b'] })({ url: '/a' }, bare, () => undefined)
    jest.advanceTimersByTime(60)
    expect(bare.statusCode).toBe(504)

    const deep = response()
    requestDeadline({ timeoutMs: 50, excludePaths: ['/a/b'] })(
      { url: '/a/b/c' },
      deep,
      () => undefined
    )
    jest.advanceTimersByTime(60)
    expect(deep.body).toBeUndefined()
  })
})
