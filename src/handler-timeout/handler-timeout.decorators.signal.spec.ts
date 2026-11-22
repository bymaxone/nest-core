/**
 * Unit tests for the signal `@HandlerSignal()` returns when the handler timeout and the request deadline
 * both bind one.
 *
 * Layer: unit.
 * Goal: with only one of the two bound, that signal is returned as it is; with both, the signal aborts as
 * soon as either does; with neither, there is no signal.
 * Mocks: none.
 */
import { bindHandlerSignal, handlerSignalOf } from './handler-timeout.decorators'
import { DEADLINE_SIGNAL } from '../request-deadline-signal'

/** A request with the deadline signal the floors leave on it. */
function withDeadline(signal: AbortSignal): object {
  return Object.defineProperty({}, DEADLINE_SIGNAL, { value: signal })
}

describe('handlerSignalOf', () => {
  it('has no signal when nothing is bound', () => {
    expect(handlerSignalOf({})).toBeUndefined()
  })

  it('returns the handler signal alone, and the deadline signal alone', () => {
    const handler = new AbortController()
    const request = {}
    bindHandlerSignal(request, handler.signal)
    const deadline = new AbortController()

    expect(handlerSignalOf(request)).toBe(handler.signal)
    expect(handlerSignalOf(withDeadline(deadline.signal))).toBe(deadline.signal)
  })

  it.each(['deadline', 'handler'])('aborts with both bound as soon as the %s does', (which) => {
    const deadline = new AbortController()
    const handler = new AbortController()
    const request = withDeadline(deadline.signal)
    bindHandlerSignal(request, handler.signal)
    const both = handlerSignalOf(request) as AbortSignal

    expect(both.aborted).toBe(false)
    ;(which === 'deadline' ? deadline : handler).abort(new Error(which))

    expect(both.aborted).toBe(true)
    expect((both.reason as Error).message).toBe(which)
  })
})
