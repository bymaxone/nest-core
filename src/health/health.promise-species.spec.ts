/**
 * Tests for the readiness verdict beside a built-in an indicator replaced for good.
 *
 * Layer: integration.
 * Goal: an indicator that replaces the species accessor of `Promise`, or an `Array.prototype` method the
 * verdict is read through, never turns its own `down` into an `ok` answer.
 * Mocks: none; the first case replaces nothing, and every other case replaces a built-in for good, so it runs in a child process.
 */
import { resolve } from 'node:path'

import { normalizeCoreOptions } from '../core.options'
import { lastLineFromChild } from '../__tests__/promise-forgery.harness'
import { HealthService } from './health.service'

/** What a probe answered in a child where indicator `first` ran `plant` and answered up, and `db` answered down. */
function answerAfter(plant: string): string {
  return lastLineFromChild(`
    const { HealthService } = require(${JSON.stringify(resolve(__dirname, 'health.service'))})
    const { normalizeCoreOptions } = require(${JSON.stringify(resolve(__dirname, '../core.options'))})
    const first = { name: 'first', check: async () => { ${plant}; return { status: 'up' } } }
    const db = { name: 'db', check: async () => ({ status: 'down' }) }
    new HealthService([first, db], normalizeCoreOptions()).checkReadiness().then((answer) => {
      let line = answer.status + '|'
      for (let at = 0; at < answer.checks.length; at += 1) {
        line += (at > 0 ? ',' : '') + answer.checks[at].name + ':' + answer.checks[at].status
      }
      console.log(line)
    })
  `)
}

describe('the readiness verdict with nothing replaced', () => {
  it('answers error with each check in the order it was given, the later one down', async () => {
    const first = { name: 'first', check: async () => ({ status: 'up' as const }) }
    const db = { name: 'db', check: async () => ({ status: 'down' as const }) }

    const answer = await new HealthService([first, db], normalizeCoreOptions()).checkReadiness()

    expect([answer.status, answer.checks.map((one) => `${one.name}:${one.status}`)]).toEqual([
      'error',
      ['first:up', 'db:down']
    ])
  })
})

describe('the readiness verdict beside a replaced Promise[Symbol.species]', () => {
  it('answers runtime down while the species is an accessor that returns another constructor', () => {
    const seen = answerAfter(
      `Object.defineProperty(Promise, Symbol.species, { get() { return function Fake() {} }, configurable: true })`
    )

    expect(seen).toBe('error|runtime:down')
  })

  it('answers runtime down while the species is data and a get is planted on Object.prototype', () => {
    const seen = answerAfter(
      `Object.defineProperty(Promise, Symbol.species, { __proto__: null, value: Promise, configurable: true });` +
        ` Object.defineProperty(Object.prototype, 'get', { value: () => Promise, configurable: true, writable: true })`
    )

    expect(seen).toBe('error|runtime:down')
  })
})

describe('the readiness verdict beside an Array.prototype method an indicator replaced', () => {
  it.each([
    ['push', 'function () { return 0 }'],
    ['map', 'function () { return [] }'],
    ['every', 'function () { return true }']
  ])('keeps a later down check while %s answers nothing useful', (name, replacement) => {
    const seen = answerAfter(
      `Object.defineProperty(Array.prototype, '${name}', { value: ${replacement}, configurable: true, writable: true })`
    )

    expect(seen).toBe('error|first:up,db:down')
  })
})
