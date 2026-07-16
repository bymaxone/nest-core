/**
 * End-to-end suite: cross-feature seams.
 *
 * Layer: e2e.
 * Goal: prove the seams between features actually hold when the assembled
 * surface runs end to end, not merely in each feature's own isolated suite:
 * the envelope carries whatever the bound correlation provider currently
 * resolves, including its absence; the timing interceptor's samples feed the
 * metrics bridge with an exact, accumulating count per route; and readiness
 * flips both ways as the bound health indicator's status changes.
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

describe('cross-feature seams, all features enabled', () => {
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
   * The envelope tracks the bound provider live, not a cached value.
   *
   * Changing what the stub correlation provider resolves, and clearing it
   * entirely, must be reflected on the very next request: the filter reads
   * the provider per request, it does not snapshot an id once at construction.
   */
  it('carries whatever the bound correlation provider currently resolves', async () => {
    const first = await request(app?.getHttpServer()).get('/missing').expect(404)
    expect(first.body.correlationId).toBe('fixture-correlation-id')

    fixture?.correlation.setCorrelationId('second-request-id')
    const second = await request(app?.getHttpServer()).get('/missing').expect(404)
    expect(second.body.correlationId).toBe('second-request-id')

    fixture?.correlation.setCorrelationId(undefined)
    const third = await request(app?.getHttpServer()).get('/missing').expect(404)
    expect(third.body).not.toHaveProperty('correlationId')
  })

  /**
   * Timing feeds the metrics bridge with an exact, accumulating count.
   *
   * Every completed request against a route increments that route's
   * `http_requests_total` series by exactly one; three requests against the
   * same route must scrape back exactly `3`, proving the timing interceptor's
   * samples are the metrics bridge's only source, with no double counting and
   * no missed samples.
   */
  it('accumulates an exact http_requests_total count for a route after N requests', async () => {
    const requestCount = 3
    // Requests run sequentially, on purpose: each must independently increment
    // the counter before the next one starts, matching "N requests in, N in
    // the counter" without relying on the server serializing overlapping calls.
    for (let i = 0; i < requestCount; i += 1) {
      await request(app?.getHttpServer()).get('/happy').expect(200)
    }

    const response = await request(app?.getHttpServer()).get('/metrics').expect(200)

    const match =
      /http_requests_total\{method="GET",route="\/happy",status_code="200"\} (\d+)/.exec(
        response.text
      )
    expect(match?.[1]).toBe(String(requestCount))
  })

  /**
   * Readiness flips both ways as the indicator's status changes.
   *
   * Switching the stub indicator down must flip readiness to 503; switching
   * it back up must flip readiness back to 200, proving the aggregator reads
   * the indicator live on every request rather than caching its first result.
   */
  it('flips /health/ready from 200 to 503 and back to 200', async () => {
    await request(app?.getHttpServer()).get('/health/ready').expect(200)

    fixture?.indicator.setUp(false)
    await request(app?.getHttpServer()).get('/health/ready').expect(503)

    fixture?.indicator.setUp(true)
    const restored = await request(app?.getHttpServer()).get('/health/ready').expect(200)
    expect(restored.body).toEqual({
      status: 'ok',
      checks: [{ name: 'fixture-dependency', status: 'up' }]
    })
  })
})
