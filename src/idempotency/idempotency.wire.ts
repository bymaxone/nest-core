/**
 * @fileoverview The answer as the client receives it: a tap on the raw response that holds the bytes the
 * route writes until the claim is settled, and the replacement of a replay's write by the stored bytes.
 * @layer Utility
 */

/** The raw response methods the tap wraps, on `node:http` under Express and under Fastify. */
export interface WireResponse {
  statusCode: number
  readonly headersSent: boolean
  readonly writableEnded: boolean
  destroy(): unknown
  getHeaders(): Record<string, unknown>
  removeHeader(name: string): void
  writeHead(status: number, ...rest: unknown[]): unknown
  write(chunk: unknown, ...rest: unknown[]): boolean
  end(...args: unknown[]): unknown
}

/** What the client was sent. */
export interface Wire {
  readonly status: number
  /** The headers of the answer, lower-cased. */
  readonly headers: Readonly<Record<string, unknown>>
  /** The body as text; absent when it could not be held or does not decode as UTF-8. */
  readonly body?: string | undefined
}

/** The raw response of an Express response or a Fastify reply. */
export function rawOf(reply: object): WireResponse {
  return ((reply as { raw?: WireResponse }).raw ?? reply) as WireResponse
}

/** The headers a `writeHead` call passes, as an object: an object, a flat list or a list of pairs. */
function headersOf(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return {}
  if (!Array.isArray(value)) return value as Record<string, unknown>
  const pairs = value.every(Array.isArray)
    ? (value as unknown[][])
    : Array.from({ length: value.length >> 1 }, (_, at) => [value[2 * at], value[2 * at + 1]])
  const out = new Map<string, unknown>()
  for (const [name, item] of pairs) {
    const key = String(name).toLowerCase()
    out.set(key, out.has(key) ? [out.get(key), item].flat() : item)
  }
  return Object.fromEntries(out)
}

/** The reason phrase and headers of `writeHead(status, reason?, headers?)`. */
function headOf(rest: unknown[]): { reason?: string; headers: Record<string, unknown> } {
  return typeof rest[0] === 'string'
    ? { reason: rest[0], headers: headersOf(rest[1]) }
    : { headers: headersOf(rest[0]) }
}

/** The bytes and the completion callback of `write(chunk, encoding?, callback?)` or `end(...)`. */
function partsOf(args: unknown[]): { bytes: Buffer; done: (() => void) | undefined } {
  const [first, second, third] = args
  const done = [first, second, third].find((arg) => typeof arg === 'function') as
    (() => void) | undefined
  return { bytes: bytesOf(first, second), done }
}

/** The bytes of one chunk a writer was given. */
function bytesOf(chunk: unknown, encoding: unknown): Buffer {
  if (typeof chunk === 'string') {
    return Buffer.from(chunk, typeof encoding === 'string' ? (encoding as BufferEncoding) : 'utf8')
  }
  return chunk instanceof Uint8Array ? Buffer.from(chunk) : Buffer.alloc(0)
}

/** The header map of an answer: those set on the response, then those `writeHead` passed, lower-cased. */
function merged(raw: WireResponse, passed: Record<string, unknown>): Record<string, unknown> {
  const all: Record<string, unknown> = { ...raw.getHeaders() }
  for (const [name, value] of Object.entries(passed)) all[name.toLowerCase()] = value
  return all
}

/** The text of `body` when it decodes as UTF-8 and encodes back to the same bytes. */
function textOf(body: Buffer): string | undefined {
  const text = body.toString('utf8')
  return Buffer.from(text, 'utf8').equals(body) ? text : undefined
}

/** The writers of `raw` as they were, bound to it. */
function originals(raw: WireResponse): Writers {
  return {
    writeHead: raw.writeHead.bind(raw),
    write: raw.write.bind(raw),
    end: raw.end.bind(raw)
  }
}

/** Replace the three writers of `raw`; the replacements stay in place and delegate once they are done. */
function install(raw: WireResponse, writers: Writers): void {
  Object.assign(raw, writers)
}

/** What the tap has seen of the answer so far. */
interface Held {
  chunks: Buffer[]
  passed: Record<string, unknown>
  reason: string | undefined
  done: (() => void) | undefined
  status: number | undefined
  size: number
  holding: boolean
}

type Writers = Pick<WireResponse, 'writeHead' | 'write' | 'end'>

/** Stop holding: send the head and the chunks seen so far through the original writers. */
function release(held: Held, real: Writers): void {
  held.holding = false
  if (held.status !== undefined && held.reason === undefined)
    real.writeHead(held.status, held.passed)
  else if (held.status !== undefined) real.writeHead(held.status, held.reason, held.passed)
  for (const chunk of held.chunks) real.write(chunk)
}

