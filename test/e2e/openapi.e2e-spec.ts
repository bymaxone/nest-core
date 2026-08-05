/**
 * End-to-end suite: the OpenAPI document.
 *
 * Layer: e2e.
 * Goal: prove the promise the feature makes to an application, over real HTTP:
 * a document and a UI appear in development with nothing wired locally beyond
 * one bootstrap call; the schemas this package contributes are in the served
 * document; the application's own routes and this package's health endpoints
 * keep working after the document is mounted; and in production nothing is
 * served at all, whatever the configuration says.
 * Mocks: none; a real Express Nest application driven with supertest, reached
 * only through the published specifiers.
 */
import { Controller, Get, Module } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { BymaxCoreModule } from '@bymax-one/nest-core'
import type { BymaxCoreModuleOptions } from '@bymax-one/nest-core'
import { applyBymaxOpenApi } from '@bymax-one/nest-core/openapi'

/** One ordinary application route, used to prove mounting the document is not destructive. */
@Controller()
class InvoicesController {
  /** Returns a trivial success body. */
  @Get('invoices')
  list(): { items: readonly string[] } {
    return { items: [] }
  }
}

/** The consuming application: exactly what a template would generate. */
@Module({ controllers: [InvoicesController] })
class AppModule {}

/**
 * Build the consuming application without initializing it, so each spec can
 * apply the document first and initialize afterwards, which is the order a real
 * bootstrap follows between `NestFactory.create` and `listen`.
 */
async function bootApp(options: BymaxCoreModuleOptions): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [BymaxCoreModule.forRoot(options), AppModule]
  }).compile()
  return moduleRef.createNestApplication()
}

describe('OpenAPI document, development runtime', () => {
  const originalNodeEnv = process.env['NODE_ENV']
  let app: INestApplication | undefined

  beforeEach(async () => {
    process.env['NODE_ENV'] = 'development'
    app = await bootApp({
      openapi: {
        enabled: true,
        title: 'Invoices API',
        version: '3.1.4',
        securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } }
      }
    })
    await applyBymaxOpenApi(app)
    await app.init()
  })

  afterEach(async () => {
    await app?.close()
    app = undefined
    process.env['NODE_ENV'] = originalNodeEnv
  })

  /**
   * The interactive UI is served.
   *
   * The whole point of the feature from a developer's seat: open the route and
   * read the API. Asserting on the HTML content type rather than the body keeps
   * the test independent of the UI bundle's markup.
   */
  it('serves the interactive UI at the configured route', async () => {
    const response = await request(app?.getHttpServer()).get('/docs')

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toMatch(/html/)
  })

  /**
   * The document describes the application and this package's contracts.
   *
   * The application's own route must be discovered by the scan, and the schemas
   * this package owns must be contributed alongside it — that combination is
   * what makes the served document complete without the application declaring
   * anything by hand.
   */
  it('serves a document carrying both the scanned routes and the contributed schemas', async () => {
    const response = await request(app?.getHttpServer()).get('/docs-json')

    expect(response.status).toBe(200)
    expect(response.body.info).toMatchObject({ title: 'Invoices API', version: '3.1.4' })
    expect(response.body.paths).toHaveProperty('/invoices')
    expect(Object.keys(response.body.components.schemas)).toEqual(
      expect.arrayContaining([
        'BymaxErrorEnvelope',
        'BymaxHealthResponse',
        'BymaxPageResult',
        'BymaxCursorResult'
      ])
    )
    expect(response.body.components.parameters).toHaveProperty('BymaxPageQueryPage')
    expect(response.body.components.securitySchemes).toHaveProperty('bearer')
  })

  /**
   * Mounting the document is not destructive. Regression guard.
   *
   * Mounting re-registers routes on the HTTP adapter, and doing it in the wrong
   * order silently replaces the router: the document appears and every other
   * route in the application starts returning 404. Both an application route
   * and one of this package's own endpoints are asserted, because that failure
   * takes out everything at once.
   */
  it('leaves the application and health routes working after mounting', async () => {
    const invoices = await request(app?.getHttpServer()).get('/invoices')
    const liveness = await request(app?.getHttpServer()).get('/health/live')

    expect(invoices.status).toBe(200)
    expect(liveness.status).toBe(200)
    expect(liveness.body).toEqual({ status: 'ok', checks: [] })
  })
})

describe('OpenAPI document, production runtime', () => {
  const originalNodeEnv = process.env['NODE_ENV']
  let app: INestApplication | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
    process.env['NODE_ENV'] = originalNodeEnv
  })

  /**
   * Production serves nothing, even when it was explicitly enabled.
   *
   * This is the security guarantee, asserted the only way that matters: over
   * HTTP, against an application whose configuration asked for the document.
   * Both routes must be indistinguishable from any other unknown path, and the
   * rest of the application must be untouched.
   */
  it('serves neither the UI nor the document while the application keeps working', async () => {
    process.env['NODE_ENV'] = 'production'
    app = await bootApp({ openapi: { enabled: true } })

    const outcome = await applyBymaxOpenApi(app)
    await app.init()
    const ui = await request(app.getHttpServer()).get('/docs')
    const document = await request(app.getHttpServer()).get('/docs-json')
    const invoices = await request(app.getHttpServer()).get('/invoices')

    expect(outcome).toEqual({ mounted: false, reason: 'production' })
    expect(ui.status).toBe(404)
    expect(document.status).toBe(404)
    expect(invoices.status).toBe(200)
  })

  /**
   * An unset environment is production. Fail-closed boundary.
   *
   * The deployment nobody configured is the one most likely to be exposed, so
   * it must behave exactly like a declared production runtime.
   */
  it('serves nothing when NODE_ENV is not set at all', async () => {
    delete process.env['NODE_ENV']
    app = await bootApp({ openapi: { enabled: true } })

    const outcome = await applyBymaxOpenApi(app)
    await app.init()
    const ui = await request(app.getHttpServer()).get('/docs')

    expect(outcome).toEqual({ mounted: false, reason: 'production' })
    expect(ui.status).toBe(404)
  })
})
