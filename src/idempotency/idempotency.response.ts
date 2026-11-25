/**
 * @fileoverview What the interceptor keeps of an answer: the stored form of what the client was sent, and
 * the header write of a replay.
 * @layer Utility
 */
import { StreamableFile } from '@nestjs/common'

import type { IdempotencyStoredResponse, StoredResponseHeaders } from './idempotency.store'
import type { Wire } from './idempotency.wire'

/** Headers of an answer that are kept and replayed. */
const KEPT_HEADERS = ['content-type', 'location', 'content-location', 'etag'] as const

/** The most bytes the serialised headers of a stored answer may take, the bound the store port states. */
const MAX_HEADER_BYTES = 65_536

/** Client errors that say nothing about the request itself, so a retry must run again. */
const TRANSIENT_CLIENT_ERRORS: ReadonlySet<number> = new Set([408, 425, 429])

/** The response methods the interceptor uses to set a header, on Express and on Fastify. */
export interface ReplyLike {
  header?(name: string, value: string): unknown
  setHeader?(name: string, value: string): unknown
}

/** The kept headers an answer carries. */
function keptHeaders(headers: Wire['headers']): StoredResponseHeaders {
  return Object.fromEntries(
    Object.entries(headers).filter(
      (entry): entry is [string, string] =>
        KEPT_HEADERS.some((name) => name === entry[0]) && typeof entry[1] === 'string'
    )
  )
}

/**
 * The stored form of what the client was sent, or `undefined` when the claim is to be given back: a
 * server error, a transient client error, or a client error the route does not keep.
 *
 * @param answer - The status, headers and body that were sent.
 * @param storeClientErrors - Whether a client error is kept.
 * @returns The response to store; without a body when it cannot be replayed.
 */
export function storable(
  answer: Wire,
  storeClientErrors: boolean
): IdempotencyStoredResponse | undefined {
  const { status, body } = answer
  if (status >= 500 || TRANSIENT_CLIENT_ERRORS.has(status)) return undefined
  if (status >= 400 && !storeClientErrors) return undefined
  if (body === undefined || status === 304) return { status, headers: {} }
  const headers = keptHeaders(answer.headers)
  if (Buffer.byteLength(JSON.stringify(headers)) > MAX_HEADER_BYTES) return { status, headers: {} }
  return { status, headers, body }
}

/** Whether a value reaches the client as a stream or as bytes, which the tap never holds. */
export function streamed(value: unknown): boolean {
  return (
    ArrayBuffer.isView(value) ||
    value instanceof ArrayBuffer ||
    value instanceof StreamableFile ||
    typeof (value as { pipe?: unknown } | null)?.pipe === 'function'
  )
}

/** Set one header on whichever API the response has. */
export function setReplyHeader(reply: ReplyLike, name: string, value: string): void {
  if (typeof reply.header === 'function') reply.header(name, value)
  else reply.setHeader?.(name, value)
}
