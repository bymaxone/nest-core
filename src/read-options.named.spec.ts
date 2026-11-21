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
    expect(error.cause).toMatchObject({ message: 'a map option is too large' })
  })

  it('keeps a map whose prototype chain is exactly as long as the limit allows', () => {
    let held: object = { defaultSrc: ['x'] }
    for (let i = 0; i < 999; i += 1) held = Object.create(held) as object
    expect(Object.keys(read(held))).toEqual(['defaultSrc'])
  })

  it('keeps a map that answers to exactly the limit', () => {
    const held = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`k${i}`, 1]))
    expect(Object.keys(read(held))).toHaveLength(1000)
  })

  it('refuses a map that answers to more names than the limit', () => {
    const held = Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`k${i}`, 1]))
    const error = refusal({ map: held }, NAMED)
    expect(error.cause).toMatchObject({ message: 'a map option is too large' })
  })
})

describe('a list item behind a proxy that lists no keys', () => {
  it('refuses a requirement that is a proxy over an empty object', () => {
    const item = new Proxy({}, { get: () => ['read'] })
    const error = refusal({ list: [item] }, LISTED)
    expect(error.cause).toMatchObject({
      message: 'an option is held behind a proxy that lists no keys',
      option: 'list'
    })
  })

  it('keeps a plain empty requirement', () => {
    expect(readOptions({ list: [{}] }, LISTED)).toEqual({ list: [{}] })
  })
})
