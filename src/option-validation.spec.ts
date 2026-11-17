/**
 * Unit tests for the helpers every option block shares.
 *
 * Layer: unit.
 * Goal: a value is described by its type, and only a number as itself; an unknown option's name is
 * shown up to a bound; a boolean, a string and a route option take only what they document and read
 * `null` and `undefined` as unset.
 * Mocks: none.
 */
import {
  booleanOption,
  checkedBlock,
  describeValue,
  refusal,
  routeOption,
  stringOption
} from './option-validation'

describe('describeValue', () => {
  it.each([
    [1.5, '1.5'],
    [Number.NaN, 'NaN'],
    [Number.POSITIVE_INFINITY, 'Infinity'],
    [null, 'null'],
    [undefined, 'undefined'],
    [[], 'an array'],
    [{}, 'an object'],
    ['secret', 'a string'],
    [Symbol('secret'), 'a symbol'],
    [() => 1, 'a function'],
    [BigInt(5), 'a bigint'],
    [true, 'a boolean']
  ])('describes %s as %s', (value, expected) => {
    expect(describeValue(value)).toBe(expected)
  })
})

describe('refusal', () => {
  it('names the option, what was expected and the type received', () => {
    expect(refusal('a.b', 'a thing', 'x').message).toBe('a.b must be a thing, received a string')
  })
})

describe('checkedBlock', () => {
  const known = { a: 0, b: 0 }

  it('returns an object that has only known keys, and undefined for an unset one', () => {
    const given = { a: 1 }
    expect(checkedBlock('blk', given, known)).toBe(given)
    expect(checkedBlock('blk', undefined, known)).toBeUndefined()
    expect(checkedBlock('blk', null, known)).toBeUndefined()
  })

  it('refuses what is not an object, a list included, by type', () => {
    expect(() => checkedBlock('blk', [], known)).toThrow('blk must be an object, received an array')
    expect(() => checkedBlock('blk', 'x', known)).toThrow(
      'blk must be an object, received a string'
    )
  })

  it('shows an unknown name in full up to 40 characters and cut after', () => {
    const forty = 'k'.repeat(40)
    expect(() => checkedBlock('blk', { [forty]: 1 }, known)).toThrow(
      `blk has an unknown option "${forty}"`
    )
    expect(() => checkedBlock('blk', { [`${forty}k`]: 1 }, known)).toThrow(
      `blk has an unknown option "${forty}…"`
    )
  })
})

describe('booleanOption, stringOption and routeOption', () => {
  it('take the fallback for an unset value and return a valid one as it is', () => {
    for (const unset of [undefined, null]) {
      expect(booleanOption('o', unset, true)).toBe(true)
      expect(stringOption('o', unset, 'f')).toBe('f')
      expect(routeOption('o', unset, 'docs')).toBe('docs')
    }
    expect(booleanOption('o', false, true)).toBe(false)
    expect(stringOption('o', '', 'f')).toBe('')
    expect(routeOption('o', '/docs', 'docs')).toBe('/docs')
  })

  it('refuse any other type, naming the option and the type', () => {
    expect(() => booleanOption('o', 'false', true)).toThrow(
      'o must be true or false, received a string'
    )
    expect(() => stringOption('o', 1, 'f')).toThrow('o must be a string, received 1')
    expect(() => routeOption('o', 'a b', 'docs')).toThrow(
      'o must be a route such as "docs", with no space, query or fragment, received a string'
    )
  })
})
