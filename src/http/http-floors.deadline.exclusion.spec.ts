/**
 * Tests for which request paths the request deadline leaves alone.
 *
 * Layer: unit.
 * Goal: a path is excluded only when a configured prefix matches it up to a segment boundary, whatever
 * query string follows and whatever order the prefixes were given in.
 * Mocks: a hand-built response and jest fake timers; an excluded request is never answered by the timer.
 */
import { requestDeadline } from './http-floors.deadline'

/** Whether the deadline answered a request for `url` once its timer was due. */
function answered(excludePaths: readonly string[], url: string): boolean {
  jest.useFakeTimers()
  let ended = false
  const response = {
    headersSent: false,
    writableEnded: false,
    writableFinished: false,
    statusCode: 0,
    setHeader: () => undefined,
    removeHeader: () => undefined,
    end: () => {
      ended = true
    },
    destroy: () => undefined,
    once: () => undefined
  }
  requestDeadline({ timeoutMs: 5, excludePaths })(
    { originalUrl: url } as never,
    response as never,
    () => undefined
  )
  jest.advanceTimersByTime(10)
  jest.useRealTimers()
  return ended
}

describe('the paths the request deadline excludes', () => {
  it.each([
    ['/health', '/health'],
    ['/health', '/health?probe=1'],
    ['/health', '/health/live?probe=1'],
    ['/health', '/health/live']
  ])('leaves %s alone for a request to %s', (prefix, url) => {
    expect(answered([prefix], url)).toBe(false)
  })

  it.each([
    ['/health', '/healthz'],
    ['/health', '/healthz?probe=1'],
    ['/health', '/healthy/live'],
    ['/health', '/other'],
    ['/a/bc', '/a/bcd'],
    ['/a/bc', '/a/bcd?x=1'],
    ['a', 'abc']
  ])('bounds a request to %s when only %s shares its leading characters', (prefix, url) => {
    expect(answered([prefix], url)).toBe(true)
  })

  it('matches a long prefix configured before a shorter one', () => {
    expect(answered(['/long/prefix', '/z'], '/long/prefix/x')).toBe(false)
    expect(answered(['/z', '/long/prefix'], '/long/prefix/x')).toBe(false)
  })
})
