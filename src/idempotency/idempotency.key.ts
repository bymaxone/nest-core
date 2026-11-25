/**
 * @fileoverview The pure parts of HTTP idempotency keys: the header's grammar, the storage key and the
 * request fingerprint. No Nest, no I/O.
 * @layer Utility
 */
import { createHash } from 'node:crypto'

/** The deepest body nesting the fingerprint accepts. */
const MAX_BODY_DEPTH = 32

/** 1 to 255 visible ASCII characters: no space, no control character. */
const KEY_PATTERN = /^[\x21-\x7e]{1,255}$/

/** A body the fingerprint cannot represent whole, so it is refused and never hashed truncated. */
export class UnfingerprintableBody extends Error {}

/**
 * The header's value when it is a valid key.
 *
 * @param header - The raw `Idempotency-Key` header value.
 * @returns The key, or `undefined` when it is not a string of 1 to 255 visible ASCII characters.
 */
export function validKey(header: unknown): string | undefined {
  return typeof header === 'string' && KEY_PATTERN.test(header) ? header : undefined
}

/**
 * SHA-256 over length-prefixed fields, so content can never move the boundary between two of them.
 *
 * @param fields - The variable fields, in order.
 * @returns 64 lower-case hexadecimal characters.
 */
export function digest(fields: readonly string[]): string {
  const hash = createHash('sha256')
  for (const field of fields) {
    const bytes = Buffer.from(field, 'utf8')
    hash.update(`${bytes.length}:`)
    hash.update(bytes)
  }
  return hash.digest('hex')
}

/** Whether `value` is a plain object: a body parser's output, never a Buffer, stream or class instance. */
function isPlain(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value) as unknown
  return prototype === Object.prototype || prototype === null
}

/** The canonical JSON of one node: sorted keys, no whitespace, `undefined` members dropped. */
function canonical(value: unknown, depth: number): string {
  if (depth > MAX_BODY_DEPTH) throw new UnfingerprintableBody('nested too deep')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${Array.from(value as unknown[], (item) => canonical(item ?? null, depth + 1)).join(',')}]`
  }
  if (typeof value === 'object' && isPlain(value)) {
    const members = Object.entries(value)
      .filter(([, member]) => member !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : 1))
      .map(([name, member]) => `${JSON.stringify(name)}:${canonical(member, depth + 1)}`)
    return `{${members.join(',')}}`
  }
  throw new UnfingerprintableBody('not JSON')
}

/**
 * The canonical JSON of a parsed request body.
 *
 * @param body - What the body parser produced; `undefined` is an empty body.
 * @returns The canonical text, `''` for no body.
 * @throws UnfingerprintableBody When the body nests deeper than 32 levels or is not plain JSON data
 *   (a Buffer, a stream, a Map, a class instance, a non-finite number).
 */
export function canonicalBody(body: unknown): string {
  return body === undefined ? '' : canonical(body, 0)
}

/** The request parts a fingerprint covers. */
export interface FingerprintParts {
  readonly method: string
  readonly path: string
  readonly query: string
  readonly body: unknown
}

/**
 * The fingerprint of a request: method, the actual path (route parameters included), the query string
 * and the canonical body.
 *
 * @param parts - The request parts.
 * @returns 64 lower-case hexadecimal characters.
 * @throws UnfingerprintableBody As {@link canonicalBody} does.
 */
export function fingerprint(parts: FingerprintParts): string {
  return digest([parts.method, parts.path, parts.query, canonicalBody(parts.body)])
}
