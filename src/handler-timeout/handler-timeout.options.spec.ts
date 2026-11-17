/**
 * Unit tests for the handler-timeout options.
 *
 * Layer: unit.
 * Goal: the handler timeout is off by default, takes a positive timer-safe duration and a list of
 * path prefixes, and refuses anything else at boot.
 * Mocks: none (pure function).
 */
import { normalizeCoreOptions } from '../core.options'

describe('handlerTimeout options', () => {
  it('is off by default, with a 30 s timeout and no excluded paths', () => {
    expect(normalizeCoreOptions().handlerTimeout).toEqual({
      enabled: false,
      timeoutMs: 30_000,
      excludePaths: []
    })
  })

  it('takes the given values, and freezes the list it keeps', () => {
    const given = ['/events', '/uploads']
    const resolved = normalizeCoreOptions({
      handlerTimeout: { enabled: true, timeoutMs: 5_000, excludePaths: given }
    }).handlerTimeout
    expect(resolved).toEqual({ enabled: true, timeoutMs: 5_000, excludePaths: given })
    expect(resolved.excludePaths).not.toBe(given)
    expect(Object.isFrozen(resolved.excludePaths)).toBe(true)
  })

  it.each([0, -1, 1.5, Number.NaN, 2 ** 31])('refuses a timeout of %p', (timeoutMs) => {
    expect(() => normalizeCoreOptions({ handlerTimeout: { timeoutMs } })).toThrow(
      /handlerTimeout\.timeoutMs/
    )
  })

  it.each([
    ['a path without a leading slash', ['events']],
    ['an empty path', ['']],
    ['a path with a query', ['/events?a=1']],
    ['a non-string entry', [42 as unknown as string]]
  ])('refuses %s in excludePaths', (_name, excludePaths) => {
    expect(() => normalizeCoreOptions({ handlerTimeout: { excludePaths } })).toThrow(
      /handlerTimeout\.excludePaths/
    )
  })

  it('accepts the largest timer-safe timeout', () => {
    expect(
      normalizeCoreOptions({ handlerTimeout: { timeoutMs: 2 ** 31 - 1 } }).handlerTimeout.timeoutMs
    ).toBe(2 ** 31 - 1)
  })
})
