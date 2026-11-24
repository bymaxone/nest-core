/**
 * Tests for options read while a getter of the host replaces a built-in the copy is made with.
 *
 * Layer: integration.
 * Goal: a getter that replaces `Array.prototype` or `Set.prototype` members when it is read cannot drop, add or
 * refuse an item of the options being copied.
 * Mocks: none; the first case replaces nothing, and every other case replaces a built-in for good, so it runs in a child process.
 */
import { resolve } from 'node:path'

import { lastLineFromChild } from './__tests__/promise-forgery.harness'
import { readOptions } from './read-options'

/**
 * The options as `readOptions` returned them, in a child where the host's getter for `key` ran `plant`
 * and answered `value`.
 */
function readAfter(shape: string, key: string, plant: string, value: string): string {
  return lastLineFromChild(`
    const { readOptions } = require(${JSON.stringify(resolve(__dirname, 'read-options'))})
    const given = {}
    Object.defineProperty(given, '${key}', { get() { ${plant}; return ${value} }, enumerable: true })
    let line
    try { line = JSON.stringify(readOptions(given, ${shape})) } catch (error) { line = 'refused' }
    process.stdout.write(line + '\\n')
  `)
}

/** A built-in member replaced for good with a function that does what `body` says. */
function replace(owner: string, name: string, body: string): string {
  return `Object.defineProperty(${owner}, ${name}, { value: function () { ${body} }, configurable: true, writable: true })`
}

describe('options read with nothing replaced', () => {
  it('copies a list of maps, a list of blocks and a map of settings whole', () => {
    const given = {
      list: [{ a: 1 }, { b: 2 }],
      blocks: [{ n: 1 }, { n: 2 }],
      named: { a: 1, b: 2 }
    }

    const copy = readOptions(given, { list: 0, blocks: [{ n: 0 }], named: 1 })

    expect(JSON.stringify(copy)).toBe(
      '{"list":[{"a":1},{"b":2}],"blocks":[{"n":1},{"n":2}],"named":{"a":1,"b":2}}'
    )
  })
})

describe('options read while a getter replaces a built-in the copy is made with', () => {
  it.each([
    ['Array.prototype.push', replace('Array.prototype', "'push'", 'return 0')],
    ['Array.prototype.includes', replace('Array.prototype', "'includes'", 'return true')],
    [
      'Array.prototype[Symbol.iterator]',
      replace('Array.prototype', 'Symbol.iterator', 'return [].values()')
    ]
  ])('copies a list of maps whole while %s is replaced', (_name, plant) => {
    const seen = readAfter('{ list: 0 }', 'list', plant, '[{ a: 1 }, { b: 2 }]')

    expect(seen).toBe('{"list":[{"a":1},{"b":2}]}')
  })

  it('reads every block of a list of blocks while Array.prototype.map is replaced', () => {
    const seen = readAfter(
      '{ blocks: [{ n: 0 }] }',
      'blocks',
      replace('Array.prototype', "'map'", 'return []'),
      '[{ n: 1 }, { n: 2 }]'
    )

    expect(seen).toBe('{"blocks":[{"n":1},{"n":2}]}')
  })

  it.each([
    ['Set.prototype.add', replace('Set.prototype', "'add'", 'return this')],
    [
      'Array.prototype[Symbol.iterator]',
      replace('Array.prototype', 'Symbol.iterator', 'return [].values()')
    ]
  ])('reads every name of a map of settings while %s is replaced', (_name, plant) => {
    const seen = readAfter('{ named: 1 }', 'named', plant, '{ a: 1, b: 2 }')

    expect(seen).toBe('{"named":{"a":1,"b":2}}')
  })
})
