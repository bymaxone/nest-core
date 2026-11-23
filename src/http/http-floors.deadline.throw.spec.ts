/**
 * Tests for the deadline timer when a built-in the envelope uses was replaced after load.
 *
 * Layer: unit.
 * Goal: a throw while the `504` envelope is built never escapes the timer callback, which would end the
 * process, and the response is closed instead of being left without an answer.
 * Mocks: a hand-built response and jest fake timers, so the timer callback runs under the test's own frame.
 */
import { requestDeadline } from './http-floors.deadline'

/** A response that records whether it was ended or destroyed. */
function recording(): {
  response: Record<string, unknown>
  state: { ended: boolean; destroyed: boolean }
} {
  const state = { ended: false, destroyed: false }
  const response = {
    headersSent: false,
    writableEnded: false,
    writableFinished: false,
    statusCode: 0,
    setHeader: () => undefined,
    removeHeader: () => undefined,
    end: () => {
      state.ended = true
    },
    destroy: () => {
      state.destroyed = true
    },
    once: () => undefined
  }
  return { response, state }
}

describe('the deadline timer when the envelope cannot be built', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  it.each([
    ['split', 'split', (): unknown => []],
    [
      'replace',
      'replace',
      (): unknown => {
        throw new Error('replaced')
      }
    ]
  ])('destroys the response and throws nothing when %s was replaced', (_label, name, answer) => {
    jest.useFakeTimers()
    const { response, state } = recording()
    requestDeadline({ timeoutMs: 5, excludePaths: [] })(
      { originalUrl: '/held' } as never,
      response as never,
      () => undefined
    )
    const proto = String.prototype as unknown as Record<string, unknown>
    const original = proto[name]
    proto[name] = answer
    let thrown: unknown
    try {
      jest.advanceTimersByTime(10)
    } catch (error) {
      thrown = error
    } finally {
      proto[name] = original
    }

    expect(thrown).toBeUndefined()
    expect(state).toEqual({ ended: false, destroyed: true })
  })
})
