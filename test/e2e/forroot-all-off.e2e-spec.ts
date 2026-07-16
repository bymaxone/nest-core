/**
 * End-to-end suite: `BymaxCoreModule.forRoot` with every feature disabled.
 *
 * Layer: e2e.
 * Goal: prove a fully-disabled configuration registers nothing observable:
 * health and metrics routes 404 (no controller registered, not merely an
 * error body at the same path); a mapped `HttpException` and an unknown error
 * both flow through Nest's own default error handling, with no `code` field,
 * proving the envelope filter is not registered at all.
 * Mocks: none beyond the fixture; a real Express Nest app driven with
 * supertest.
 */
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'

import { buildFixtureApp } from './fixture/app.fixture'

/** Options disabling every feature. */
const ALL_OFF = {
  envelope: { enabled: false },
  timing: { enabled: false },
  health: { enabled: false },
  metrics: { enabled: false }
}

describe('BymaxCoreModule.forRoot, all features disabled', () => {
  let app: INestApplication | undefined

  beforeEach(async () => {
    const fixture = await buildFixtureApp({ kind: 'sync', options: ALL_OFF })
    app = fixture.app
  })

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  /**
   * No health routes.
   *
   * Disabled health registers no controller at all, so both endpoints must
   * 404 rather than reply with a disabled-feature error body.
   */
  it('replies 404 for both health endpoints', async () => {
    await request(app?.getHttpServer()).get('/health/live').expect(404)
    await request(app?.getHttpServer()).get('/health/ready').expect(404)
  })

  /**
   * No metrics route.
   *
   * Disabled metrics registers no controller at all, so the scrape endpoint
   * must 404.
   */
  it('replies 404 for the metrics endpoint', async () => {
    await request(app?.getHttpServer()).get('/metrics').expect(404)
  })

  /**
   * Mapped HttpException uses Nest's own default body.
   *
   * With the envelope filter absent, a NotFoundException must produce Nest's
   * own default error shape: the correct status and message, and no `code`
   * field anywhere in the response.
   */
  it('formats a mapped HttpException with Nest defaults, no envelope code', async () => {
    const response = await request(app?.getHttpServer()).get('/missing').expect(404)

    expect(response.body).toMatchObject({ statusCode: 404, message: 'fixture resource not found' })
    expect(response.body).not.toHaveProperty('code')
    expect(response.body).not.toHaveProperty('correlationId')
  })

  /**
   * Unknown error uses Nest's own default body.
   *
   * With the envelope filter absent, a plain Error must produce Nest's own
   * default 500 shape, with no `code` field and no envelope-specific fields.
   */
  it('formats an unknown error with Nest defaults, no envelope code', async () => {
    const response = await request(app?.getHttpServer()).get('/boom').expect(500)

    expect(response.body).toMatchObject({ statusCode: 500 })
    expect(response.body).not.toHaveProperty('code')
    expect(response.body).not.toHaveProperty('correlationId')
  })
})
