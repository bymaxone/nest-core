/**
 * Unit tests for the in-memory idempotency store.
 *
 * Layer: unit.
 * Goal: a claim is exclusive, `complete` and `release` act only for the token that holds the key, a
 * claim expires after its lease, a completed record lives for its own ttl, and the store refuses a
 * new key once it is full.
 * Mocks: none; the clock is a plain function the cases move.
 */
import { InMemoryIdempotencyStore } from './idempotency.memory-store'
import type { IdempotencyStoredResponse } from './idempotency.store'

const RESPONSE: IdempotencyStoredResponse = { status: 201, headers: {}, body: '{"ok":true}' }

/** A store whose clock the case controls. */
function storeWithClock(): { store: InMemoryIdempotencyStore; advance: (ms: number) => void } {
  let now = 1_000_000
  return {
    store: new InMemoryIdempotencyStore(() => now),
    advance: (ms) => {
      now += ms
    }
  }
}

describe('InMemoryIdempotencyStore', () => {
  it('claims a free key and reports the holder to a second caller', async () => {
    const { store } = storeWithClock()

    const first = await store.begin('k', 'fp', 60)
    const second = await store.begin('k', 'fp', 60)

    expect(first).toEqual({ claimed: true, token: expect.any(String) })
    expect(second).toEqual({
      claimed: false,
      record: { state: 'in_progress', fingerprint: 'fp' }
    })
  })

  it('completes a claim with its token and replays the stored response', async () => {
    const { store } = storeWithClock()
    const claim = await store.begin('k', 'fp', 60)
    if (!claim.claimed) throw new Error('expected a claim')

    await expect(store.complete('k', claim.token, RESPONSE, 3600)).resolves.toBe(true)

    await expect(store.begin('k', 'fp', 60)).resolves.toEqual({
      claimed: false,
      record: { state: 'completed', fingerprint: 'fp', response: RESPONSE }
    })
  })

  it('refuses complete and release for a token that does not hold the key', async () => {
    const { store } = storeWithClock()
    const claim = await store.begin('k', 'fp', 60)
    if (!claim.claimed) throw new Error('expected a claim')

    await expect(store.complete('k', 'other', RESPONSE, 60)).resolves.toBe(false)
    await expect(store.release('k', 'other')).resolves.toBe(false)
    await expect(store.begin('k', 'fp', 60)).resolves.toMatchObject({
      claimed: false,
      record: { state: 'in_progress' }
    })
  })

  it('refuses a second complete and keeps the first answer', async () => {
    const { store } = storeWithClock()
    const claim = await store.begin('k', 'fp', 60)
    if (!claim.claimed) throw new Error('expected a claim')
    await store.complete('k', claim.token, RESPONSE, 3600)

    const other = { status: 200, headers: {}, body: '{"other":true}' }
    await expect(store.complete('k', claim.token, other, 3600)).resolves.toBe(false)

    await expect(store.begin('k', 'fp', 60)).resolves.toMatchObject({
      record: { response: RESPONSE }
    })
  })

  it('refuses a release after complete and keeps the completed record', async () => {
    const { store } = storeWithClock()
    const claim = await store.begin('k', 'fp', 60)
    if (!claim.claimed) throw new Error('expected a claim')
    await store.complete('k', claim.token, RESPONSE, 3600)

    await expect(store.release('k', claim.token)).resolves.toBe(false)

    await expect(store.begin('k', 'fp', 60)).resolves.toMatchObject({
      claimed: false,
      record: { state: 'completed', response: RESPONSE }
    })
  })

  it('replays an empty body as an empty body, distinct from an absent one', async () => {
    const { store } = storeWithClock()
    const claim = await store.begin('k', 'fp', 60)
    if (!claim.claimed) throw new Error('expected a claim')
    await store.complete('k', claim.token, { status: 204, headers: {}, body: '' }, 3600)

    const held = await store.begin('k', 'fp', 60)

    expect(held).toMatchObject({ claimed: false, record: { response: { body: '' } } })
  })

  it('frees the key on release so a retry can claim it', async () => {
    const { store } = storeWithClock()
    const claim = await store.begin('k', 'fp', 60)
    if (!claim.claimed) throw new Error('expected a claim')

    await expect(store.release('k', claim.token)).resolves.toBe(true)

    await expect(store.begin('k', 'fp', 60)).resolves.toMatchObject({ claimed: true })
  })

  it('lets a late complete fail once the lease expired and a newer holder took the key', async () => {
    const { store, advance } = storeWithClock()
    const stale = await store.begin('k', 'fp', 60)
    if (!stale.claimed) throw new Error('expected a claim')
    advance(60_000)
    const fresh = await store.begin('k', 'fp', 60)
    if (!fresh.claimed) throw new Error('expected a second claim after the lease')

    await expect(store.complete('k', stale.token, RESPONSE, 3600)).resolves.toBe(false)
    await expect(store.release('k', stale.token)).resolves.toBe(false)
    await expect(store.complete('k', fresh.token, RESPONSE, 3600)).resolves.toBe(true)
  })

  it('keeps a claim until the last millisecond of its lease and drops it at the lease', async () => {
    const { store, advance } = storeWithClock()
    await store.begin('k', 'fp', 60)

    advance(59_999)
    await expect(store.begin('k', 'fp', 60)).resolves.toMatchObject({ claimed: false })
    advance(1)
    await expect(store.begin('k', 'fp', 60)).resolves.toMatchObject({ claimed: true })
  })

  it('expires a completed record after its own ttl, not after the lease', async () => {
    const { store, advance } = storeWithClock()
    const claim = await store.begin('k', 'fp', 60)
    if (!claim.claimed) throw new Error('expected a claim')
    await store.complete('k', claim.token, RESPONSE, 3600)

    advance(3_599_999)
    await expect(store.begin('k', 'fp', 60)).resolves.toMatchObject({ claimed: false })
    advance(1)
    await expect(store.begin('k', 'fp', 60)).resolves.toMatchObject({ claimed: true })
  })

  it('refuses a new key once the store holds its limit of live keys', async () => {
    const { store } = storeWithClock()
    for (let index = 0; index < 10_000; index += 1) await store.begin(`k${index}`, 'fp', 60)

    await expect(store.begin('overflow', 'fp', 60)).rejects.toThrow('idempotency store is full')
    await expect(store.begin('k0', 'fp', 60)).resolves.toMatchObject({ claimed: false })
  })

  it('sweeps expired keys so a full store accepts a new key after their leases', async () => {
    const { store, advance } = storeWithClock()
    for (let index = 0; index < 10_000; index += 1) await store.begin(`k${index}`, 'fp', 60)
    advance(60_000)

    await expect(store.begin('fresh', 'fp', 60)).resolves.toMatchObject({ claimed: true })
  })
})
