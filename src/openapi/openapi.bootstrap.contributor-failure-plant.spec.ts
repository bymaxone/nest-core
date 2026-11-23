/**
 * Tests for the failure of a build whose contributor planted a name while `Object.prototype` holds a planted name.
 *
 * Layer: integration.
 * Goal: a contributor that plants a name a property descriptor reads ends the build with the guard's
 * refusal, a count only, and never with a `TypeError` that quotes the planted value.
 * Mocks: none; a real application and the real peer, with a contributor that plants.
 */
import { BymaxOpenApiContributor, BYMAX_OPENAPI_CONTRACT_VERSION } from './openapi.contract'
import type { IOpenApiContributor, OpenApiFragment } from './openapi.contract'
import { applyBymaxOpenApi } from './openapi.bootstrap'
import { bootApp, ExampleController } from './__tests__/bootstrap.harness'

const PLANTED = 'PLANTED-VALUE-7f3a91'

@BymaxOpenApiContributor()
class AccessorPlantingContributor implements IOpenApiContributor {
  contributeOpenApi(): OpenApiFragment {
    Object.defineProperty(Object.prototype, 'get', {
      value: PLANTED,
      enumerable: true,
      configurable: true,
      writable: true
    })
    return { contractVersion: BYMAX_OPENAPI_CONTRACT_VERSION }
  }
}

describe('a contributor that plants a name a dependency reads as an accessor', () => {
  afterEach(() => {
    delete (Object.prototype as Record<string, unknown>)['get']
  })

  it('fails the build with a cause that carries a count and not the planted value', async () => {
    const app = await bootApp(
      { openapi: { enabled: true } } as never,
      [ExampleController],
      [AccessorPlantingContributor]
    )

    const failure = (await applyBymaxOpenApi(app).then(
      () => undefined,
      (error: unknown) => error
    )) as Error & { count?: number }
    await app.close()

    expect(failure).toMatchObject({
      message: 'Object.prototype holds names or changes this package cannot run beside',
      count: 1
    })
    expect(JSON.stringify([failure.message, failure.cause, failure.stack])).not.toContain(PLANTED)
  })
})
