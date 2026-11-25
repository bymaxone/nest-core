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
