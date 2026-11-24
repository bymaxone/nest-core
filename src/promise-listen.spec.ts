/**
 * Tests for a value a listener could not be attached to.
 *
 * Layer: integration.
 * Goal: a native promise that cannot be listened to is never reported settled, so a scrape run stays in
 * flight while its work is pending, and a value that is not a promise at all is refused or settled
 * without an unhandled rejection.
 * Mocks: none; the cases that plant a foreign `constructor` run in a child process.
 */
import { lastLineFromChild } from './__tests__/promise-forgery.harness'
import { afterSettled, hear } from './object-prototype'

describe('a value whose prototype cannot be read', () => {
  it('is reported settled by afterSettled and heard by hear without throwing', async () => {
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()

    await expect(afterSettled(proxy as never)).resolves.toBeUndefined()
    expect(() => hear(proxy as never)).not.toThrow()
  })
})

describe('a pending promise whose foreign constructor makes attaching a listener throw', () => {
  /** A pending native promise whose non-configurable foreign `constructor` has a throwing `Symbol.species`. */
  const STUCK = `
    const Foreign = function Foreign() {}
    Object.defineProperty(Foreign, Symbol.species, { get() { throw new Error('species') } })
    const stuck = (ms) => {
      const promise = new Promise((resolve) => setTimeout(resolve, ms))
      Object.defineProperty(promise, 'constructor', { value: Foreign, writable: false, configurable: false })
      return promise
    }
  `

  it('does not resolve afterSettled while the promise is pending', () => {
    const output = lastLineFromChild(`
      ${STUCK}
      const { afterSettled } = require('./src/object-prototype')
      let done = 0
      void (async () => { await afterSettled(stuck(40)); done += 1 })()
      setTimeout(() => console.log('done=' + done), 20)
    `)

    expect(output).toBe('done=0')
  })

  it('starts no second scrape collection while the first is pending', () => {
    const output = lastLineFromChild(`
      ${STUCK}
      const { createMetricsController } = require('./src/metrics/metrics.controller')
      const { normalizeCoreOptions } = require('./src/core.options')
      let calls = 0
      const pending = stuck(150)
      const registry = { contentType: 'text/plain', metrics: () => { calls += 1; return pending } }
      const host = { httpAdapter: { setHeader() {}, reply() {} } }
      const Controller = createMetricsController('metrics')
      const controller = new Controller(registry, normalizeCoreOptions({ metrics: { enabled: true, path: 'metrics' } }), host)
      controller.scrape({}, {}).catch(() => undefined)
      setTimeout(() => controller.scrape({}, {}).catch(() => undefined), 30)
      setTimeout(() => console.log('calls=' + calls), 80)
    `)

    expect(output).toBe('calls=1')
  })
})

describe('a revoked proxy returned where a promise is expected', () => {
  it('is refused without an unhandled rejection', () => {
    const output = lastLineFromChild(`
      const { ownIntrinsicConstructor } = require('./src/object-prototype')
      const { proxy, revoke } = Proxy.revocable({}, {})
      revoke()
      let unhandled = 0
      process.on('unhandledRejection', () => { unhandled += 1 })
      let refused = 0
      try { ownIntrinsicConstructor(proxy) } catch { refused = 1 }
      setTimeout(() => console.log('refused=' + refused + ' unhandled=' + unhandled), 20)
    `)

    expect(output).toBe('refused=1 unhandled=0')
  })
})
