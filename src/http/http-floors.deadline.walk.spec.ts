/**
 * Tests for the exclusion match and the disconnect handling of the request deadline.
 *
 * Layer: unit.
 * Goal: the exclusion match costs no more for a path of sixteen thousand slashes than for a short one and
 * still decides at a segment boundary; a client that goes away aborts the signal, a finished answer does not.
 * Mocks: a hand-built request and response; the real middleware.
 */
import { requestDeadline } from './http-floors.deadline'
import { DEADLINE_SIGNAL } from '../request-deadline-signal'

type Listener = () => void
type Held = Record<string | symbol, unknown>

/** A response that records its listeners so a test can emit `close` or `finish`. */
function fakeResponse(finished = false): { response: never; emit: (event: string) => void } {
  const listeners = new Map<string, Listener[]>()
  const response = {
    headersSent: false,
    writableEnded: false,
    writableFinished: finished,
    once: (event: string, listener: Listener): void => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
    }
  }
  return {
    response: response as never,
    emit: (event) => (listeners.get(event) ?? []).forEach((listener) => listener())
  }
}

/** Run the middleware on `path`; `bounded` is whether it armed a deadline for the request. */
function runs(excludePaths: string[], path: string): { bounded: boolean; ms: number } {
  const middleware = requestDeadline({ timeoutMs: 60_000, excludePaths })
  const request: Held = { originalUrl: path }
  const { response, emit } = fakeResponse()
  const started = Date.now()
  middleware(request as never, response, () => undefined)
  const ms = Date.now() - started
  // The answer finished: the middleware clears its 60 s timer, so none outlives the row and fires on a
  // stub that has no `removeHeader` or `destroy`.
  emit('finish')
  return { bounded: DEADLINE_SIGNAL in request, ms }
}

describe('the deadline exclusion match on a long path', () => {
  it('answers a sixteen-thousand-slash path in under 100 ms, however many prefixes are configured', () => {
    expect(runs([], '/'.repeat(16_000)).ms).toBeLessThan(100)
    expect(runs(['/health', '/a/b/c'], '/'.repeat(16_000)).ms).toBeLessThan(100)
  })

  it('still excludes at a segment boundary and nowhere else', () => {
    expect(runs(['/health'], '/health').bounded).toBe(false)
    expect(runs(['/health'], '/health/live?x=1').bounded).toBe(false)
    expect(runs(['/health'], '/healthz').bounded).toBe(true)
    expect(runs(['/a/b'], '/a/b/c').bounded).toBe(false)
    expect(runs(['/a/b'], '/a').bounded).toBe(true)
    expect(runs(['/'], '/anything').bounded).toBe(false)
    expect(runs([], '/x').bounded).toBe(true)
  })
})

describe('the deadline signal when the client goes away', () => {
  /** Arm the middleware and return the signal it left on the request, plus the response's emitter. */
  function armed(finished: boolean): { signal: AbortSignal; emit: (event: string) => void } {
    const request: Held = { originalUrl: '/x' }
    const { response, emit } = fakeResponse(finished)
    requestDeadline({ timeoutMs: 60_000, excludePaths: [] })(
      request as never,
      response,
      () => undefined
    )
    return { signal: request[DEADLINE_SIGNAL] as AbortSignal, emit }
  }

  it('aborts on a close before the answer finished', () => {
    const { signal, emit } = armed(false)
    expect(signal.aborted).toBe(false)
    emit('close')
    expect(signal.aborted).toBe(true)
  })

  it('leaves the signal alone on a close after the answer finished', () => {
    const { signal, emit } = armed(true)
    emit('close')
    expect(signal.aborted).toBe(false)
  })
})

describe('the 504 body under fake timers', () => {
  it('is answered with its status and path while the global Date is replaced', () => {
    jest.useFakeTimers({ now: new Date('2030-01-01T00:00:00.000Z') })
    try {
      let body = ''
      const response = {
        headersSent: false,
        writableEnded: false,
        writableFinished: false,
        statusCode: 0,
        setHeader: () => undefined,
        removeHeader: () => undefined,
        destroy: () => undefined,
        end: (text: string) => {
          body = text
        },
        once: () => undefined
      }
      requestDeadline({ timeoutMs: 5, excludePaths: [] })(
        { originalUrl: '/held' } as never,
        response as never,
        () => undefined
      )
      jest.advanceTimersByTime(10)
      expect(JSON.parse(body)).toMatchObject({ statusCode: 504, path: '/held' })
    } finally {
      jest.useRealTimers()
    }
  })
})
