/**
 * Unit tests for the map read by every name it answers to, and for a list item behind a proxy.
 *
 * Layer: unit.
 * Goal: a map option read by name (the policy `directives`) keeps what a class holds as prototype
 * accessors and what an own property keeps non-enumerable, once per name and with the own one winning;
 * a symbol is ignored, a throwing getter is a boot error with its cause, and too many names are refused.
 * A list whose item is a proxy listing no keys is refused, a plain empty item is kept.
 * Mocks: none.
 */
import { readOptions } from './read-options'
import type { Shape } from './read-options'

const NAMED: Shape = { map: 1 }
const LISTED: Shape = { list: 0 }
const SECURED: Shape = { security: 0, operationSecurity: 0, securitySchemes: 0, other: 0 }

/** What `readOptions` returns for `map`, read as the map option. */
function read(map: unknown): Record<string, unknown> {
  const copy = readOptions({ map }, NAMED) as { map: Record<string, unknown> }
  return copy.map
}

/** The error `readOptions` throws for `given`. */
function refusal(given: unknown, shape: Shape): Error {
  try {
    readOptions(given, shape)
  } catch (error) {
    return error as Error
  }
  throw new Error('not refused')
}

describe('a map option read by every name it answers to', () => {
  it('keeps what a class holds as prototype accessors', () => {
    class Holder {
      get defaultSrc(): string[] {
        return ["'none'"]
      }
    }
    expect(read(new Holder())).toEqual({ defaultSrc: ["'none'"] })
  })

  it('keeps a non-enumerable own getter', () => {
    const held = {}
    Object.defineProperty(held, 'defaultSrc', { get: () => ["'none'"] })
    expect(read(held)).toEqual({ defaultSrc: ["'none'"] })
  })

  it('reads each name once and lets the own one win over an inherited one', () => {
    let reads = 0
    const base = {
      get scriptSrc(): string[] {
        reads += 100
        return ['base']
      },
      styleSrc: ['base']
    }
    const held = Object.create(base) as Record<string, unknown>
    Object.defineProperty(held, 'scriptSrc', {
      get: () => {
        reads += 1
        return ['own']
      },
      enumerable: true
    })
    expect(read(held)).toEqual({ scriptSrc: ['own'], styleSrc: ['base'] })
    expect(reads).toBe(1)
  })

  it('ignores a symbol key, and does not take the constructor of a class', () => {
    class Holder {
      defaultSrc = ['x']
    }
    const held = new Holder() as unknown as Record<PropertyKey, unknown>
    held[Symbol('s')] = ['y']
    expect(Object.keys(read(held))).toEqual(['defaultSrc'])
    expect(Reflect.ownKeys(read(held))).toEqual(['defaultSrc'])
  })

  it('leaves what is not a block as it is, for the policy check to refuse', () => {
    expect(read('self')).toBe('self')
    expect(read(['self'])).toEqual(['self'])
  })

  it('does not take a method a class holds as a name', () => {
    class Holder {
      defaultSrc = ['x']
      describe(): string {
        return 'x'
      }
    }
    expect(Object.keys(read(new Holder()))).toEqual(['defaultSrc'])
  })

  it('turns a getter that throws into a boot error with what it threw as the cause', () => {
    const held = {
      get defaultSrc(): string[] {
        throw new Error('SECRET')
      }
    }
    const error = refusal({ map: held }, NAMED)
    expect(error.message).toBe('the options could not be read')
    expect((error.cause as Error).message).toBe('SECRET')
  })

  it('refuses a proxy that answers itself as its prototype, instead of walking for ever', () => {
    const held: object = new Proxy({ defaultSrc: ["'none'"] }, { getPrototypeOf: () => held })
    const error = refusal({ map: held }, NAMED)
    expect(error.message).toBe('the options could not be read')
    expect(error.cause).toMatchObject({ message: 'an option is too large' })
  })

  it('refuses a map whose prototype chain is one link past the limit', () => {
    let held: object = { defaultSrc: ['x'] }
    for (let i = 0; i < 1001; i += 1) held = Object.create(held) as object
    const error = refusal({ map: held }, NAMED)
    expect(error.cause).toMatchObject({ message: 'an option is too large' })
  })

  it('keeps a map whose prototype chain is exactly as long as the limit allows', () => {
    let held: object = { defaultSrc: ['x'] }
    for (let i = 0; i < 1000; i += 1) held = Object.create(held) as object
    expect(Object.keys(read(held))).toEqual(['defaultSrc'])
  })

  it('keeps a map that answers to exactly the limit', () => {
    const held = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`k${i}`, 1]))
    expect(Object.keys(read(held))).toHaveLength(1000)
  })

  it('refuses a map that answers to more names than the limit', () => {
    const held = Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`k${i}`, 1]))
    const error = refusal({ map: held }, NAMED)
    expect(error.cause).toMatchObject({ message: 'an option is too large' })
  })
})

