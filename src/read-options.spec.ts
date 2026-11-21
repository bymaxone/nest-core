/**
 * Unit tests for taking the options a host passes.
 *
 * Layer: unit.
 * Goal: options that read fine come back as an own copy; a read that throws is refused with the
 * fixed message, whatever was thrown is the cause as it was thrown, and a value that is not a
 * plain object or a list comes back as it is.
 * Mocks: none.
 */
import { readOptions } from './read-options'

describe('readOptions', () => {
  it('returns an own copy of options that read fine', () => {
    const given = { a: { b: [1, 2] } }

    const copy = readOptions(given)

    expect(copy).toEqual(given)
    expect(copy).not.toBe(given)
    expect(copy.a).not.toBe(given.a)
  })

  it('returns a value that is not a plain object or a list as it is', () => {
    expect(readOptions(undefined)).toBeUndefined()
    expect(readOptions('text')).toBe('text')
  })

  it.each([
    ['an Error', new Error('host')],
    ['a string', 'host text'],
    ['an object', { code: 7 }]
  ])('refuses a getter that throws %s, with it as the cause', (_name, thrown) => {
    const given = {
      get value(): never {
        throw thrown
      }
    }
    let caught: unknown
    try {
      readOptions(given)
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toBe('the options could not be read')
    expect((caught as Error).cause).toBe(thrown)
  })
})
