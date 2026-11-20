/**
 * Unit tests for how a host's throw is carried into a log entry or a chained error.
 *
 * Layer: unit.
 * Goal: an `Error` is passed through untouched, anything else becomes a typed wrapper holding the
 * original as `cause`, and nothing is read from a thrown object but its type tag, which a hostile value cannot make throw.
 * Mocks: none.
 */
import { runInNewContext } from 'node:vm'

import { asHostError, NonErrorThrownError } from './host-error'

describe('asHostError', () => {
  it('returns an Error as it is, keeping its name, code and stack', () => {
    const original = Object.assign(new TypeError('boom'), { code: 'E_BOOM' })
    expect(asHostError(original)).toBe(original)
  })

  it('wraps a string, showing its text and keeping it as cause', () => {
    const wrapped = asHostError('just a string')
    expect(wrapped).toBeInstanceOf(NonErrorThrownError)
    expect(wrapped.name).toBe('NonErrorThrownError')
    expect(wrapped.message).toBe('just a string')
    expect(wrapped.cause).toBe('just a string')
  })

  it('cuts a long string at 500 characters', () => {
    expect(asHostError('x'.repeat(900)).message).toHaveLength(500)
  })

  it('wraps an object without reading it, and keeps it as cause', () => {
    const hostile = {
      get message(): string {
        throw new Error('read')
      },
      toString: (): string => {
        throw new Error('coerced')
      }
    }
    const wrapped = asHostError(hostile)
    expect(wrapped.message).toBe('A value that is not an Error was thrown: an object')
    expect(wrapped.cause).toBe(hostile)
  })

  it('wraps an object whose type tag throws when read, and a revoked proxy', () => {
    const tagged = {
      get [Symbol.toStringTag](): string {
        throw new Error('tag')
      }
    }
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()
    for (const thrown of [tagged, proxy]) {
      const wrapped = asHostError(thrown)
      expect(wrapped).toBeInstanceOf(NonErrorThrownError)
      expect(wrapped.message).toBe('A value that is not an Error was thrown')
      expect(wrapped.cause).toBe(thrown)
    }
  })

  it.each([
    ['null', null, 'null'],
    ['undefined', undefined, 'undefined'],
    ['a number', 7, '7']
  ])('wraps %s', (_name, thrown, shown) => {
    const wrapped = asHostError(thrown)
    expect(wrapped.message).toBe(`A value that is not an Error was thrown: ${shown}`)
    expect(wrapped.cause).toBe(thrown)
  })
})

describe('an Error from another realm', () => {
  it('is passed through as it is, not wrapped as a value that is not an Error', () => {
    const foreign = runInNewContext('new TypeError("from a vm")') as Error
    expect(foreign instanceof Error).toBe(false)
    expect(asHostError(foreign)).toBe(foreign)
  })
})

describe('NonErrorThrownError across bundled copies', () => {
  /** A second copy of the module, as a second published entry would bundle. */
  function otherCopy(): typeof import('./host-error') {
    let copy: typeof import('./host-error') | undefined
    jest.isolateModules(() => {
      copy = require('./host-error') as typeof import('./host-error')
    })
    return copy as typeof import('./host-error')
  }

  it('answers instanceof for an instance made by the other copy, in both directions', () => {
    const other = otherCopy()
    expect(other.NonErrorThrownError).not.toBe(NonErrorThrownError)
    expect(other.asHostError('x') instanceof NonErrorThrownError).toBe(true)
    expect(asHostError('x') instanceof other.NonErrorThrownError).toBe(true)
  })

  it('is not an instance for an ordinary Error, a plain object or a value that throws when read', () => {
    const hostile = {
      get [Symbol.for('@bymax-one/nest-core:non-error-thrown')](): boolean {
        throw new Error('brand')
      }
    }
    for (const value of [new Error('x'), {}, null, 'text', 5, hostile]) {
      expect(value instanceof NonErrorThrownError).toBe(false)
    }
  })

  it('does not show the mark when the error is enumerated', () => {
    const brand = Symbol.for('@bymax-one/nest-core:non-error-thrown')
    const error = asHostError('x')
    expect(Object.prototype.propertyIsEnumerable.call(error, brand)).toBe(false)
    expect(Reflect.get(error, brand)).toBe(true)
  })
})
