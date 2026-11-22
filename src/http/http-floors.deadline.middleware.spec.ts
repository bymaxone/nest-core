/**
 * Unit tests for the request-deadline middleware against hand-built requests and responses.
 *
 * Layer: unit.
 * Goal: the middleware answers or closes by what the response has done at the deadline, matches the
 * excluded prefixes by the request's path, and clears its timer when the response ends.
 * Mocks: hand-built request and response objects; jest fake timers.
 */
import { requestDeadline } from './http-floors.deadline'

/** A response that records what was done to it. */
function response(state: { headersSent?: boolean; writableEnded?: boolean } = {}): {
  headersSent: boolean
  writableEnded: boolean
  statusCode: number
  body: string | undefined
  destroyed: boolean
  listeners: Record<string, () => void>
  setHeader: () => void
  end: (body?: string) => void
  destroy: () => void
  once: (event: string, listener: () => void) => void
} {
  const held = {
    headersSent: state.headersSent ?? false,
    writableEnded: state.writableEnded ?? false,
    statusCode: 200,
    body: undefined as string | undefined,
    destroyed: false,
    listeners: {} as Record<string, () => void>,
    setHeader: (): void => undefined,
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
})
