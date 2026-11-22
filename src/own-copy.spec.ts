/**
 * Unit tests for the own copy of what a host hands over.
 *
 * Layer: unit.
 * Goal: plain objects and lists are copied at every depth, including a null-prototype object; a
 * cycle and a nesting past the limit are refused with a message; anything else is kept as it is; a
 * proxy that throws is refused by the copy and never reached afterwards.
 * Mocks: none.
 */
import { types } from 'node:util'
import { runInNewContext } from 'node:vm'

import { ownCopy } from './own-copy'

/** `count` wrappers nested one inside the other, the innermost holding `leaf`. */
function nested(count: number, leaf: unknown, wrap: (inner: unknown) => unknown): unknown {
  let value = leaf
  for (let level = 0; level < count; level += 1) value = wrap(value)
  return value
}

describe('ownCopy', () => {
  it('copies a plain object and a list at every depth, as new objects', () => {
    const source = { a: [{ b: 1 }, 2], c: { d: { e: 'x' } } }

    const copy = ownCopy(source) as typeof source

    expect(copy).toEqual(source)
    expect(copy).not.toBe(source)
    expect(copy.a).not.toBe(source.a)
    expect(copy.a[0]).not.toBe(source.a[0])
    expect(copy.c.d).not.toBe(source.c.d)
  })

  it('copies a null-prototype object as a plain one', () => {
    const source = Object.assign(Object.create(null) as object, { key: 'value' })

    const copy = ownCopy(source) as Record<string, unknown>

    expect(copy).toEqual({ key: 'value' })
    expect(copy).not.toBe(source)
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype)
  })

  it('copies a property that is not enumerable as an enumerable one, with its value read once', () => {
    let reads = 0
    const source = Object.defineProperty({ shown: 1 }, 'hidden', {
      get: () => {
        reads += 1
        return 'secret'
      }
    })

    const copy = ownCopy(source) as Record<string, unknown>

    expect(copy['hidden']).toBe('secret')
    expect(Object.keys(copy)).toEqual(['shown', 'hidden'])
    expect(Object.getOwnPropertyDescriptor(copy, 'hidden')?.enumerable).toBe(true)
    expect(reads).toBe(1)
  })

  it('copies a proxy that lists no keys as an empty map, where it is not a security requirement', () => {
    const source = { extension: new Proxy({}, {}), schema: { example: new Proxy({}, {}) } }

    expect(ownCopy(source)).toStrictEqual({ extension: {}, schema: { example: {} } })
  })

  it('refuses a proxy that lists no keys where an operation or a component holds a security list', () => {
    const operation = { security: [new Proxy({}, {})] }

    expect(() => ownCopy({ operation })).toThrow('A requirement cannot be a proxy')
    expect(() => ownCopy({ components: { x: operation } })).toThrow(
      'A requirement cannot be a proxy'
    )
  })

  it('refuses the proxy however the shared object is reached: first as an extension, then as a requirement', () => {
    const shared = new Proxy({}, { get: () => ['read'] })

    expect(() => ownCopy({ operation: { 'x-data': shared, security: [shared] } })).toThrow(
      'A requirement cannot be a proxy'
    )
    expect(() => ownCopy({ a: { extension: shared }, b: { security: [shared] } })).toThrow(
      'A requirement cannot be a proxy'
    )
  })

  it('copies an empty proxy under a field that is only named security, not a list of requirements', () => {
    const schema = { properties: { security: new Proxy({}, {}) } }

    expect(ownCopy({ components: { schemas: { Account: schema } } })).toStrictEqual({
      components: { schemas: { Account: { properties: { security: {} } } } }
    })
  })

  it('copies an empty proxy in a list that no security key holds, and refuses a proxy that lists keys in a security list', () => {
    expect(ownCopy({ examples: [new Proxy({}, {})] })).toStrictEqual({ examples: [{}] })
    expect(() => ownCopy({ security: [new Proxy({ bearer: [] }, {})] })).toThrow(
      'A requirement cannot be a proxy'
    )
  })

  it('copies a proxy whatever prototype it answers where it is not strict, and refuses it where it is', () => {
    class Foo {}
    const asFoo = (target: object): object =>
      new Proxy(target, { getPrototypeOf: () => Foo.prototype })

    expect(() => ownCopy({ security: [asFoo({})] })).toThrow('A requirement cannot be a proxy')
    expect(() => ownCopy({ security: [asFoo({ a: [] })] })).toThrow(
      'A requirement cannot be a proxy'
    )
    const copied = ownCopy({ extension: asFoo({ a: 1 }) }) as { extension: object }
    expect(types.isProxy(copied.extension)).toBe(false)
    expect(copied.extension).toStrictEqual({ a: 1 })
  })

  it('refuses a proxy that lists only a symbol key in a security list', () => {
    const symbolic = new Proxy({ [Symbol('hidden')]: [] }, {})

    expect(() => ownCopy({ security: [symbolic] })).toThrow('A requirement cannot be a proxy')
  })

  it('reads the length of a list once, so a length that grows on every read ends', () => {
    let reads = 0
    const list = new Proxy(['only'], {
      get: (target, key, receiver) =>
        key === 'length' ? (reads += 1) : Reflect.get(target, key, receiver)
    })

    expect(ownCopy({ list })).toStrictEqual({ list: ['only'] })
    expect(reads).toBe(1)
  })

  it('reads each item that is there once, by its index, and refuses a hole', () => {
    const reads = [0, 0, 0]
    const list: unknown[] = new Array<unknown>(3)
    for (const index of [0, 1, 2]) {
      Object.defineProperty(list, index, {
        get: () => {
          reads[index] = (reads[index] ?? 0) + 1
          return `item ${index}`
        },
        enumerable: true
      })
    }

    expect(ownCopy({ list })).toStrictEqual({ list: ['item 0', 'item 1', 'item 2'] })
    expect(reads).toStrictEqual([1, 1, 1])

    const holey: unknown[] = new Array<unknown>(3)
    holey[0] = 1
    holey[2] = 3
    expect(() => ownCopy({ list: holey })).toThrow('A list has a hole')
  })

  it.each([Number.NaN, -1, 1.5, '2', undefined, { valueOf: (): number => 1 }])(
    'refuses a list proxy whose length answers %p: a real list has an integer length',
    (length) => {
      const list = new Proxy([], {
        get: (target, key, receiver) =>
          key === 'length' ? length : Reflect.get(target, key, receiver)
      })

      expect(() => ownCopy({ list })).toThrow('A list is too long')
    }
  )

  it('refuses a security list that is a proxy, whatever length it answers', () => {
    const security = new Proxy([{ bearer: [] }], {
      get: (target, key, receiver) =>
        key === 'length' ? Number.NaN : Reflect.get(target, key, receiver)
    })

    expect(() => ownCopy({ operation: { security } })).toThrow('A requirement cannot be a proxy')
  })

  it.each([Number.POSITIVE_INFINITY, 2 ** 31, 100_001])(
    'refuses a list proxy whose length is %p instead of copying that many items',
    (length) => {
      const list = new Proxy([], {
        get: (target, key, receiver) =>
          key === 'length' ? length : Reflect.get(target, key, receiver)
      })

      expect(() => ownCopy({ list })).toThrow('A list is too long')
    }
  )

  it('copies a list of exactly the longest length allowed', () => {
    const list = Array.from({ length: 100_000 }, () => 0)

    expect((ownCopy({ list }) as { list: unknown[] }).list).toHaveLength(100_000)
  })

  it('copies exactly as much as the work limit allows, and refuses one more', () => {
    const listOf = (length: number): number[] => Array.from({ length }, () => 0)
    // The key `list` counts 1, the outer list 10, and the inner lists the rest of the 1,000,000.
    const inner = [...Array.from({ length: 9 }, () => listOf(100_000)), listOf(99_989)]

    expect(() => ownCopy({ list: inner })).not.toThrow()
    expect(() => ownCopy({ list: [...inner.slice(0, 9), listOf(99_990)] })).toThrow(
      'A value is too large'
    )
  })

  it('refuses a copy that would do more work than the limit, however it is nested', () => {
    const wide = (levels: number): unknown[] =>
      new Proxy([], {
        has: () => true,
        get: (target, key, receiver) => {
          if (key === 'length') return 2000
          return typeof key === 'string' && /^\d+$/.test(key)
            ? levels > 0
              ? wide(levels - 1)
              : 1
            : Reflect.get(target, key, receiver)
        }
      })

    expect(() => ownCopy({ list: wide(3) })).toThrow('A value is too large')
  })

  it('refuses a copy whose single object is too wide for the work limit', () => {
    const wide = new Proxy(
      {},
      {
        ownKeys: () => Array.from({ length: 1_000_001 }, (_, index) => `key${index}`),
        getOwnPropertyDescriptor: () => ({ value: 1, enumerable: true, configurable: true })
      }
    )

    expect(() => ownCopy({ wide })).toThrow('A value is too large')
  })

  it.each([
    ['a method such as toJSON', () => ({ toJSON: () => ({}) })],
    ['a function', () => ({ check: (): void => undefined })],
    ['a symbol', () => ({ tag: Symbol('x') })]
  ])('refuses %s held in what is copied strictly, and keeps it elsewhere', (_name, make) => {
    expect(() => ownCopy({ security: [make()] })).toThrow('A requirement must be plain data')
    expect(() => ownCopy({ extension: make() })).not.toThrow()
  })

  it('keeps a requirement with no prototype as a plain copy, where it is strict', () => {
    const bare = Object.assign(Object.create(null) as object, { bearer: ['read'] })

    expect(ownCopy({ security: [bare] })).toStrictEqual({ security: [{ bearer: ['read'] }] })
  })

  it('refuses, where it is strict, an object the checks take for a record but is not plain', () => {
    class Held {
      get bearer(): string[] {
        return []
      }
    }

    expect(() => ownCopy({ security: [new Held()] })).toThrow(
      'A requirement must be a plain object'
    )
    expect(ownCopy({ extension: new Held() })).toBeInstanceOf(Object)
    expect((ownCopy({ extension: new Held() }) as { extension: unknown }).extension).toBeInstanceOf(
      Held
    )
  })

  it.each([
    ['Object.prototype', (): object | null => Object.prototype],
    ['null', (): object | null => null]
  ])(
    'refuses a security proxy that answers %s as its prototype, whatever it holds',
    (_name, answer) => {
      class Mixed {
        b: string[] = []
        get o(): string[] {
          return ['read', 'write']
        }
      }
      const lying = new Proxy(new Mixed(), { getPrototypeOf: answer })

      expect(() => ownCopy({ security: [lying] })).toThrow('A requirement cannot be a proxy')
    }
  )

  it('refuses a security proxy whose ownKeys lists only some of its names, and a list that is a proxy', () => {
    const partial = new Proxy({ b: [], o: ['read'] }, { ownKeys: () => ['b'] })
    const list = new Proxy([{ b: [] }], {})

    expect(() => ownCopy({ security: [partial] })).toThrow('A requirement cannot be a proxy')
    expect(() => ownCopy({ security: list })).toThrow('A requirement cannot be a proxy')
  })

  it('keeps a plain requirement made in another realm, which has its own Object.prototype', () => {
    const foreign = runInNewContext('({ bearer: ["read"] })') as object

    expect(Object.getPrototypeOf(foreign)).not.toBe(Object.prototype)
    expect(ownCopy({ security: [foreign] })).toStrictEqual({ security: [{ bearer: ['read'] }] })
  })

  it('reads a list subclass by its indexes, not by an iterator that disagrees with them', () => {
    class Listed extends Array<unknown> {
      override [Symbol.iterator](): ArrayIterator<unknown> {
        return ['from the iterator'][Symbol.iterator]()
      }
    }
    const list = new Listed()
    list.push('from the index')

    expect(ownCopy({ list })).toStrictEqual({ list: ['from the index'] })
  })

  it('builds a list as a plain array, whatever its species names', () => {
    const list: unknown[] = [1, 2]
    Object.defineProperty(list, 'constructor', {
      value: {
        [Symbol.species]: function made() {
          return new Proxy([], {})
        }
      }
    })

    const copied = ownCopy({ list }) as { list: unknown[] }

    expect(types.isProxy(copied.list)).toBe(false)
    expect(copied.list).toStrictEqual([1, 2])
  })

  it('keeps a plain empty requirement, which is intended anonymous access', () => {
    expect(ownCopy({ security: [{}] })).toStrictEqual({ security: [{}] })
  })

  it.each([
    [
      'an extension first, then a requirement',
      (req: object) => ({ 'x-requirement': req, security: [req] })
    ],
    [
      'a requirement first, then an extension',
      (req: object) => ({ security: [req], 'x-requirement': req })
    ]
  ])(
    'reads an object shared by %s once, so the requirement judged is the one kept',
    (_order, build) => {
      let reads = 0
      const req = {
        get oauth(): string[] {
          reads += 1
          return reads === 1 ? ['write'] : []
        }
      }

      const copy = ownCopy({ 'ItemsController.list': build(req) }) as Record<
        string,
        Record<string, unknown>
      >

      expect(reads).toBe(1)
      expect(copy['ItemsController.list']?.['security']).toStrictEqual([{ oauth: ['write'] }])
    }
  )

  it('refuses a name a proxy lists but holds no property under, instead of dropping it', () => {
    const source = new Proxy({ real: 1 }, { ownKeys: () => ['real', 'ghost'] })

    expect(() => ownCopy(source)).toThrow('A proxy lists a name it holds no property under')
  })

  it('defines each property of the copy as writable and configurable, as an assignment would', () => {
    const copy = ownCopy({ shown: 1 }) as Record<string, unknown>
    const described = Object.getOwnPropertyDescriptor(copy, 'shown')

    expect(described).toMatchObject({ writable: true, configurable: true, enumerable: true })
    copy['shown'] = 2
    expect(copy['shown']).toBe(2)
    expect(delete copy['shown']).toBe(true)
  })

  it('keeps a symbol key and a key named __proto__ as own properties of the copy', () => {
    const tag = Symbol('tag')
    const source = JSON.parse('{"__proto__": {"polluted": true}, "plain": 1}') as object
    Object.defineProperty(source, tag, { value: 'marked', enumerable: true })

    const copy = ownCopy(source) as Record<PropertyKey, unknown>

    expect(copy[tag]).toBe('marked')
    expect(Object.getOwnPropertyDescriptor(copy, '__proto__')?.value).toEqual({ polluted: true })
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype)
    expect((copy as { polluted?: boolean }).polluted).toBeUndefined()
  })

  it('copies an object reached twice once: the copy is shared too, and each getter runs once', () => {
    let reads = 0
    let node: Record<string, unknown> = {
      get leaf() {
        reads += 1
        return 1
      }
    }
    const shared = node
    for (let level = 0; level < 24; level += 1) node = { a: node, b: node }

    const copy = ownCopy(node) as Record<string, Record<string, unknown>>

    expect(reads).toBe(1)
    expect(copy['a']).toBe(copy['b'])
    expect(copy['a']).not.toBe(node['a'])
    expect(shared['leaf']).toBe(1)
  })

  it('still refuses a cycle that is reached through a shared object', () => {
    const shared: Record<string, unknown> = {}
    const top = { a: shared, b: shared }
    shared['back'] = top

    expect(() => ownCopy(top)).toThrow(RangeError)
  })

  it('keeps a Date, a class instance and a function as they are', () => {
    class Widget {}
    const when = new Date(0)
    const widget = new Widget()
    const task = (): number => 1

    expect(ownCopy(when)).toBe(when)
    expect(ownCopy(widget)).toBe(widget)
    expect(ownCopy(task)).toBe(task)
    expect(ownCopy('text')).toBe('text')
    expect(ownCopy(null)).toBeNull()
  })

  it('copies 65 objects nested in one another and refuses 66', () => {
    const ok = nested(65, 'leaf', (inner) => ({ next: inner }))
    const tooDeep = nested(66, 'leaf', (inner) => ({ next: inner }))

    expect(() => ownCopy(ok)).not.toThrow()
    expect(() => ownCopy(tooDeep)).toThrow(
      new RangeError('A value holds itself or is nested too deeply')
    )
  })

  it('counts the depth through lists as well', () => {
    const ok = nested(65, 'leaf', (inner) => [inner])
    const tooDeep = nested(66, 'leaf', (inner) => [inner])

    expect(() => ownCopy(ok)).not.toThrow()
    expect(() => ownCopy(tooDeep)).toThrow(RangeError)
  })

  it('refuses a value that holds itself, with the message', () => {
    const loop: Record<string, unknown> = {}
    loop['self'] = loop

    expect(() => ownCopy(loop)).toThrow(
      new RangeError('A value holds itself or is nested too deeply')
    )
  })

  it('refuses a proxy whose trap throws, before anything reads the copy', () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error('host')
        }
      }
    )

    expect(() => ownCopy({ inner: hostile })).toThrow('host')
  })
})
