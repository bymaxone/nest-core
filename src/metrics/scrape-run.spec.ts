/**
 * Unit tests for the scrape run.
 *
 * Layer: unit.
 * Goal: pin that concurrent scrapes share one collection, that none is cached once it settles, that a
 * collection past its deadline answers 503 at once without starting a second, that it can finish late
 * and be followed by a normal scrape, that a rejection reaches every waiter, and that the timer never
 * holds the process open.
 * Mocks: Jest fake timers; the collection is a spy over a promise the test controls.
 */
import { ServiceUnavailableException } from '@nestjs/common'

import { ScrapeRun } from './scrape-run'

const DEADLINE_MS = 5_000

/** A collection the test settles by hand. */
function controlled(): {
  collect: jest.Mock<Promise<string>, []>
  resolve: (text: string) => void
  reject: (error: Error) => void
} {
  let resolve: (text: string) => void = () => undefined
  let reject: (error: Error) => void = () => undefined
  const collect = jest.fn(
    () =>
      new Promise<string>((res, rej) => {
        resolve = res
        reject = rej
      })
  )
  return { collect, resolve: (text) => resolve(text), reject: (error) => reject(error) }
}

describe('ScrapeRun', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('answers with the text of the collection', async () => {
    const scrapes = new ScrapeRun(DEADLINE_MS, jest.fn())

    await expect(scrapes.run(() => Promise.resolve('up 1'))).resolves.toBe('up 1')
  })

  it('shares one collection among the scrapes that arrive while it runs', async () => {
    const scrapes = new ScrapeRun(DEADLINE_MS, jest.fn())
    const { collect, resolve } = controlled()

    const together = [scrapes.run(collect), scrapes.run(collect), scrapes.run(collect)]
    await Promise.resolve()
    resolve('up 1')

    await expect(Promise.all(together)).resolves.toEqual(['up 1', 'up 1', 'up 1'])
    expect(collect).toHaveBeenCalledTimes(1)
  })

  it('starts a new collection for each scrape that arrives after the last one settled', async () => {
    const scrapes = new ScrapeRun(DEADLINE_MS, jest.fn())
    const collect = jest.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second')

    await expect(scrapes.run(collect)).resolves.toBe('first')
    await expect(scrapes.run(collect)).resolves.toBe('second')
    expect(collect).toHaveBeenCalledTimes(2)
  })

  it('answers 503 when the collection is past its deadline, and says so once', async () => {
    const onExpired = jest.fn()
    const scrapes = new ScrapeRun(DEADLINE_MS, onExpired)
    const { collect } = controlled()
    const first = scrapes.run(collect)
    const second = scrapes.run(collect)

    jest.advanceTimersByTime(DEADLINE_MS - 1)
    expect(onExpired).not.toHaveBeenCalled()
    jest.advanceTimersByTime(1)

    await expect(first).rejects.toBeInstanceOf(ServiceUnavailableException)
    await expect(second).rejects.toMatchObject({
      status: 503,
      message: 'Metrics collection timed out'
    })
    expect(onExpired).toHaveBeenCalledTimes(1)
  })

  it('answers 503 at once to every later scrape and starts no second collection while it hangs', async () => {
    const scrapes = new ScrapeRun(DEADLINE_MS, jest.fn())
    const { collect } = controlled()
    const first = scrapes.run(collect)
    jest.advanceTimersByTime(DEADLINE_MS)
    await expect(first).rejects.toBeInstanceOf(ServiceUnavailableException)

    const later = await Promise.allSettled([
      scrapes.run(collect),
      scrapes.run(collect),
      scrapes.run(collect)
    ])

    expect(later).toHaveLength(3)
    for (const result of later) {
      expect(result).toMatchObject({
        status: 'rejected',
        reason: expect.any(ServiceUnavailableException) as unknown
      })
      expect((result as PromiseRejectedResult).reason).toMatchObject({ status: 503 })
    }
    expect(collect).toHaveBeenCalledTimes(1)
  })

  it('lets a late scrape share the deadline of the collection it joined', async () => {
    const scrapes = new ScrapeRun(DEADLINE_MS, jest.fn())
    const { collect } = controlled()
    const first = scrapes.run(collect)
    jest.advanceTimersByTime(3_000)
    const joined = scrapes.run(collect)
    const outcome = jest.fn()
    joined.catch(outcome)

    jest.advanceTimersByTime(1_999)
    await Promise.resolve()
    expect(outcome).not.toHaveBeenCalled()
    jest.advanceTimersByTime(1)
    await expect(first).rejects.toBeInstanceOf(ServiceUnavailableException)
    await expect(joined).rejects.toBeInstanceOf(ServiceUnavailableException)
    expect(collect).toHaveBeenCalledTimes(1)
  })

  it('answers normally again once the late collection has settled', async () => {
    const scrapes = new ScrapeRun(DEADLINE_MS, jest.fn())
    const hung = controlled()
    const first = scrapes.run(hung.collect)
    jest.advanceTimersByTime(DEADLINE_MS)
    await expect(first).rejects.toBeInstanceOf(ServiceUnavailableException)

    hung.resolve('late')
    await Promise.resolve()
    await Promise.resolve()
    const fresh = jest.fn().mockResolvedValue('fresh')

    await expect(scrapes.run(fresh)).resolves.toBe('fresh')
    expect(fresh).toHaveBeenCalledTimes(1)
  })

  it('clears its timer when the collection settles in time', async () => {
    const scrapes = new ScrapeRun(DEADLINE_MS, jest.fn())

    await scrapes.run(() => Promise.resolve('up 1'))

    expect(jest.getTimerCount()).toBe(0)
  })

  it('gives every waiting scrape the rejection of a failing collection, and starts afresh after it', async () => {
    const scrapes = new ScrapeRun(DEADLINE_MS, jest.fn())
    const failing = controlled()
    const together = [scrapes.run(failing.collect), scrapes.run(failing.collect)]
    await Promise.resolve()
    failing.reject(new Error('registry broke'))

    const outcomes = await Promise.allSettled(together)
    expect(outcomes).toHaveLength(2)
    for (const outcome of outcomes) {
      expect(outcome).toMatchObject({ status: 'rejected', reason: new Error('registry broke') })
    }
    expect(jest.getTimerCount()).toBe(0)
    await expect(scrapes.run(() => Promise.resolve('recovered'))).resolves.toBe('recovered')
  })

  it('rejects when the collection throws before returning a promise', async () => {
    const scrapes = new ScrapeRun(DEADLINE_MS, jest.fn())

    await expect(
      scrapes.run(() => {
        throw new Error('synchronous failure')
      })
    ).rejects.toThrow('synchronous failure')
  })

  it('does not hold the process open, and arms the timer for the deadline', () => {
    const spy = jest.spyOn(globalThis, 'setTimeout')
    const scrapes = new ScrapeRun(4_321, jest.fn())

    void scrapes.run(() => new Promise<string>(() => undefined)).catch(() => undefined)

    expect(spy).toHaveBeenCalledWith(expect.any(Function), 4_321)
    expect((spy.mock.results[0]?.value as { hasRef(): boolean }).hasRef()).toBe(false)
  })
})
