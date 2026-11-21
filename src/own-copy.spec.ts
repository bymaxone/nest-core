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
