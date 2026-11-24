/**
 * End-to-end suite: the probe and scrape routes under every versioning mode.
 *
 * Layer: e2e.
 * Goal: prove that health and metrics answer at the configured path whatever versioning the host
 * enables, and answer at no versioned path: a URI default version does not move them to `/v1/...`,
 * header and media-type versioning do not require a version header, and with no versioning nothing
 * changes. The OpenAPI document lists them at the configured path.
 * Mocks: none; a real Express Nest application driven with supertest.
 */
import { VersioningType } from '@nestjs/common'
import type { INestApplication, VersioningOptions } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { BymaxCoreModule } from '@bymax-one/nest-core'
import { applyBymaxOpenApi } from '@bymax-one/nest-core/openapi'

/** Boot an application with health and metrics on and the given versioning, if any. */
async function boot(
  versioning: VersioningOptions | undefined,
  document = false
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      BymaxCoreModule.forRoot({
        health: { enabled: true, path: 'probes' },
        metrics: { enabled: true, path: 'scrape' },
        openapi: { enabled: true }
      })
    ]
  }).compile()
  const app = moduleRef.createNestApplication()
  if (versioning !== undefined) app.enableVersioning(versioning)
  if (document) await applyBymaxOpenApi(app)
  await app.init()
  return app
}

describe('health and metrics under the host versioning', () => {
  const original = process.env['NODE_ENV']
  let app: INestApplication | undefined

  beforeEach(() => {
    process.env['NODE_ENV'] = 'development'
  })

  afterEach(async () => {
    await app?.close()
    app = undefined
    process.env['NODE_ENV'] = original
  })

  /**
   * A URI default version must not move the probes: a kubelet or scraper configured with the
   * option path would otherwise get a 404.
   */
  it('answers at the configured path and not under /v1 with URI versioning and a default version', async () => {
    app = await boot({ type: VersioningType.URI, defaultVersion: '1' })
    const server = app.getHttpServer()

    await request(server).get('/probes/live').expect(200)
    await request(server).get('/probes/ready').expect(200)
    await request(server).get('/scrape').expect(200)
    await request(server).get('/v1/probes/live').expect(404)
    await request(server).get('/v1/probes/ready').expect(404)
    await request(server).get('/v1/scrape').expect(404)
  })

  it('answers at the configured path with no versioning', async () => {
    app = await boot(undefined)
    const server = app.getHttpServer()

    await request(server).get('/probes/live').expect(200)
    await request(server).get('/probes/ready').expect(200)
    await request(server).get('/scrape').expect(200)
  })

  it('answers without a version header under header versioning', async () => {
    app = await boot({ type: VersioningType.HEADER, header: 'X-API-Version', defaultVersion: '1' })
    const server = app.getHttpServer()

    await request(server).get('/probes/live').expect(200)
    await request(server).get('/scrape').expect(200)
  })

  it('answers without a version in the accept header under media-type versioning', async () => {
    app = await boot({ type: VersioningType.MEDIA_TYPE, key: 'v=', defaultVersion: '1' })
    const server = app.getHttpServer()

    await request(server).get('/probes/live').expect(200)
    await request(server).get('/scrape').expect(200)
  })

  /** The document documents the path a client can actually call. */
  it('lists the routes in the OpenAPI document at the configured path under URI versioning', async () => {
    app = await boot({ type: VersioningType.URI, defaultVersion: '1' }, true)

    const response = await request(app.getHttpServer()).get('/docs-json').expect(200)
    const paths = Object.keys((response.body as { paths: object }).paths)

    expect(paths).toContain('/probes/live')
    expect(paths).toContain('/scrape')
    expect(paths.filter((path) => path.startsWith('/v1/probes') || path === '/v1/scrape')).toEqual(
      []
    )
  })
})
