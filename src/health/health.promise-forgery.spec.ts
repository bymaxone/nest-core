/**
 * Tests for the readiness verdict beside a `then` planted on a built-in prototype, a foreign global
 * `Promise`, a constructor swapped and restored mid-probe, and a check that rejects while another is awaited.
 *
 * Layer: unit.
 * Goal: no planted `then` or foreign `Promise` reads a down or timed-out check as up; a probe in which
 * the built-ins were altered answers `runtime` down, writes one warning and caches nothing; and no
 * started check is ever left with an unhandled rejection.
 * Mocks: hand-built indicators; Nest's `Logger.warn` is spied.
 */
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { Logger } from '@nestjs/common'

import {
  loadUnderForeignPromise,
  replaceConstructor,
  restorePromise
} from '../__tests__/promise-forgery.harness'
import { normalizeCoreOptions } from '../core.options'
import type { IHealthIndicator } from './health.interfaces'
import { HealthService } from './health.service'

const RUNTIME_DOWN = { status: 'error', checks: [{ name: 'runtime', status: 'down' }] }
const FORGED_OK = { status: 'ok', checks: [] }

const down: IHealthIndicator = { name: 'db', check: async () => ({ status: 'down' }) }
const never: IHealthIndicator = { name: 'slow', check: () => new Promise(() => {}) }

/** Plant a `then` that answers a forged verdict on `owner`. */
function plantThen(owner: object): void {
  Object.defineProperty(owner, 'then', {
    value: (resolve: (value: unknown) => void) => resolve(FORGED_OK),
    configurable: true,
    writable: true
  })
}

/** Remove a planted `then`. */
function removeThen(owner: object): void {
  delete (owner as Record<string, unknown>)['then']
}

