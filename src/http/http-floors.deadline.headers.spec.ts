/**
 * Tests for the framing headers a handler set before the request deadline answered.
 *
 * Layer: integration.
 * Goal: the `504` envelope a client receives is a complete JSON body whatever body headers the handler
 * had already set, so a pending `Content-Length` or `Content-Encoding` never frames the envelope.
 * Mocks: none; a real HTTP server and client around the middleware.
 */
import { createServer, request as send } from 'node:http'
import type { AddressInfo } from 'node:net'

import { requestDeadline } from './http-floors.deadline'

/** What the client saw of a request whose handler set `headers` and then held the response. */
async function get(headers: Record<string, string>): Promise<{
  status: number
  body: string
  error?: string | undefined
  headers?: Record<string, unknown>
}> {
  const middleware = requestDeadline({ timeoutMs: 50, excludePaths: [] })
  const server = createServer((request, response) => {
    middleware(request as never, response as never, () => {
      for (const [name, value] of Object.entries(headers)) response.setHeader(name, value)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  try {
    return await new Promise((resolve) => {
      const req = send({ host: '127.0.0.1', port, path: '/slow' }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () =>
          resolve({
            status: res.statusCode as number,
            body: Buffer.concat(chunks).toString('utf8'),
            headers: res.headers
          })
        )
        res.on('error', (error) => resolve({ status: 0, body: '', error: error.message }))
      })
      req.on('error', (error: NodeJS.ErrnoException) =>
        resolve({ status: 0, body: '', error: String(error.code) })
      )
      req.end()
    })
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}

describe('the 504 envelope after a handler set body headers', () => {
  it('is a complete JSON body when the handler set Content-Length', async () => {
    const seen = await get({ 'content-length': '2' })

    expect(seen.error).toBeUndefined()
    expect(seen.status).toBe(504)
    expect(JSON.parse(seen.body)).toMatchObject({ statusCode: 504 })
  })

  it.each([
    ['transfer-encoding', 'chunked'],
    ['content-encoding', 'gzip'],
    ['content-range', 'bytes 0-1/2'],
    ['content-md5', 'Q2hlY2sgSW50ZWdyaXR5IQ=='],
    ['content-language', 'pt-BR'],
    ['content-disposition', 'attachment; filename="a.bin"'],
    ['etag', '"abc"']
  ])('does not carry %s the handler set onto the envelope', async (name, value) => {
    const seen = await get({ [name]: value })

    expect(JSON.parse(seen.body)).toMatchObject({ statusCode: 504 })
    expect(seen.headers?.[name]).toBeUndefined()
  })
})
