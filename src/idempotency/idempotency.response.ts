/**
 * @fileoverview What the interceptor keeps of an answer and how it puts it back: the capture of a handler's
 * result or client error as a stored response, and the replay of a stored one.
 * @layer Utility
 */
import { HttpException } from '@nestjs/common'

import { canonicalBody } from './idempotency.key'
import type { IdempotencyStoredResponse, StoredResponseHeaders } from './idempotency.store'

/** Headers of an answer that are kept and replayed. */
const KEPT_HEADERS = ['location', 'content-location'] as const

/** The largest serialised header block that is stored. */
const MAX_HEADER_BYTES = 65_536

/** The response methods the interceptor uses, on Express and on Fastify. */
export interface ReplyLike {
  getHeader?(name: string): unknown
  header?(name: string, value: string): unknown
  setHeader?(name: string, value: string): unknown
}

/** Client errors that say nothing about the request itself, so a retry must run again. */
const TRANSIENT_CLIENT_ERRORS: ReadonlySet<number> = new Set([408, 425, 429])

/** The kept headers the response carries now. */
function keptHeaders(reply: ReplyLike): StoredResponseHeaders {
  return Object.fromEntries(
    KEPT_HEADERS.flatMap((name) => {
      const value = reply.getHeader?.(name)
      return typeof value === 'string' ? [[name, value]] : []
    })
  )
}

/** The stored form of a body: its JSON, or `undefined` when it is not plain JSON or exceeds the bound. */
function bodyOf(value: unknown, maxBodyBytes: number): string | undefined {
  try {
    canonicalBody(value)
  } catch {
    return undefined
  }
  const text = (JSON.stringify(value) as string | undefined) ?? ''
  return Buffer.byteLength(text) > maxBodyBytes ? undefined : text
}

/**
 * The stored form of a handler's result.
 *
 * @param status - The status Nest will send.
 * @param value - What the handler returned.
 * @param reply - The response, for the kept headers.
 * @param maxBodyBytes - The largest body that is kept.
 * @returns The response to store; without a body when the result is not replayable.
 */
export function captureResult(
  status: number,
  value: unknown,
  reply: ReplyLike,
  maxBodyBytes: number
): IdempotencyStoredResponse {
  const headers = keptHeaders(reply)
  const body = bodyOf(value, maxBodyBytes)
  if (body === undefined || Buffer.byteLength(JSON.stringify(headers)) > MAX_HEADER_BYTES) {
    return { status, headers: {} }
  }
  return { status, headers, body }
}

/**
 * The stored form of a client error, or `undefined` when the error must not be kept: a server error,
 * a transient client error, or anything that is not an `HttpException`.
 *
 * @param error - What the handler threw.
 * @param maxBodyBytes - The largest body that is kept.
 * @returns The response to store.
 */
export function captureClientError(
  error: unknown,
  maxBodyBytes: number
): IdempotencyStoredResponse | undefined {
  if (!(error instanceof HttpException)) return undefined
  const status = error.getStatus()
  if (status < 400 || status > 499 || TRANSIENT_CLIENT_ERRORS.has(status)) return undefined
  const body = bodyOf(error.getResponse(), maxBodyBytes)
  return body === undefined ? { status, headers: {} } : { status, headers: {}, body }
}

/** Set one header on whichever API the response has. */
export function setReplyHeader(reply: ReplyLike, name: string, value: string): void {
  if (typeof reply.header === 'function') reply.header(name, value)
  else reply.setHeader?.(name, value)
}

/**
 * The value a stored response replays as: the parsed body for a success, or the `HttpException` for a
 * client error, which the envelope filter turns into the original answer.
 *
 * @param stored - A stored response.
 * @param body - Its body, known to be present.
 * @param reply - The response, given the kept headers and `Idempotent-Replayed: true`.
 * @returns The value to emit.
 * @throws HttpException For a stored client error.
 */
export function replay(stored: IdempotencyStoredResponse, body: string, reply: ReplyLike): unknown {
  for (const [name, value] of Object.entries(stored.headers)) setReplyHeader(reply, name, value)
  setReplyHeader(reply, 'Idempotent-Replayed', 'true')
  const value: unknown = body === '' ? undefined : JSON.parse(body)
  if (stored.status >= 400) {
    throw new HttpException(value as string | Record<string, unknown>, stored.status)
  }
  return value
}
