/**
 * Unit tests for the options of an idempotent route.
 *
 * Layer: unit.
 * Goal: durations and sizes that a store or a timer would misread are refused at boot, a lease never
 * outlives the answer's lifetime, and the scope is a function or an explicit `unscoped: true`.
 * Mocks: none.
 */
import { resolveIdempotentOptions } from './idempotency.options'

const scope = (): string => 'caller'

describe('resolveIdempotentOptions', () => {
  it.each([0, 1.5, Number.NaN, 2_147_483_648, -1, '60'])(
    'refuses leaseSeconds %p',
    (leaseSeconds) => {
      expect(() =>
        resolveIdempotentOptions({ scope, leaseSeconds: leaseSeconds as number })
      ).toThrow(/idempotent\.leaseSeconds must be a positive/)
    }
  )

  it.each([0, 1.5, Number.NaN, 2_147_483_648, 604_801])('refuses ttlSeconds %p', (ttlSeconds) => {
    expect(() => resolveIdempotentOptions({ scope, ttlSeconds })).toThrow(
      /idempotent\.ttlSeconds must be a positive/
    )
  })

  it.each([0, 1.5, Number.NaN])('refuses maxBodyBytes %p', (maxBodyBytes) => {
    expect(() => resolveIdempotentOptions({ scope, maxBodyBytes })).toThrow(
      /idempotent\.maxBodyBytes must be a positive/
    )
  })

  it('refuses a lease longer than the answer is kept', () => {
    expect(() => resolveIdempotentOptions({ scope, leaseSeconds: 100, ttlSeconds: 50 })).toThrow(
      /leaseSeconds must not exceed/
    )
  })

  it('accepts a lease exactly as long as the answer is kept', () => {
    expect(resolveIdempotentOptions({ scope, leaseSeconds: 50, ttlSeconds: 50 })).toMatchObject({
      leaseSeconds: 50,
      ttlSeconds: 50
    })
  })

  it('needs a scope function or unscoped: true, and not both', () => {
    expect(() => resolveIdempotentOptions({} as never)).toThrow(/needs a `scope`/)
    expect(() => resolveIdempotentOptions({ scope: 'x', unscoped: true } as never)).toThrow(
      /scope. as a function/
    )
    expect(() => resolveIdempotentOptions({ scope, unscoped: true } as never)).toThrow(
      /never together/
    )
    expect(resolveIdempotentOptions({ unscoped: true }).scope).toBeUndefined()
  })

  it('refuses an unknown onStoreError', () => {
    expect(() => resolveIdempotentOptions({ scope, onStoreError: 'x' as never })).toThrow(
      /onStoreError/
    )
  })

  it('applies the defaults', () => {
    expect(resolveIdempotentOptions({ scope })).toEqual({
      scope,
      required: false,
      leaseSeconds: 60,
      ttlSeconds: 86_400,
      maxBodyBytes: 65_536,
      storeClientErrors: true,
      onStoreError: 'fail-open'
    })
  })
})
