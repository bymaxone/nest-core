/**
 * End-to-end suite: `BymaxCoreModule.forRoot` with every feature enabled
 * together.
 *
 * Layer: e2e.
 * Goal: prove the assembled surface works together the way a real
 * application consumes it: the envelope contract holds exactly for a mapped
 * `HttpException` and for a collapsed unknown error (including the stub
 * provider's correlation id); liveness and readiness both respond, readiness
 * reflecting the stub indicator; the metrics endpoint scrapes Prometheus text
 * after traffic has flowed.
 * Mocks: the fixture's stub correlation provider and stub health indicator
 * (`test/e2e/fixture/app.fixture.ts`); a real Express Nest app driven with
 * supertest.
 */
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'

import { buildFixtureApp } from './fixture/app.fixture'
import type { Fixture } from './fixture/app.fixture'

/** Options enabling every feature, metrics included, all at once. */
const ALL_ON = {
  envelope: { enabled: true },
  timing: { enabled: true },
  health: { enabled: true },
  metrics: { enabled: true }
}

describe('BymaxCoreModule.forRoot, all features enabled', () => {
  let fixture: Fixture | undefined
  let app: INestApplication | undefined

  beforeEach(async () => {
    fixture = await buildFixtureApp({ kind: 'sync', options: ALL_ON })
    app = fixture.app
  })

  afterEach(async () => {
    await app?.close()
    app = undefined
    fixture = undefined
  })

  /**
   * Mapped HttpException, exact envelope.
   *
   * A NotFoundException must produce the full documented envelope shape,
   * including the correlation id stamped by the bound stub provider.
   */
  it('formats a mapped HttpException into the exact envelope contract', async () => {
    const response = await request(app?.getHttpServer()).get('/missing').expect(404)

    expect(response.body).toMatchObject({
      statusCode: 404,
      code: 'BYMAX_NOT_FOUND',
      message: 'fixture resource not found',
      correlationId: 'fixture-correlation-id',
      path: '/missing'
    })
    expect(typeof response.body.timestamp).toBe('string')
  })

  /**
   * Unknown error, exact collapsed envelope.
   *
   * A plain Error must collapse to the fixed, production-safe 500 envelope,
   * still carrying the correlation id, with no internal detail leaked.
   */
  it('collapses an unknown error into the exact production-safe envelope', async () => {
    const response = await request(app?.getHttpServer()).get('/boom').expect(500)

    expect(response.body).toStrictEqual({
      statusCode: 500,
      code: 'BYMAX_INTERNAL_ERROR',
      message: 'Internal server error',
      correlationId: 'fixture-correlation-id',
      timestamp: response.body.timestamp,
      path: '/boom'
    })
    expect(JSON.stringify(response.body)).not.toContain('fixture unexpected failure')
  })

  /**
   * Liveness always responds.
   *
   * Liveness must reply 200 with the documented empty-checks shape regardless
   * of the stub indicator's state.
   */
  it('responds 200 on /health/live', async () => {
    const response = await request(app?.getHttpServer()).get('/health/live').expect(200)

    expect(response.body).toEqual({ status: 'ok', checks: [] })
  })

  /**
   * Readiness reflects the stub indicator, up and down.
   *
   * Readiness must reply 200 while the stub indicator is up, and flip to 503
   * naming the failing check once the stub is switched down.
   */
  it('responds 200 on /health/ready while the stub indicator is up, 503 once switched down', async () => {
    const up = await request(app?.getHttpServer()).get('/health/ready').expect(200)
    expect(up.body).toEqual({
      status: 'ok',
      checks: [{ name: 'fixture-dependency', status: 'up' }]
    })

    fixture?.indicator.setUp(false)

    const down = await request(app?.getHttpServer()).get('/health/ready').expect(503)
    expect(down.body).toEqual({
      status: 'error',
      checks: [
        {
          name: 'fixture-dependency',
          status: 'down',
          details: { reason: 'fixture indicator forced down' }
        }
      ]
    })
  })

  /**
   * Metrics scrape after traffic.
   *
   * After a request flows, the metrics endpoint must serve Prometheus text
   * format containing `http_requests_total` labeled for the route that was
   * actually hit.
   */
  it('serves /metrics with http_requests_total after traffic flows', async () => {
    await request(app?.getHttpServer()).get('/happy').expect(200)

    const response = await request(app?.getHttpServer()).get('/metrics').expect(200)

    expect(response.headers['content-type']).toContain('text/plain')
    expect(response.text).toContain('http_requests_total')
    expect(response.text).toMatch(
      /http_requests_total\{method="GET",route="\/happy",status_code="200"\}/
    )
  })
})
