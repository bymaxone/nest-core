/**
 * Unit tests for taking the options a host passes.
 *
 * Layer: unit.
 * Goal: each documented option is read by its name wherever the host keeps it (an own property, a
 * getter, a class accessor, a proxy that answers only `get`); a key the shape does not document is
 * kept so the block's check can refuse it; a read that throws is refused with the fixed message and
 * the thrown value as the cause; and a value that is not a block comes back as it is.
 * Mocks: none.
 */
import { readOptions } from './read-options'
import type { Shape } from './read-options'

/** A block with a scalar, a list, a nested block, a list of blocks and an open map. */
const SHAPE: Shape = {
  name: 0,
  list: 0,
  map: 0,
  inner: { token: 0, flag: 0 },
  items: [{ url: 0 }]
}

describe('readOptions', () => {
  it('returns a copy holding the documented options', () => {
    const given = {
      name: 'n',
      list: [1, 2],
      map: { anything: { deep: 1 } },
      inner: { token: 't', flag: true },
      items: [{ url: 'u' }]
    }

    const copy = readOptions(given, SHAPE)

    expect(copy).toEqual(given)
    expect(copy).not.toBe(given)
    expect(copy.inner).not.toBe(given.inner)
    expect(copy.map).not.toBe(given.map)
    expect(copy.items[0]).not.toBe(given.items[0])
  })

  it('leaves out an option the host left undefined', () => {
    const copy = readOptions({ name: undefined, inner: { token: 't' } } as object, SHAPE)

    expect(Object.keys(copy)).toEqual(['inner'])
  })

  it('reads an option held by a non-enumerable getter', () => {
    const given = Object.defineProperty({}, 'name', { get: () => 'secret' })

    expect(readOptions(given, SHAPE)).toEqual({ name: 'secret' })
  })

  it('reads an option a proxy answers only through get, nested ones too', () => {
    const inner = new Proxy({}, { get: (_t, key) => (key === 'token' ? 'secret' : undefined) })
    const given = new Proxy(
      {},
      { get: (_t, key) => (key === 'inner' ? inner : key === 'name' ? 'lazy' : undefined) }
    )

    expect(readOptions(given, SHAPE)).toEqual({ name: 'lazy', inner: { token: 'secret' } })
  })

  it('reads an option held by a class accessor', () => {
    class Block {
      get name(): string {
        return 'from a class'
      }
    }

    expect(readOptions(new Block(), SHAPE)).toEqual({ name: 'from a class' })
  })

  it('keeps a key the shape does not document, with no value, for the check to refuse', () => {
    const copy = readOptions({ name: 'n', stray: 1 }, SHAPE) as Record<string, unknown>

    expect(Object.keys(copy)).toEqual(['name', 'stray'])
    expect(copy['stray']).toBeUndefined()
  })

  it('keeps a stray key named __proto__ as an own property', () => {
    const given = JSON.parse('{"__proto__": 1, "name": "n"}') as object

    const copy = readOptions(given, SHAPE) as Record<string, unknown>

    expect(Object.keys(copy)).toEqual(['name', '__proto__'])
  })

  it('returns what is not a block as it is, for the check to refuse', () => {
    const when = new Date(0)

    expect(readOptions(undefined, SHAPE)).toBeUndefined()
    expect(readOptions('text', SHAPE)).toBe('text')
    expect(readOptions(when, SHAPE)).toBe(when)
    expect(readOptions([1], SHAPE)).toEqual([1])
    expect(readOptions({ inner: 'x', items: 'y' }, SHAPE)).toEqual({ inner: 'x', items: 'y' })
  })

  it.each([
    ['an Error', new Error('host')],
    ['a string', 'host text'],
    ['an object', { code: 7 }]
  ])('refuses a getter that throws %s, with it as the cause', (_name, thrown) => {
    const given = {
      get name(): never {
        throw thrown
      }
    }
    let caught: unknown
    try {
      readOptions(given, SHAPE)
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toBe('the options could not be read')
    expect((caught as Error).cause).toBe(thrown)
  })
})
