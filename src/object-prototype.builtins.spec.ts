/**
 * Tests for the built-ins a decision path calls, replaced after this package loaded.
 *
 * Layer: unit.
 * Goal: replacing a collection, string, regular expression, date or iterator method that a decision path
 * calls makes the guard refuse, and `builtinsAltered` answer `true`; restoring it makes both clean again.
 * Mocks: none; the real built-ins, put back after each row.
 */
import { assertObjectPrototypeClean, builtinsAltered } from './object-prototype'

const iteratorOf = (value: object): object => Object.getPrototypeOf(value) as object

describe('the guard beside a replaced decision-path built-in', () => {
  it.each([
    ['Set.prototype.has', Set.prototype, 'has'],
    ['Set.prototype[Symbol.iterator]', Set.prototype, Symbol.iterator],
    ['Map.prototype.get', Map.prototype, 'get'],
    ['Map.prototype.has', Map.prototype, 'has'],
    ['String.prototype.split', String.prototype, 'split'],
    ['String.prototype.slice', String.prototype, 'slice'],
    ['String.prototype.replace', String.prototype, 'replace'],
    ['Array.prototype.join', Array.prototype, 'join'],
    ['Array.prototype.slice', Array.prototype, 'slice'],
    ['Array.prototype.filter', Array.prototype, 'filter'],
    ['Array.prototype.includes', Array.prototype, 'includes'],
    ['Array.prototype[Symbol.iterator]', Array.prototype, Symbol.iterator],
    ['RegExp.prototype[Symbol.replace]', RegExp.prototype, Symbol.replace],
    ['Date.prototype.toISOString', Date.prototype, 'toISOString'],
    ['the array iterator next', iteratorOf([][Symbol.iterator]()), 'next'],
    ['the set iterator next', iteratorOf(new Set().values()), 'next']
  ] as const)(
    'refuses while %s is replaced, and is clean once it is put back',
    (_name, owner, key) => {
      const original = Object.getOwnPropertyDescriptor(owner, key) as PropertyDescriptor
      let refused: unknown
      let altered = false
      Object.defineProperty(owner, key, { ...original, value: original.value.bind(null) })
      try {
        altered = builtinsAltered()
        try {
          assertObjectPrototypeClean()
        } catch (error) {
          refused = error
        }
      } finally {
        Object.defineProperty(owner, key, original)
      }

      expect(altered).toBe(true)
      expect((refused as Error | undefined)?.message).toBe(
        'Object.prototype holds names or changes this package cannot run beside'
      )
      expect(builtinsAltered()).toBe(false)
      expect(() => assertObjectPrototypeClean()).not.toThrow()
    }
  )
})
