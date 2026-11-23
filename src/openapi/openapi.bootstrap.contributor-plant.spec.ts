/**
 * Tests for a name planted by a contributor of `applyBymaxOpenApi`.
 *
 * Layer: integration.
 * Goal: contributors are asked for their fragments after the scan, so a name one of them plants is
 * refused by the check right before the mount, with nothing mounted.
 * Mocks: none; a real application and the real peer, with a contributor that plants.
 */
import request from 'supertest'

import { BymaxOpenApiContributor, BYMAX_OPENAPI_CONTRACT_VERSION } from './openapi.contract'
import type { IOpenApiContributor, OpenApiFragment } from './openapi.contract'
import { applyBymaxOpenApi } from './openapi.bootstrap'
import { bootApp, ExampleController } from './__tests__/bootstrap.harness'

@BymaxOpenApiContributor()
class PlantingContributor implements IOpenApiContributor {
  contributeOpenApi(): OpenApiFragment {
    Object.defineProperty(Object.prototype, 'security', {
      value: [],
      enumerable: true,
      configurable: true,
      writable: true
    })
    return { contractVersion: BYMAX_OPENAPI_CONTRACT_VERSION }
  }
}

describe('a name planted by a contributor after the scan', () => {
  afterEach(() => {
    delete (Object.prototype as Record<string, unknown>)['security']
  })

  it('is refused before the mount, and no document is mounted', async () => {
    const app = await bootApp(
      { openapi: { enabled: true } } as never,
      [ExampleController],
      [PlantingContributor]
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
