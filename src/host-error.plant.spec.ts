/**
 * Tests for `NonErrorThrownError` while `Object.prototype` holds a name a property descriptor reads.
 *
 * Layer: unit.
 * Goal: building the wrapper marks it with a descriptor that inherits nothing, so a `get` planted on
 * `Object.prototype` does not make the wrapper throw while a host's failure is being reported.
 * Mocks: none.
 */
import { NonErrorThrownError } from './host-error'

describe('NonErrorThrownError beside a planted descriptor name', () => {
  afterEach(() => {
    delete (Object.prototype as Record<string, unknown>)['get']
  })

  it('is built and recognised when `get` is planted', () => {
    Object.defineProperty(Object.prototype, 'get', {
      value: 'planted',
      enumerable: false,
      configurable: true,
      writable: true
    })

    const built = new NonErrorThrownError('a string')

    expect(built.message).toBe('a string')
    expect(built instanceof NonErrorThrownError).toBe(true)
  })
})
