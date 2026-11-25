/**
 * Unit tests of the store's injection token.
 *
 * Layer: unit.
 * Goal: the token is the registry symbol of its published key, so a provider registered from one bundle
 * is the one another bundle injects.
 * Mocks: none.
 */
import { BYMAX_IDEMPOTENCY_STORE } from './idempotency.store'

describe('BYMAX_IDEMPOTENCY_STORE', () => {
  it('is the registry symbol of a fixed key', () => {
    expect(BYMAX_IDEMPOTENCY_STORE).toBe(Symbol.for('@bymax-one/nest-core:idempotency-store'))
  })
})
