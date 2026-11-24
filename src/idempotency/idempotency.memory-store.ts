/**
 * @fileoverview An in-memory {@link IIdempotencyStore} for development and tests. It is one process's
 * memory: it protects nothing across processes or restarts, so a deployment with more than one
 * instance supplies a shared store instead.
 * @layer Provider
 */
import { randomUUID } from 'node:crypto'

import type {
  IdempotencyBeginResult,
  IdempotencyRecord,
  IdempotencyStoredResponse,
  IIdempotencyStore
} from './idempotency.store'

/** One held key: its record, the token that owns it and the instant it stops being held. */
interface Entry {
  record: IdempotencyRecord
  token: string
  expiresAt: number
}

/** The most keys the store holds before it refuses to claim a new one. */
const MAX_ENTRIES = 10_000

/**
 * A process-local store. Entries expire on read, so an unread entry costs memory until the next
 * `begin` sweeps it; the store never holds more than {@link MAX_ENTRIES} keys.
 */
export class InMemoryIdempotencyStore implements IIdempotencyStore {
  private readonly entries = new Map<string, Entry>()

  /**
   * @param now - The clock in milliseconds; replaceable so a test can move time.
   */
  constructor(private readonly now: () => number = Date.now) {}

  /** @inheritdoc */
  async begin(
    key: string,
    fingerprint: string,
    leaseSeconds: number
  ): Promise<IdempotencyBeginResult> {
    const held = this.live(key)
    if (held !== undefined) return { claimed: false, record: held.record }
    this.sweep()
    if (this.entries.size >= MAX_ENTRIES) {
      throw new Error('idempotency store is full')
    }
    const token = randomUUID()
    this.entries.set(key, {
      record: { state: 'in_progress', fingerprint },
      token,
      expiresAt: this.now() + leaseSeconds * 1000
    })
    return { claimed: true, token }
  }

  /** @inheritdoc */
  async complete(
    key: string,
    token: string,
    response: IdempotencyStoredResponse,
    ttlSeconds: number
  ): Promise<boolean> {
    const held = this.live(key)
    if (held === undefined || held.token !== token || held.record.state !== 'in_progress') {
      return false
    }
    held.record = { state: 'completed', fingerprint: held.record.fingerprint, response }
    held.expiresAt = this.now() + ttlSeconds * 1000
    return true
  }

  /** @inheritdoc */
  async release(key: string, token: string): Promise<boolean> {
    const held = this.live(key)
    if (held === undefined || held.token !== token || held.record.state !== 'in_progress') {
      return false
    }
    this.entries.delete(key)
    return true
  }

  /** The entry under `key` while it is still held; an expired one is dropped. */
  private live(key: string): Entry | undefined {
    const entry = this.entries.get(key)
    if (entry === undefined) return undefined
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key)
      return undefined
    }
    return entry
  }

  /** Drop every expired entry. */
  private sweep(): void {
    for (const key of [...this.entries.keys()]) this.live(key)
  }
}
