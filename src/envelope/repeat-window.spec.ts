/**
 * Unit tests for the repeat window.
 *
 * Layer: unit.
 * Goal: pin that the first occurrence of a key is admitted and the rest are counted, that one summary
 * closes a window that withheld something, that a quiet window and a flush report nothing extra, that
 * the number of tracked keys is bounded, that the timer never holds the process open, and that a
 * summary that throws cannot escape a timer.
 * Mocks: Jest fake timers; the summary callback is a spy.
 */
import { RepeatWindow } from './repeat-window'

const WINDOW_MS = 1_000

describe('RepeatWindow', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('admits the first occurrence of a key and withholds the rest', () => {
    const window = new RepeatWindow<string>(WINDOW_MS, jest.fn())

    expect([
      window.admit('a', 'one'),
      window.admit('a', 'two'),
      window.admit('a', 'three')
    ]).toEqual([true, false, false])
  })

  it('keeps one window per key', () => {
    const window = new RepeatWindow<string>(WINDOW_MS, jest.fn())

    expect([window.admit('a', '1'), window.admit('b', '2'), window.admit('a', '3')]).toEqual([
      true,
      true,
      false
    ])
  })

  it('summarises a window that withheld repeats, with the latest of them, when it ends', () => {
    const onSummary = jest.fn()
    const window = new RepeatWindow<string>(WINDOW_MS, onSummary)
    window.admit('a', 'first')
    window.admit('a', 'second')
    window.admit('a', 'third')

    jest.advanceTimersByTime(WINDOW_MS - 1)
    expect(onSummary).not.toHaveBeenCalled()
    jest.advanceTimersByTime(1)

    expect(onSummary).toHaveBeenCalledTimes(1)
    expect(onSummary).toHaveBeenCalledWith('third', 2)
  })

  it('reports nothing when a window ends without repeats, and opens a new one on the next occurrence', () => {
    const onSummary = jest.fn()
    const window = new RepeatWindow<string>(WINDOW_MS, onSummary)
    window.admit('a', 'first')

    jest.advanceTimersByTime(WINDOW_MS)

    expect(onSummary).not.toHaveBeenCalled()
    expect(window.admit('a', 'again')).toBe(true)
  })

  it('counts a new window from zero after the previous one ended', () => {
    const onSummary = jest.fn()
    const window = new RepeatWindow<string>(WINDOW_MS, onSummary)
    window.admit('a', 'one')
    window.admit('a', 'two')
    jest.advanceTimersByTime(WINDOW_MS)
    window.admit('a', 'three')
    window.admit('a', 'four')
    window.admit('a', 'five')
    jest.advanceTimersByTime(WINDOW_MS)

    expect(onSummary.mock.calls).toEqual([
      ['two', 1],
      ['five', 2]
    ])
  })

  it('flushes the summaries that are due and clears every timer', () => {
    const onSummary = jest.fn()
    const window = new RepeatWindow<string>(WINDOW_MS, onSummary)
    window.admit('busy', 'x')
    window.admit('busy', 'y')
    window.admit('quiet', 'z')

    window.flush()

    expect(onSummary.mock.calls).toEqual([['y', 1]])
    expect(jest.getTimerCount()).toBe(0)
    jest.advanceTimersByTime(WINDOW_MS)
    expect(onSummary).toHaveBeenCalledTimes(1)
  })

  it('bounds the number of tracked keys: the keys past the bound share one slot', () => {
    const onSummary = jest.fn()
    const window = new RepeatWindow<string>(WINDOW_MS, onSummary)
    const first = Array.from({ length: 64 }, (_, index) => window.admit(`key-${index}`, 'x'))
    const overflow = [
      window.admit('extra-1', 'a'),
      window.admit('extra-2', 'b'),
      window.admit('extra-3', 'c')
    ]

    expect(first.every(Boolean)).toBe(true)
    expect(overflow).toEqual([true, false, false])
    expect(jest.getTimerCount()).toBe(65)
    jest.advanceTimersByTime(WINDOW_MS)
    expect(onSummary.mock.calls).toEqual([['c', 2]])
  })

  it('keeps the overflow slot apart from every real key, an empty one included', () => {
    const window = new RepeatWindow<string>(WINDOW_MS, jest.fn())
    window.admit('', 'empty')
    Array.from({ length: 63 }, (_, index) => window.admit(`key-${index}`, 'x'))

    expect(window.admit('extra', 'overflow')).toBe(true)
    expect(window.admit('', 'empty again')).toBe(false)
  })

  it('does not hold the process open', () => {
    const spy = jest.spyOn(globalThis, 'setTimeout')
    const window = new RepeatWindow<string>(WINDOW_MS, jest.fn())

    window.admit('a', 'x')

    const timer = spy.mock.results[0]?.value as { hasRef(): boolean }
    expect(timer.hasRef()).toBe(false)
  })

  it('arms the timer for the configured window', () => {
    const spy = jest.spyOn(globalThis, 'setTimeout')
    const window = new RepeatWindow<string>(4_321, jest.fn())

    window.admit('a', 'x')

    expect(spy).toHaveBeenCalledWith(expect.any(Function), 4_321)
  })

  it('contains a summary that throws, so a timer cannot raise an uncaught exception', () => {
    const window = new RepeatWindow<string>(WINDOW_MS, () => {
      throw new Error('the logger is down')
    })
    window.admit('a', 'x')
    window.admit('a', 'y')

    expect(() => jest.advanceTimersByTime(WINDOW_MS)).not.toThrow()
    expect(window.admit('a', 'z')).toBe(true)
  })
})