describe('a list item behind a proxy that lists no keys', () => {
  it('refuses a requirement that is a proxy over an empty object', () => {
    const item = new Proxy({}, { get: () => ['read'] })
    const error = refusal({ security: [item] }, SECURED)
    expect((error.cause as Error).cause).toMatchObject({
      message: 'A proxy lists no keys'
    })
  })

  it('refuses a requirement behind a proxy deeper in a map, as operationSecurity and securitySchemes hold them', () => {
    const item = new Proxy({}, { get: () => ['read'] })
    const deep = refusal({ operationSecurity: { 'A.b': [item] } }, SECURED)
    expect((deep.cause as Error).cause).toMatchObject({
      message: 'A proxy lists no keys'
    })
    const scheme = refusal({ securitySchemes: { bearer: item } }, SECURED)
    expect((scheme.cause as Error).cause).toMatchObject({
      message: 'A proxy lists no keys'
    })
  })

  it('keeps a block that is a proxy over an empty object as an empty block, as a block is read by name', () => {
    expect(readOptions({ block: new Proxy({}, {}) }, { block: { name: 0 } })).toEqual({ block: {} })
  })

  it('refuses a requirement proxy that answers a class prototype, and a symbol-only one', () => {
    class Foo {}
    const asFoo = new Proxy({}, { getPrototypeOf: () => Foo.prototype })
    const symbolic = new Proxy({ [Symbol('hidden')]: [] }, {})

    expect((refusal({ security: [asFoo] }, SECURED).cause as Error).cause).toMatchObject({
      message: 'A proxy lists no keys'
    })
    expect((refusal({ security: [symbolic] }, SECURED).cause as Error).cause).toMatchObject({
      message: 'A proxy lists no keys'
    })
    expect(refusal({ other: asFoo }, SECURED).cause).toMatchObject({
      message: 'an option is held behind a proxy that lists no keys'
    })
  })

  it('keeps a proxy over an empty object in an option that holds no requirement', () => {
    const extension = new Proxy({}, { get: () => 'x' })
    expect(readOptions({ other: { value: extension } }, SECURED)).toEqual({ other: { value: {} } })
  })

  it('reads the keys once: an ownKeys trap that lists them once and none after is copied whole', () => {
    let calls = 0
    const item = new Proxy(
      { bearer: [] },
      { ownKeys: (target) => (++calls === 1 ? Reflect.ownKeys(target) : []) }
    )
    expect(readOptions({ list: [item] }, LISTED)).toEqual({ list: [{ bearer: [] }] })
  })

  it('judges the copy of directives too: a flipping ownKeys trap does not give an empty map', () => {
    let calls = 0
    const held = new Proxy(
      { defaultSrc: ["'none'"] },
      { ownKeys: (target) => (++calls === 1 ? Reflect.ownKeys(target) : []) }
    )
    expect(readOptions({ map: held }, NAMED)).toEqual({ map: { defaultSrc: ["'none'"] } })
  })

  it('copies a requirement kept in a property that is not enumerable as an enumerable one', () => {
    const item = Object.defineProperty({}, 'bearer', { value: [], enumerable: false })
    const read = readOptions({ list: [item] }, LISTED) as { list: Array<Record<string, unknown>> }
    expect(Object.keys(read.list[0] ?? {})).toEqual(['bearer'])
  })

  it('reads each item once, so the item that is checked is the item that is copied', () => {
    const items: unknown[] = []
    let reads = 0
    Object.defineProperty(items, 0, {
      get: () => {
        reads += 1
        return reads === 1 ? { bearer: [] } : new Proxy({}, { get: () => [] })
      },
      enumerable: true
    })
    expect(readOptions({ list: items }, LISTED)).toEqual({ list: [{ bearer: [] }] })
    expect(reads).toBe(1)
  })

  it('reads an array subclass by its indexes, not by an iterator that disagrees with them', () => {
    class Listed extends Array<unknown> {
      override [Symbol.iterator](): ArrayIterator<unknown> {
        return [{}][Symbol.iterator]()
      }
    }
    const items = new Listed()
    items.push({ bearer: [] })
    expect(readOptions({ list: items }, LISTED)).toEqual({ list: [{ bearer: [] }] })
  })

  it('refuses a list longer than the limit, and keeps one of exactly the limit', () => {
    const exact = Array.from({ length: 1000 }, () => 1)
    expect(readOptions({ list: exact }, LISTED)).toEqual({ list: exact })
    const error = refusal({ list: [...exact, 1] }, LISTED)
    expect(error.cause).toMatchObject({ message: 'an option is too large' })
  })

  it.each([1000.5, 0.5, -1, Number.NaN, Number.POSITIVE_INFINITY, 1001, '3', undefined, null])(
    'refuses a list whose length is %p, which is not an integer from 0 to the limit',
    (length) => {
      const list = new Proxy([], {
        get: (target, key, receiver) =>
          key === 'length'
            ? length
            : /^\d+$/.test(String(key))
              ? 1
              : Reflect.get(target, key, receiver)
      })
      const error = refusal({ list }, LISTED)
      expect(error.cause).toMatchObject({ message: 'an option is too large' })
    }
  )

  it('keeps an empty list, a one-item list and a list with a hole', () => {
    expect(readOptions({ list: [] }, LISTED)).toEqual({ list: [] })
    expect(readOptions({ list: [{}] }, LISTED)).toEqual({ list: [{}] })
    const holey: unknown[] = new Array<unknown>(3)
    holey[0] = 1
    holey[2] = 3
    expect(readOptions({ list: holey }, LISTED)).toEqual({ list: [1, undefined, 3] })
  })

  it('keeps a plain empty requirement', () => {
    expect(readOptions({ list: [{}] }, LISTED)).toEqual({ list: [{}] })
  })
})
