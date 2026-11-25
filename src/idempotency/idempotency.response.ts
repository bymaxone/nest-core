/**
 * @fileoverview What the interceptor keeps of an answer and how it puts it back: the capture of a handler's
 * result or client error as a stored response, and the replay of a stored one.
 * @layer Utility
 */
import { HttpException, StreamableFile } from '@nestjs/common'

import type { IdempotencyStoredResponse, StoredResponseHeaders } from './idempotency.store'

/** Headers of an answer that are kept and replayed. */
const KEPT_HEADERS = ['location', 'content-location'] as const

/** The largest serialised header block that is stored. */
const MAX_HEADER_BYTES = 65_536

/** The response methods the interceptor uses, on Express and on Fastify. */
export interface ReplyLike {
  statusCode?: number
  status?(code: number): unknown
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

/** Called with what made a body unserialisable. */
type OnFailure = (cause: unknown) => void

/** The body's `JSON.stringify`; `undefined` when a replay could not send the same bytes, or it exceeds the bound. */
function bodyOf(value: unknown, maxBodyBytes: number, onFailure: OnFailure): string | undefined {
  if (
    ArrayBuffer.isView(value) ||
    value instanceof ArrayBuffer ||
    value instanceof StreamableFile ||
    typeof (value as { pipe?: unknown } | null)?.pipe === 'function'
  ) {
    return undefined
  }
  let text: string | undefined
  try {
    text = JSON.stringify(value) as string | undefined
  } catch (cause) {
    onFailure(cause)
    return undefined
  }
  if (typeof value === 'object' && value !== null && !/^[{[]/.test(text ?? '')) return undefined
  text ??= ''
  return Buffer.byteLength(text) > maxBodyBytes ? undefined : text
}

/**
 * The stored form of a handler's result.
 *
 * @param status - The status Nest sends unless the handler set another on the response.
 * @param value - What the handler returned.
 * @param reply - The response, for its status and the kept headers.
 * @param maxBodyBytes - The largest body that is kept.
 * @param onFailure - Told what made the value unserialisable.
 * @returns The response to store; without a body when it is not replayable.
 */
export function captureResult(
  status: number,
  value: unknown,
  reply: ReplyLike,
  maxBodyBytes: number,
  onFailure: OnFailure
): IdempotencyStoredResponse {
  const sent = reply.statusCode ?? status
  const headers = keptHeaders(reply)
  const body = bodyOf(value, maxBodyBytes, onFailure)
  if (
    body === undefined ||
    sent >= 400 ||
    Buffer.byteLength(JSON.stringify(headers)) > MAX_HEADER_BYTES
  ) {
    return { status: sent, headers: {} }
  }
  return { status: sent, headers, body }
}

/**
 * The stored form of a client error, or `undefined` when the error must not be kept: a server error,
 * a transient client error, or anything that is not an `HttpException`.
 *
 * @param error - What the handler threw.
 * @param maxBodyBytes - The largest body that is kept.
 * @param onFailure - Told what made the body unserialisable.
 * @returns The response to store.
 */
export function captureClientError(
  error: unknown,
  maxBodyBytes: number,
  onFailure: OnFailure
): IdempotencyStoredResponse | undefined {
  if (!(error instanceof HttpException)) return undefined
  const status = error.getStatus()
  if (status < 400 || status > 499 || TRANSIENT_CLIENT_ERRORS.has(status)) return undefined
  const body = bodyOf(error.getResponse(), maxBodyBytes, onFailure)
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
 * @param reply - The response, given the status, the kept headers and `Idempotent-Replayed: true`.
 * @returns The value to emit.
 * @throws HttpException For a stored client error.
 */
export function replay(stored: IdempotencyStoredResponse, body: string, reply: ReplyLike): unknown {
  for (const [name, value] of Object.entries(stored.headers)) setReplyHeader(reply, name, value)
  setReplyHeader(reply, 'Idempotent-Replayed', 'true')
  if (stored.status < 400) reply.status?.(stored.status)
  const value: unknown = body === '' ? undefined : JSON.parse(body)
  if (stored.status >= 400) {
    throw new HttpException(value as string | Record<string, unknown>, stored.status)
  }
  return value
}