describe('the readiness verdict beside forged promise machinery', () => {
  let warn: jest.SpyInstance

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    restorePromise()
    for (const owner of [Object.prototype, Array.prototype, Function.prototype]) removeThen(owner)
    jest.useRealTimers()
    warn.mockRestore()
  })

  it.each([
    ['Object.prototype', Object.prototype],
    ['Array.prototype', Array.prototype],
    ['Function.prototype', Function.prototype]
  ])('answers runtime down, and says so once, while a then is planted on %s', async (_, owner) => {
    const service = new HealthService(
      [down],
      normalizeCoreOptions({ health: { readinessCacheMs: 0 } })
    )
    plantThen(owner)

    const first = await service.checkReadiness()
    const second = await service.checkReadiness()
    removeThen(owner)

    expect([first, second]).toEqual([RUNTIME_DOWN, RUNTIME_DOWN])
    expect(warn.mock.calls.map(([entry]) => (entry as { event: string }).event)).toEqual([
      'CORE_HEALTH_RUNTIME_ALTERED'
    ])
  })

  it('names the event, the check and what was replaced in that one line', async () => {
    const service = new HealthService(
      [down],
      normalizeCoreOptions({ health: { readinessCacheMs: 0 } })
    )
    plantThen(Object.prototype)

    await service.checkReadiness()
    removeThen(Object.prototype)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toMatchObject({
      event: 'CORE_HEALTH_RUNTIME_ALTERED',
      message: 'A promise built-in was replaced: readiness answers not ready',
      check: 'runtime'
    })
  })

  it('says so again for a second alteration after a probe was answered from the cache', async () => {
    const up: IHealthIndicator = { name: 'db', check: async () => ({ status: 'up' }) }
    const service = new HealthService(
      [up],
      normalizeCoreOptions({ health: { readinessCacheMs: 10_000 } })
    )
    await service.checkReadiness()

    plantThen(Array.prototype)
    await service.checkReadiness()
    removeThen(Array.prototype)
    const cached = await service.checkReadiness()
    plantThen(Array.prototype)
    await service.checkReadiness()
    removeThen(Array.prototype)

    expect(cached.status).toBe('ok')
    expect(warn.mock.calls.map(([entry]) => (entry as { event: string }).event)).toEqual([
      'CORE_HEALTH_RUNTIME_ALTERED',
      'CORE_HEALTH_RUNTIME_ALTERED'
    ])
  })

  it.each([
    ['Object.prototype', Object.prototype],
    ['Array.prototype', Array.prototype],
    ['Function.prototype', Function.prototype]
  ])('answers runtime down while a then is planted as an accessor on %s', async (_, owner) => {
    const service = new HealthService(
      [down],
      normalizeCoreOptions({ health: { readinessCacheMs: 0 } })
    )
    Object.defineProperty(owner, 'then', {
      get: () => (resolve: (value: unknown) => void) => resolve(FORGED_OK),
      configurable: true
    })

    const answer = await service.checkReadiness()
    removeThen(owner)

    expect(answer).toEqual(RUNTIME_DOWN)
  })

  it('reads a timed-out check as down under a foreign global Promise', async () => {
    const forged = { entry: { name: 'slow', status: 'up' }, isUp: true }
    const Service = loadUnderForeignPromise(forged, () => {
      let loaded!: typeof HealthService
      jest.isolateModules(() => {
        loaded = (require('./health.service') as { HealthService: typeof HealthService })
          .HealthService
      })
      return loaded
    })
    const service = new Service(
      [never],
      normalizeCoreOptions({ health: { indicatorTimeoutMs: 20 } })
    )

    expect(await service.checkReadiness()).toEqual({
      status: 'error',
      checks: [{ name: 'slow', status: 'down', details: { timedOutAfterMs: 20 } }]
    })
  })

  it('answers runtime down and caches nothing when a then is planted and removed mid-probe', async () => {
    let firstRun = true
    const swapper: IHealthIndicator = {
      name: 'swapper',
      check: () => {
        if (!firstRun) return Promise.resolve({ status: 'up' })
        firstRun = false
        plantThen(Object.prototype)
        return new Promise((resolve) =>
          setTimeout(() => {
            removeThen(Object.prototype)
            resolve({ status: 'up' })
          }, 5)
        )
      }
    }
    const service = new HealthService(
      [swapper],
      normalizeCoreOptions({ health: { readinessCacheMs: 1000 } })
    )

    const during = await service.checkReadiness()
    await new Promise((resolve) => setTimeout(resolve, 15))
    const after = await service.checkReadiness()

    expect(during).toEqual(RUNTIME_DOWN)
    expect(after).toEqual({ status: 'ok', checks: [{ name: 'swapper', status: 'up' }] })
  })

  it('answers runtime down when the constructor is swapped and restored while a check is pending', async () => {
    let timerFired: () => void = () => undefined
    const timer = new Promise<void>((done) => {
      timerFired = done
    })
    const swapper: IHealthIndicator = {
      name: 'swapper',
      check: () => {
        replaceConstructor()
        return new Promise((resolve) =>
          setTimeout(() => {
            restorePromise()
            resolve({ status: 'up' })
            timerFired()
          }, 5)
        )
      }
    }
    const service = new HealthService([swapper], normalizeCoreOptions())

    expect(await service.checkReadiness()).toEqual(RUNTIME_DOWN)
    await timer
  })

  it('leaves no unhandled rejection when a later check rejects while an earlier one is awaited', () => {
    const script = `
      const ts = require('typescript')
      require.extensions['.ts'] = (module, file) => {
        const { outputText } = ts.transpileModule(require('node:fs').readFileSync(file, 'utf8'), {
          compilerOptions: { module: 1, target: 9, experimentalDecorators: true, emitDecoratorMetadata: true }
        })
        module._compile(outputText, file)
      }
      const { HealthService } = require(${JSON.stringify(resolve(__dirname, 'health.service'))})
      const { normalizeCoreOptions } = require(${JSON.stringify(resolve(__dirname, '../core.options'))})
      let seen = 0
      process.on('unhandledRejection', () => { seen += 1 })
      const options = normalizeCoreOptions()
      String.prototype.slice = () => { throw new Error('slice broke') }
      const slow = { name: 'slow', check: () => new Promise((r) => setTimeout(() => r({ status: 'up' }), 40)) }
      const long = { name: 'long', check: async () => { throw new Error('x'.repeat(400)) } }
      new HealthService([slow, long], options).checkReadiness()
        .catch(() => undefined)
        .then(() => setTimeout(() => { console.log('unhandled=' + seen) }, 20))
    `
    const output = execFileSync(process.execPath, ['-e', script], {
      cwd: resolve(__dirname, '../..'),
      encoding: 'utf8'
    })

    expect(output.trim()).toBe('unhandled=0')
  })

  it('leaves no unhandled rejection when a check that was refused rejects afterwards', () => {
    const script = `
      const ts = require('typescript')
      require.extensions['.ts'] = (module, file) => {
        const { outputText } = ts.transpileModule(require('node:fs').readFileSync(file, 'utf8'), {
          compilerOptions: { module: 1, target: 9, experimentalDecorators: true, emitDecoratorMetadata: true }
        })
        module._compile(outputText, file)
      }
      const { HealthService } = require(${JSON.stringify(resolve(__dirname, 'health.service'))})
      const { normalizeCoreOptions } = require(${JSON.stringify(resolve(__dirname, '../core.options'))})
      let seen = 0
      process.on('unhandledRejection', () => { seen += 1 })
      const options = normalizeCoreOptions()
      const late = {
        name: 'late',
        check: () => {
          Object.defineProperty(Object.prototype, 'then', { value: 1, configurable: true, writable: true })
          return new Promise((_, reject) => setTimeout(() => reject(new Error('late')), 5))
        }
      }
      new HealthService([late], options).checkReadiness()
        .then(() => setTimeout(() => { console.log('unhandled=' + seen) }, 30))
    `
    const output = execFileSync(process.execPath, ['-e', script], {
      cwd: resolve(__dirname, '../..'),
      encoding: 'utf8'
    })

    expect(output.trim().split('\n').pop()).toBe('unhandled=0')
  })
})
