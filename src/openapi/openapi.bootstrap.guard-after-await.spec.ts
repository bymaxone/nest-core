/**
 * Unit tests for the guard's place in `applyBymaxOpenApi`.
 *
 * Layer: integration.
 * Goal: a name planted on `Object.prototype` after the guard first ran and before `@nestjs/swagger` reads
 * (the lazy load of the peer is an `await` between them) is refused, so the guard runs again after the
 * last `await`, immediately before the synchronous scan, and nothing planted is served.
 * Mocks: `loadSwagger`, which plants the name while it loads the real peer.
 */
import { applyBymaxOpenApi } from './openapi.bootstrap'
import { bootApp, ExampleController } from './__tests__/bootstrap.harness'

jest.mock('./openapi.loader', () => {
  const actual = jest.requireActual<typeof import('./openapi.loader')>('./openapi.loader')
  return {
    ...actual,
    loadSwagger: async () => {
      const swagger = await actual.loadSwagger()
      const planted = (globalThis as { __planted?: string }).__planted
      if (planted !== undefined) {
        Object.defineProperty(Object.prototype, planted, {
          value: [],
          enumerable: true,
          configurable: true,
          writable: true
        })
      }
      return swagger
    }
  }
})

describe('a name planted while the peer loads', () => {
  afterEach(() => {
    const planted = (globalThis as { __planted?: string }).__planted
    if (planted !== undefined) delete (Object.prototype as Record<string, unknown>)[planted]
    delete (globalThis as { __planted?: string }).__planted
  })

  it.each(['security', 'responses', 'description'])(
    'is refused when %s is planted after the first check, and no document is mounted',
    async (name) => {
      const app = await bootApp({ openapi: { enabled: true } } as never, [ExampleController])
      ;(globalThis as { __planted?: string }).__planted = name

      await expect(applyBymaxOpenApi(app)).rejects.toMatchObject({
        message: 'Object.prototype holds names or changes this package cannot run beside',
        count: 1
      })
      await app.close()
    }
  )
})
