/**
 * Unit tests for the own copy of what a host hands over.
 *
 * Layer: unit.
 * Goal: plain objects and lists are copied at every depth, including a null-prototype object; a
 * cycle and a nesting past the limit are refused with a message; anything else is kept as it is; a
 * proxy that throws is refused by the copy and never reached afterwards.
 * Mocks: none.
 */
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

  it('keeps a property that is not enumerable, still not enumerable, with its value read once', () => {
    let reads = 0
    const source = Object.defineProperty({ shown: 1 }, 'hidden', {
      get: () => {
        reads += 1
        return 'secret'
      }
    })

    const copy = ownCopy(source) as Record<string, unknown>

    expect(copy['hidden']).toBe('secret')
    expect(Object.keys(copy)).toEqual(['shown'])
    expect(Object.getOwnPropertyDescriptor(copy, 'hidden')?.enumerable).toBe(false)
    expect(Object.getOwnPropertyDescriptor(copy, 'shown')?.enumerable).toBe(true)
    expect(reads).toBe(1)
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
