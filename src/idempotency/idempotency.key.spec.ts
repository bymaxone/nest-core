/**
 * Unit tests for the key grammar, the digest and the request fingerprint.
 *
 * Layer: unit.
 * Goal: a field's content never moves the boundary between two fields, the fingerprint ignores member
 * order and nothing else, and a body that cannot be represented whole is refused instead of hashed.
 * Mocks: none.
 */
import {
  canonicalBody,
  digest,
  fingerprint,
  UnfingerprintableBody,
  validKey
} from './idempotency.key'

const parts = { method: 'POST', path: '/a', query: '', body: { n: 1 } }

describe('validKey', () => {
  it.each(['a', 'x'.repeat(255), 'a-b_c.1~!"#'])('accepts %j', (key) => {
    expect(validKey(key)).toBe(key)
  })

  it.each(['', 'x'.repeat(256), 'a b', 'a\tb', 'café', 'a\u007f', 5, undefined, ['a']])(
    'refuses %j',
    (key) => {
      expect(validKey(key)).toBeUndefined()
    }
  )
})

describe('digest', () => {
  it('is 64 lower-case hex characters', () => {
    expect(digest(['a'])).toMatch(/^[0-9a-f]{64}$/)
  })

  it('keeps the boundary between fields whatever their content', () => {
    expect(digest(['a:b', 'c'])).not.toBe(digest(['a', 'b:c']))
    expect(digest(['1:a', ''])).not.toBe(digest(['', '1:a']))
    expect(digest(['ab', ''])).not.toBe(digest(['a', 'b']))
  })
})

describe('canonicalBody', () => {
  it('is empty for no body and sorts members at every depth', () => {
    expect(canonicalBody(undefined)).toBe('')
    expect(canonicalBody({ b: [1, { z: 1, a: undefined, y: null }], a: 'x' })).toBe(
      '{"a":"x","b":[1,{"y":null,"z":1}]}'
    )
  })

  it('reads an undefined element and a hole in an array as null, as JSON does', () => {
    expect(canonicalBody([1, undefined, 3])).toBe('[1,null,3]')
    expect(canonicalBody(new Array<unknown>(1))).toBe('[null]')
    expect(canonicalBody(new Array<unknown>(2))).not.toBe(canonicalBody([]))
  })

  it('sorts keys by code unit, not by locale', () => {
    expect(canonicalBody({ b: 1, B: 2, a: 3 })).toBe('{"B":2,"a":3,"b":1}')
  })

  it('accepts a null-prototype object', () => {
    expect(canonicalBody(Object.assign(Object.create(null) as object, { a: true }))).toBe(
      '{"a":true}'
    )
  })

  /** An object as a query-string parser builds one: its prototype is empty and has no prototype. */
  function parsed(fields: object, prototype: object = Object.create(null) as object): object {
    return Object.defineProperties(
      Object.create(prototype) as object,
      Object.getOwnPropertyDescriptors(fields)
    )
  }

  it('reads a parser result, empty or with arrays and prototype names, as its own data', () => {
    expect(canonicalBody(parsed({}))).toBe('{}')
    expect(
      canonicalBody(
        parsed(JSON.parse('{"b":["1","2"],"__proto__":"p","constructor":"c"}') as object)
      )
    ).toBe('{"__proto__":"p","b":["1","2"],"constructor":"c"}')
  })

  it.each([
    [
      'a parser-like prototype that has a member',
      parsed({}, Object.assign(Object.create(null) as object, { inherited: 1 }))
    ],
    [
      'a parser-like prototype that has an accessor',
      parsed({}, Object.create(null, { trap: { get: () => 1, enumerable: false } }) as object)
    ],
    [
      'a prototype with a prototype under it',
      parsed({}, Object.create(Object.create(null) as object) as object)
    ],
    [
      'an own accessor on a plain object',
      Object.defineProperty({}, 'a', { get: () => 1, enumerable: true })
    ],
    [
      'a setter with no getter',
      Object.defineProperty({}, 'a', { set: jest.fn(), enumerable: true })
    ],
    [
      'an own accessor on a parser result',
      parsed({
        get a() {
          return 1
        }
      })
    ]
  ])('refuses %s', (_name, body) => {
    expect(() => canonicalBody(body)).toThrow(UnfingerprintableBody)
  })

  it('does not call an accessor it refuses', () => {
    const get = jest.fn(() => 1)

    expect(() => canonicalBody(Object.defineProperty({}, 'a', { get, enumerable: true }))).toThrow(
      UnfingerprintableBody
    )
    expect(get).not.toHaveBeenCalled()
  })

  it.each([
    ['a Buffer', Buffer.from('x')],
    ['a Map', new Map()],
    ['a class instance', new (class Widget {})()],
    ['NaN', Number.NaN],
    ['a function', () => 1],
    ['a bigint', 1n],
    ['a body deeper than 32', Array.from({ length: 40 }).reduce<unknown>((inner) => [inner], 1)]
  ])('refuses %s', (_name, body) => {
    expect(() => canonicalBody(body)).toThrow(UnfingerprintableBody)
  })
})

describe('canonicalBody, the depth bound', () => {
  const nest = (levels: number, wrap: (inner: unknown) => unknown): unknown =>
    Array.from({ length: levels }).reduce<unknown>((inner) => wrap(inner), 1)

  it.each([
    ['arrays', (inner: unknown) => [inner]],
    ['objects', (inner: unknown) => ({ a: inner })]
  ])('accepts 32 levels of %s and refuses 33', (_name, wrap) => {
    expect(() => canonicalBody(nest(32, wrap))).not.toThrow()
    expect(() => canonicalBody(nest(33, wrap))).toThrow(UnfingerprintableBody)
  })
})

describe('fingerprint', () => {
  it('ignores member order and nothing else', () => {
    const same = fingerprint({ ...parts, body: { n: 1, a: 2 } })

    expect(fingerprint({ ...parts, body: { a: 2, n: 1 } })).toBe(same)
    expect(fingerprint({ ...parts, method: 'PUT', body: { n: 1, a: 2 } })).not.toBe(same)
    expect(fingerprint({ ...parts, path: '/b', body: { n: 1, a: 2 } })).not.toBe(same)
    expect(fingerprint({ ...parts, query: 'x=1', body: { n: 1, a: 2 } })).not.toBe(same)
    expect(fingerprint({ ...parts, body: { n: 1, a: 3 } })).not.toBe(same)
  })

  it('keeps path and query apart', () => {
    expect(fingerprint({ ...parts, path: '/a?b', query: 'c' })).not.toBe(
      fingerprint({ ...parts, path: '/a', query: 'b?c' })
    )
  })
})
