/**
 * Unit tests for the shutdown deadline and its options.
 *
 * Layer: unit.
 * Goal: with no deadline nothing starts; with one, the timer does not keep the process alive, fires
 * once at the deadline with one error line and exit code 1, and the option refuses what is not a
 * positive timer-safe integer.
 * Mocks: the process exit and the Nest logger are spied on; time is faked.
 */
import { Global, Injectable, Logger, Module } from '@nestjs/common'
import type { DynamicModule, Type } from '@nestjs/common'
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
    expect(String(error.mock.calls[0]?.[0])).toContain('deadlineMs=5000')
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

/** A promise that never settles, as a driver's `quit()` does when its server is gone. */
const never = (): Promise<void> => new Promise<void>(() => undefined)

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** A provider whose chosen shutdown hook never settles. */
function hanging(hook: 'onModuleDestroy' | 'beforeApplicationShutdown'): Type {
  class Hanging {}
  Object.defineProperty(Hanging.prototype, hook, { value: never })
  Injectable()(Hanging)
  return Hanging
}

/** A module that provides `provider` and nothing else. */
function moduleOf(provider: Type): Type {
  class Holder {}
  Module({ providers: [provider] })(Holder)
  return Holder
}

describe('shutdown deadline, arming', () => {
  let exit: jest.SpyInstance

  beforeEach(() => {
    exit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  /** Boots an application with the deadline set and the given modules around it, then starts closing it. */
  async function closing(modules: (core: DynamicModule) => unknown[]): Promise<void> {
    const core = BymaxCoreModule.forRoot({ shutdown: { deadlineMs: 150 } })
    const ref = await Test.createTestingModule({ imports: modules(core) as never[] }).compile()
    const app = ref.createNestApplication()
    await app.init()
    void app.close()
    await sleep(400)
  }

  /**
   * Every hook of the phases after destroy runs after all the destroy hooks, so arming in
   * onModuleDestroy covers a never-settling beforeApplicationShutdown wherever its module sits.
   */
  it.each([
    ['imported before the core module', (core: DynamicModule, hang: Type) => [hang, core]],
    ['imported after the core module', (core: DynamicModule, hang: Type) => [core, hang]]
  ])(
    'exits when a beforeApplicationShutdown hook in a module %s never settles',
    async (_name, order) => {
      await closing((core) => order(core, moduleOf(hanging('beforeApplicationShutdown'))))
      expect(exit).toHaveBeenCalledWith(1)
    }
  )

  it('arms once, whichever hooks run', () => {
    jest.useFakeTimers()
    const provider = deadline({ deadlineMs: 5_000 })
    provider.onModuleDestroy()
    provider.beforeApplicationShutdown()
    provider.onApplicationShutdown()
    expect(jest.getTimerCount()).toBe(1)
    jest.useRealTimers()
  })
})

describe('shutdown deadline, signals', () => {
  let exit: jest.SpyInstance
  const added: [NodeJS.Signals, () => void][] = []

  /** Registers a listener the test removes afterwards, standing for the application's own handler. */
  function handle(signal: NodeJS.Signals, listener: () => void): void {
    process.on(signal, listener)
    added.push([signal, listener])
  }

  beforeEach(() => {
    jest.useFakeTimers()
    exit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    for (const [signal, listener] of added.splice(0)) process.removeListener(signal, listener)
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  /**
   * The signal path reaches the root module's own providers first, ahead of any module's hook, so
   * the deadline is armed when the signal arrives, on a signal something already handles.
   */
  it('arms at a signal the application already handles, before any hook has run', () => {
    handle('SIGTERM', () => undefined)
    const provider = deadline({ deadlineMs: 5_000 })
    provider.onApplicationBootstrap()
    process.emit('SIGTERM')
    expect(jest.getTimerCount()).toBe(1)
    jest.advanceTimersByTime(5_000)
    expect(exit).toHaveBeenCalledWith(1)
    provider.onApplicationShutdown()
  })

  it('adds no listener to a signal nothing handles, so the default of ending the process stays', () => {
    const before = process.listenerCount('SIGINT')
    const provider = deadline({ deadlineMs: 5_000 })
    provider.onApplicationBootstrap()
    expect(process.listenerCount('SIGINT')).toBe(before)
    provider.onApplicationShutdown()
  })

  it('removes the listeners it added when the shutdown completes', () => {
    handle('SIGTERM', () => undefined)
    const before = process.listenerCount('SIGTERM')
    const provider = deadline({ deadlineMs: 5_000 })
    provider.onApplicationBootstrap()
    expect(process.listenerCount('SIGTERM')).toBe(before + 1)
    provider.onApplicationShutdown()
    expect(process.listenerCount('SIGTERM')).toBe(before)
  })

  it('does nothing at bootstrap without a deadline', () => {
    handle('SIGTERM', () => undefined)
    const before = process.listenerCount('SIGTERM')
    deadline().onApplicationBootstrap()
    expect(process.listenerCount('SIGTERM')).toBe(before)
  })
})

describe('shutdown deadline, a signal and a hang in onModuleDestroy', () => {
  /**
   * A global module's hooks run last in every phase, so a never-settling onModuleDestroy elsewhere,
   * in a module or in a provider of the root module, is reached before this module's own. A signal
   * arms the deadline ahead of them.
   */
  it('exits when a provider of the root module never settles in onModuleDestroy, on a signal', async () => {
    const exit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    const before = process.listeners('SIGTERM')
    const hang = hanging('onModuleDestroy')
    class Root {}
    Module({
      imports: [BymaxCoreModule.forRoot({ shutdown: { deadlineMs: 150 } })],
      providers: [hang]
    })(Root)
    const ref = await Test.createTestingModule({ imports: [Root] }).compile()
    const app = ref.createNestApplication()
    app.enableShutdownHooks(['SIGTERM'])
    await app.init()
    try {
      process.emit('SIGTERM')
      await sleep(400)
      expect(exit).toHaveBeenCalledWith(1)
    } finally {
      for (const listener of process.listeners('SIGTERM')) {
        if (!before.includes(listener)) process.removeListener('SIGTERM', listener)
      }
      jest.restoreAllMocks()
    }
  })
})

describe('the Nest hook order the deadline relies on', () => {
  /** Records the order of the destroy and before-shutdown hooks of a few modules. */
  async function order(globalCore: boolean): Promise<string[]> {
    const seen: string[] = []
    const named = (name: string): Type => {
      class Probe {}
      Object.defineProperty(Probe.prototype, 'onModuleDestroy', {
        value: () => seen.push(`destroy:${name}`)
      })
      Object.defineProperty(Probe.prototype, 'beforeApplicationShutdown', {
        value: () => seen.push(`before:${name}`)
      })
      Injectable()(Probe)
      return Probe
    }
    const holder = (name: string, imports: Type[] = [], global = false): Type => {
      class Holder {}
      Module({ imports, providers: [named(name)] })(Holder)
      if (global) Global()(Holder)
      return Holder
    }
    const root = holder('root', [
      holder('feature', [holder('deep')]),
      holder('core', [], globalCore)
    ])
    const ref = await Test.createTestingModule({ imports: [root] }).compile()
    const app = ref.createNestApplication()
    await app.init()
    await app.close()
    return seen
  }

  /**
   * A global module's hooks run after every other module's, in each phase, and every destroy hook of
   * every module runs before any before-shutdown hook. The deadline is armed in onModuleDestroy, which
   * covers every beforeApplicationShutdown hang, and by the signal, which covers the rest.
   */
  it('runs a global module last in each phase, and all destroy hooks before any before-shutdown hook', async () => {
    const seen = await order(true)
    expect(seen.filter((hook) => hook.startsWith('destroy')).at(-1)).toBe('destroy:core')
    expect(seen.filter((hook) => hook.startsWith('before')).at(-1)).toBe('before:core')
    expect(seen.lastIndexOf('destroy:core')).toBeLessThan(seen.indexOf('before:root'))
  })

  it('runs the root module first, and a module that is not global in its place among the imports', async () => {
    const seen = await order(false)
    expect(seen[0]).toBe('destroy:root')
    expect(seen.indexOf('destroy:core')).toBeLessThan(seen.indexOf('destroy:deep'))
  })
})
