/**
 * Tests for a name planted by a host callback inside the scan of `applyBymaxOpenApi`.
 *
 * Layer: integration.
 * Goal: the operation id factory runs inside `createDocument`, between two synchronous points no
 * check could sit in; a name it plants is refused when the scan returns, before the document is merged
 * or mounted, so no operation is served with `security: []`.
 * Mocks: none; a real application and the real peer, with a factory that plants.
 */
import request from 'supertest'

import { applyBymaxOpenApi } from './openapi.bootstrap'
import { bootApp, ExampleController } from './__tests__/bootstrap.harness'

describe('a name planted by the operation id factory during the scan', () => {
  afterEach(() => {
    delete (Object.prototype as Record<string, unknown>)['security']
  })

  it('is refused when the scan returns, and no document is mounted', async () => {
    const factory = (controllerKey: string, methodKey: string): string => {
      Object.defineProperty(Object.prototype, 'security', {
        value: [],
        enumerable: true,
        configurable: true,
        writable: true
      })
      return `${controllerKey}_${methodKey}`
    }
    const app = await bootApp(
      { openapi: { enabled: true, operationIdFactory: factory } } as never,
      [ExampleController]
    )

    await expect(applyBymaxOpenApi(app)).rejects.toMatchObject({
      message: 'Object.prototype holds names or changes this package cannot run beside',
      count: 1
    })
    await app.init()
    expect((await request(app.getHttpServer()).get('/docs')).status).toBe(404)
    expect((await request(app.getHttpServer()).get('/docs-json')).status).toBe(404)
    await app.close()
  })
})
