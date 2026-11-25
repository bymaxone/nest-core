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
  writeHead(status: number, headers?: unknown): unknown
  write(chunk: unknown, encoding?: unknown): boolean
  end(chunk?: unknown, encoding?: unknown): unknown
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

/** The headers a `writeHead` call passes, as an object. */
function headersOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
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
function originals(raw: WireResponse): Pick<WireResponse, 'writeHead' | 'write' | 'end'> {
  return {
    writeHead: raw.writeHead.bind(raw),
    write: raw.write.bind(raw),
    end: raw.end.bind(raw)
  }
}

/** Replace the three writers of `raw`; the replacements stay in place and delegate once they are done. */
function install(
  raw: WireResponse,
  writers: Pick<WireResponse, 'writeHead' | 'write' | 'end'>
): void {
  Object.assign(raw, writers)
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
  const chunks: Buffer[] = []
  let passed: Record<string, unknown> = {}
  let status: number | undefined
  let size = 0
  let holding = !streamed
  let ending = false

  const hold = (bytes: Buffer): void => {
    size += bytes.length
    chunks.push(bytes)
    if (size > limit) release()
  }
  const release = (): void => {
    holding = false
    if (status !== undefined) real.writeHead(status, passed)
    for (const chunk of chunks.splice(0)) real.write(chunk)
  }
  const sent = async (): Promise<void> => {
    const body = Buffer.concat(chunks)
    const head = merged(raw, passed)
    const code = status ?? raw.statusCode
    const encoded = typeof head['content-encoding'] === 'string'
    await settle({
      status: code,
      headers: head,
      body: holding && !encoded ? textOf(body) : undefined
    })
    if (raw.writableEnded || (holding && raw.headersSent)) return
    try {
      if (holding) release()
      real.end()
    } catch {
      raw.destroy()
    }
  }

  install(raw, {
    writeHead: (code, headers) => {
      if (ending) return real.writeHead(code, headers)
      status = code
      passed = headersOf(headers)
      return holding ? raw : real.writeHead(code, headers)
    },
    write: (chunk, encoding) => {
      if (!holding || ending) return real.write(chunk, encoding)
      hold(bytesOf(chunk, encoding))
      return true
    },
    end: (chunk, encoding) => {
      if (ending) return real.end(chunk, encoding)
      ending = true
      const bytes = bytesOf(chunk, encoding)
      if (holding) hold(bytes)
      else if (bytes.length > 0) real.write(bytes)
      void sent()
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
 * Send `stored` in place of the first write that carries the stored status or the status the route was
 * given before the handler; any other first write, such as the error of an interceptor outside this
 * one, goes out as it is.
 *
 * @param raw - The raw response.
 * @param status - The stored status, the one the write to replace carries.
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
  let passed: Record<string, unknown> | undefined
  let taken: boolean | undefined
  const route = raw.statusCode

  const take = (code: number): boolean => (taken ??= code === status || code === route)
  const answer = (): void => {
    const own = Object.fromEntries(
      Object.entries(passed ?? {}).filter(([name]) => !BODY_HEADERS.includes(name.toLowerCase()))
    )
    for (const name of BODY_HEADERS) raw.removeHeader(name)
    const bytes = Buffer.from(body, 'utf8')
    real.writeHead(status, { ...own, ...headers, 'content-length': bytes.length })
    real.end(bytes)
  }

  install(raw, {
    writeHead: (code, passedHeaders) => {
      if (!take(code)) return real.writeHead(code, passedHeaders)
      passed = headersOf(passedHeaders)
      return raw
    },
    write: (chunk, encoding) => (take(raw.statusCode) ? true : real.write(chunk, encoding)),
    end: (chunk, encoding) => {
      if (!take(raw.statusCode)) return real.end(chunk, encoding)
      if (!raw.writableEnded) answer()
      return raw
    }
  })
}
