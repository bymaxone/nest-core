/**
 * Tests for the built-ins a decision path calls, replaced after this package loaded.
 *
 * Layer: unit.
 * Goal: replacing a collection, string, regular expression or iterator method that a decision path
 * calls makes the guard refuse, and `builtinsAltered` answer `true`; restoring it makes both clean again.
 * A name the guard does not read, added to a watched owner, changes neither answer.
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

describe('the guard beside a name it never reads on a watched owner', () => {
  it.each([
    ['Set.prototype', Set.prototype],
    ['Map.prototype', Map.prototype],
    ['String.prototype', String.prototype],
    ['Array.prototype', Array.prototype],
    ['RegExp.prototype', RegExp.prototype],
    ['the array iterator prototype', iteratorOf([][Symbol.iterator]())],
    ['the set iterator prototype', iteratorOf(new Set().values())]
  ] as const)('does not count an own "undefined" on %s as a replaced built-in', (_name, owner) => {
    Object.defineProperty(owner, 'undefined', { value: () => 0, configurable: true })
    try {
      expect(builtinsAltered()).toBe(false)
      expect(() => assertObjectPrototypeClean()).not.toThrow()
    } finally {
      delete (owner as Record<string, unknown>)['undefined']
    }
  })
})

describe('the guard beside what a host replaces by design', () => {
  it('stays clean under fake timers and a wrapped Promise.prototype.then', () => {
    jest.useFakeTimers()
    const then = Promise.prototype.then
    Promise.prototype.then = function wrapped(
      this: Promise<unknown>,
      ...args: Parameters<typeof Promise.prototype.then>
    ) {
      return then.apply(this, args)
    } as typeof then
    try {
      expect(builtinsAltered()).toBe(false)
      expect(() => assertObjectPrototypeClean()).not.toThrow()
    } finally {
      Promise.prototype.then = then
      jest.useRealTimers()
    }
  })
})
