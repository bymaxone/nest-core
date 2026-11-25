/**
 * Tests for the writers the deadline silences once it has answered.
 *
 * Layer: unit.
 * Goal: every writer named for silencing is a no-op on an answered response, including the ones a host
 * response class may define that Node's own does not throw from.
 * Mocks: a hand-built response whose writers are `jest.fn`, and jest fake timers.
 */
import { requestDeadline } from './http-floors.deadline'

const SILENCED = [
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
  'end',
  'writeContinue',
  'writeEarlyHints',
  'writeProcessing',
  'appendHeader',
  'setHeaders',
  'writeInformation',
  'writeHeader'
]

describe('the writers of an answered response', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it.each(SILENCED)('do not reach %s, and return the response', (name) => {
    const response: Record<string, unknown> = {
      headersSent: false,
      writableEnded: false,
      writableFinished: false,
      statusCode: 0,
      once: () => undefined,
      removeHeader: () => undefined,
      writeHead: () => undefined,
      destroy: () => undefined
    }
    for (const writer of SILENCED) response[writer] = jest.fn()
    const stub = response[name] as jest.Mock
    requestDeadline({ timeoutMs: 5, excludePaths: [] })(
      { originalUrl: '/held' } as never,
      response as never,
      () => undefined
    )
    jest.advanceTimersByTime(10)
    const before = stub.mock.calls.length

    const returned = (response[name] as (...args: unknown[]) => unknown)('late', { a: 1 })

    expect(stub.mock.calls.length).toBe(before)
    expect(returned).toBe(response)
  })
})
