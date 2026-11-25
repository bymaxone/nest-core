/**
 * Test of the public surface of the idempotency subpath.
 *
 * Layer: unit.
 * Goal: the barrel exports exactly the names the documentation lists.
 * Mocks: none.
 */
import * as surface from './index'

describe('the idempotency barrel', () => {
  it('exports the decorator, the interceptor, the token, the store and the six codes', () => {
    expect(Object.values(surface).every((member) => member !== undefined)).toBe(true)
    expect(Object.keys(surface).sort()).toEqual([
      'BYMAX_IDEMPOTENCY_IN_PROGRESS',
      'BYMAX_IDEMPOTENCY_KEY_INVALID',
      'BYMAX_IDEMPOTENCY_KEY_REQUIRED',
      'BYMAX_IDEMPOTENCY_KEY_REUSED',
      'BYMAX_IDEMPOTENCY_NOT_REPLAYABLE',
      'BYMAX_IDEMPOTENCY_STORE',
      'BYMAX_IDEMPOTENCY_STORE_UNAVAILABLE',
      'IdempotencyInterceptor',
      'Idempotent',
      'InMemoryIdempotencyStore'
    ])
  })
})
