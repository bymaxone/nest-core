/**
 * Unit tests for the shutdown deadline and its options.
 *
 * Layer: unit.
 * Goal: with no deadline nothing starts; with one, the timer does not keep the process alive, fires
 * once at the deadline with one error line and exit code 1, and the option refuses what is not a
 * positive timer-safe integer.
 * Mocks: the process exit and the Nest logger are spied on; time is faked.
 */
import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { BymaxCoreModule } from '../core.module'

import { normalizeCoreOptions } from '../core.options'
import { BymaxShutdownDeadline } from './shutdown-deadline'

/** A deadline provider for the given shutdown options. */
const deadline = (shutdown?: { deadlineMs?: number }): BymaxShutdownDeadline =>
  new BymaxShutdownDeadline(normalizeCoreOptions(shutdown === undefined ? {} : { shutdown }))

describe('shutdown deadline', () => {
  let exit: jest.SpyInstance
  let error: jest.SpyInstance

  beforeEach(() => {
    jest.useFakeTimers()
    exit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('starts nothing when no deadline is set', () => {
    deadline().beforeApplicationShutdown()
    expect(jest.getTimerCount()).toBe(0)
    jest.advanceTimersByTime(2 ** 31 - 1)
    expect(exit).not.toHaveBeenCalled()
  })

  /**
   * One second short of the deadline nothing has happened; at it, exactly one error line and exit 1.
   */
  it('logs once and exits with code 1 at the deadline, not before', () => {
    deadline({ deadlineMs: 5_000 }).beforeApplicationShutdown()
    jest.advanceTimersByTime(4_999)
    expect(exit).not.toHaveBeenCalled()
    jest.advanceTimersByTime(1)
    expect(exit).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(1)
    expect(error).toHaveBeenCalledTimes(1)
    expect(String(error.mock.calls[0]?.[0])).toContain('5000ms')
    jest.advanceTimersByTime(60_000)
    expect(exit).toHaveBeenCalledTimes(1)
  })

  it('does not keep the process alive: the timer is unreferenced', () => {
    const real = global.setTimeout
    const timers: { hasRef(): boolean }[] = []
    jest.useRealTimers()
    const spy = jest.spyOn(global, 'setTimeout').mockImplementation(((
      ...args: Parameters<typeof real>
    ) => {
      const timer = real(...args)
      timers.push(timer)
      return timer
    }) as never)
    deadline({ deadlineMs: 60_000 }).beforeApplicationShutdown()
    expect(timers).toHaveLength(1)
    expect(timers[0]?.hasRef()).toBe(false)
    spy.mockRestore()
    clearTimeout(timers[0] as never)
  })
})

describe('shutdown options', () => {
  it('leaves the deadline absent by default and treats null as unset', () => {
    expect(normalizeCoreOptions().shutdown).toEqual({})
    expect(
      normalizeCoreOptions({ shutdown: { deadlineMs: null as unknown as number } }).shutdown
    ).toEqual({})
  })

  it('keeps a valid deadline, up to the largest timer-safe value', () => {
    expect(
      normalizeCoreOptions({ shutdown: { deadlineMs: 2 ** 31 - 1 } }).shutdown.deadlineMs
    ).toBe(2 ** 31 - 1)
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31, '3' as unknown as number])(
    'refuses a deadline of %p',
    (deadlineMs) => {
      expect(() => normalizeCoreOptions({ shutdown: { deadlineMs } })).toThrow(
        /shutdown\.deadlineMs/
      )
    }
  )
})

describe('shutdown deadline, in the module', () => {
  /* Closing a module starts the deadline timer; faked time keeps it from firing in this worker. */
  beforeEach(() => {
    jest.useFakeTimers()
    jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  const find = async (module: Promise<unknown> | unknown): Promise<unknown> => {
    const ref = await Test.createTestingModule({ imports: [module as never] }).compile()
    try {
      return ref.get(BymaxShutdownDeadline, { strict: false })
    } catch {
      return undefined
    } finally {
      await ref.close()
    }
  }

  it('registers the provider on forRoot only when a deadline is set', async () => {
    expect(await find(BymaxCoreModule.forRoot())).toBeUndefined()
    expect(await find(BymaxCoreModule.forRoot({ shutdown: { deadlineMs: 5_000 } }))).toBeInstanceOf(
      BymaxShutdownDeadline
    )
  })

  it('registers the provider on forRootAsync, which reads the options when shutdown begins', async () => {
    const module = BymaxCoreModule.forRootAsync({
      useFactory: () => ({ shutdown: { deadlineMs: 5_000 } })
    })
    expect(await find(module)).toBeInstanceOf(BymaxShutdownDeadline)
  })
})