/** Tell `settle` what was sent, then send it unless something else already ended the response. */
async function deliver(
  raw: WireResponse,
  real: Writers,
  held: Held,
  settle: (answer: Wire) => Promise<void>
): Promise<void> {
  const head = merged(raw, held.passed)
  const encoded = typeof head['content-encoding'] === 'string'
  await settle({
    status: held.status ?? raw.statusCode,
    headers: head,
    body: held.holding && !encoded ? textOf(Buffer.concat(held.chunks)) : undefined
  })
  if (raw.writableEnded || (held.holding && raw.headersSent)) return
  try {
    if (held.holding) {
      const unsized =
        head['content-length'] === undefined && head['transfer-encoding'] === undefined
      if (held.size > 0 && unsized) {
        held.status ??= raw.statusCode
        held.passed = { ...held.passed, 'content-length': held.size }
      }
      release(held, real)
    }
    real.end(held.done)
  } catch {
    raw.destroy()
  }
}

/**
 * Hold what the route writes to `raw` until `settle` has been told the answer, then send it unchanged.
 *
 * A body past `limit` bytes, or `streamed`, is sent as it is written and is not held; the answer then
 * carries no body. The `end` waits for `settle`; a second `end` while it waits goes straight out, so an
 * answer written by something else, such as a request deadline, is not held behind it.
 *
 * @param raw - The raw response.
 * @param limit - The largest body that is held.
 * @param streamed - Whether the value is a stream or bytes, which are never held.
 * @param settle - Told what was sent before it is; it never rejects.
 */
export function tap(
  raw: WireResponse,
  limit: number,
  streamed: boolean,
  settle: (answer: Wire) => Promise<void>
): void {
  const real = originals(raw)
  const held: Held = {
    chunks: [],
    passed: {},
    reason: undefined,
    done: undefined,
    status: undefined,
    size: 0,
    holding: !streamed
  }
  let ending = false

  const hold = (bytes: Buffer): void => {
    held.size += bytes.length
    held.chunks.push(bytes)
    if (held.size > limit) release(held, real)
  }

  install(raw, {
    writeHead: (code, ...rest) => {
      if (ending) return real.writeHead(code, ...rest)
      held.status = code
      ;({ reason: held.reason, headers: held.passed } = headOf(rest))
      return held.holding ? raw : real.writeHead(code, ...rest)
    },
    write: (chunk, ...rest) => {
      if (!held.holding || ending) return real.write(chunk, ...rest)
      const { bytes, done } = partsOf([chunk, ...rest])
      hold(bytes)
      if (done !== undefined) process.nextTick(done)
      return true
    },
    end: (...args) => {
      if (ending) return real.end(...args)
      ending = true
      const { bytes, done } = partsOf(args)
      held.done = done
      if (held.holding) hold(bytes)
      else if (bytes.length > 0) real.write(bytes)
      void deliver(raw, real, held, settle)
      return raw
    }
  })
}

/** The headers of a write that describe the body it carried, dropped when the stored body is sent. */
const BODY_HEADERS = [
  'content-length',
  'content-type',
  'content-encoding',
  'etag',
  'transfer-encoding'
]

/**
 * Send `stored` in place of the first write that is not an error answer: one below `400`, whatever its
 * status, or at the status the response had when this was called, which is the route's own. Any other
 * write at `400` or above, such as the error of an interceptor outside this one, goes out as it is; an
 * outer error at exactly the route's own `4xx` status cannot be told from the replay and is replaced.
 *
 * @param raw - The raw response.
 * @param status - The stored status, the one the replacement is sent with.
 * @param headers - The stored headers.
 * @param body - The stored body.
 */
export function substitute(
  raw: WireResponse,
  status: number,
  headers: Readonly<Record<string, string>>,
  body: string
): void {
  const real = originals(raw)
  const initial = raw.statusCode
  let passed: Record<string, unknown> | undefined
  let taken: boolean | undefined

  const take = (code: number): boolean => (taken ??= code < 400 || code === initial)
  const answer = (done?: () => void): void => {
    const own = Object.fromEntries(
      Object.entries(passed ?? {}).filter(([name]) => {
        const lower = name.toLowerCase()
        return !BODY_HEADERS.includes(lower) && !(lower in headers)
      })
    )
    for (const name of BODY_HEADERS) raw.removeHeader(name)
    const bytes = Buffer.from(body, 'utf8')
    const sized = status === 204 ? {} : { 'content-length': bytes.length }
    real.writeHead(status, { ...own, ...headers, ...sized })
    real.end(bytes, done)
  }

  install(raw, {
    writeHead: (code, ...rest) => {
      if (!take(code)) return real.writeHead(code, ...rest)
      passed = headOf(rest).headers
      return raw
    },
    write: (chunk, ...rest) => {
      if (!take(raw.statusCode)) return real.write(chunk, ...rest)
      const { done } = partsOf([chunk, ...rest])
      if (done !== undefined) process.nextTick(done)
      return true
    },
    end: (...args) => {
      if (!take(raw.statusCode)) return real.end(...args)
      if (!raw.writableEnded) answer(partsOf(args).done)
      return raw
    }
  })
}
