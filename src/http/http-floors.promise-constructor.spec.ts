/**
 * Tests for the CORS and request-deadline decisions while `Promise.prototype.constructor` is replaced.
 *
 * Layer: integration.
 * Goal: a replaced constructor, which `await` reads, makes CORS list no origin and makes the deadline
 * treat no path as excluded, so a listed origin is refused and an excluded path is answered `504`.
 * Mocks: none; the real option builder and a real HTTP server around the middleware.
 */
import { createServer, request as send } from 'node:http'
import type { AddressInfo } from 'node:net'

import { replaceConstructor, restorePromise } from '../__tests__/promise-forgery.harness'
import { resolveCors } from './http-floors.cors'
import { requestDeadline } from './http-floors.deadline'

/** The status the client saw for `/slow`, whose handler holds the response. */
async function statusOfExcludedPath(): Promise<number> {
  const middleware = requestDeadline({ timeoutMs: 50, excludePaths: ['/slow'] })
  const server = createServer((request, response) => {
    middleware(request as never, response as never, () => undefined)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  try {
    return await new Promise<number>((resolve) => {
      const req = send({ host: '127.0.0.1', port, path: '/slow', timeout: 400 }, (res) => {
        res.resume()
        resolve(res.statusCode as number)
      })
      req.on('timeout', () => {
        req.destroy()
        resolve(0)
      })
      req.on('error', () => resolve(0))
      req.end()
    })
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}

describe('the floors beside a replaced Promise.prototype.constructor', () => {
  afterEach(restorePromise)

  it('keeps an excluded path held while the constructor is intact', async () => {
    expect(await statusOfExcludedPath()).toBe(0)
  })

  it('answers an excluded path 504 once the constructor was replaced', async () => {
    replaceConstructor()

    expect(await statusOfExcludedPath()).toBe(504)
  })

  it('lists no origin once the constructor was replaced', async () => {
    const delegate = resolveCors({ origins: ['https://app.example'], credentials: true } as never)
    const ask = (): Promise<unknown> =>
      new Promise((resolve) => {
        ;(delegate as never as (r: object, done: (e: null, o: unknown) => void) => void)(
          { headers: { origin: 'https://app.example' } },
          (_error, options) => resolve(options)
        )
      })
    const before = await ask()
    replaceConstructor()
    const after = await ask()
    restorePromise()

    expect(before).toMatchObject({ origin: 'https://app.example' })
    expect(after).toEqual({ origin: false })
  })
})
