/**
 * End-to-end suite: `BymaxCoreModule.forRootAsync`, mirroring the sync-path
 * assertions and proving the async pass-through is byte-for-byte transparent.
 *
 * Layer: e2e.
 * Goal: prove the async registration path (the standard pattern in real
 * applications, per the technical specification §4.2) behaves identically to
 * `forRoot` when every feature is enabled together; and prove that with every
 * feature resolved disabled, a request through the always-on pipeline slots
 * is observably identical, body and status, to the same request against a
 * bare Nest application with no `BymaxCoreModule` involved at all.
 * Mocks: the fixture's stub correlation provider and stub health indicator
 * (`test/e2e/fixture/app.fixture.ts`); a real Express Nest app driven with
 * supertest.
 */
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'

import { buildBareApp, buildFixtureApp } from './fixture/app.fixture'
import type { Fixture } from './fixture/app.fixture'

/** Factory producing options enabling every feature, metrics included. */
const ALL_ON_FACTORY = (): {
  envelope: { enabled: boolean }
  timing: { enabled: boolean }
  health: { enabled: boolean }
  metrics: { enabled: boolean }
} => ({
  envelope: { enabled: true },
  timing: { enabled: true },
  health: { enabled: true },
  metrics: { enabled: true }
})

describe('BymaxCoreModule.forRootAsync, all features enabled', () => {
  let fixture: Fixture | undefined
  let app: INestApplication | undefined

  beforeEach(async () => {
    fixture = await buildFixtureApp({ kind: 'async', factory: ALL_ON_FACTORY })
    app = fixture.app
  })

  afterEach(async () => {
    await app?.close()
    app = undefined
    fixture = undefined
  })

  /**
   * Mapped HttpException, exact envelope, async path.
   *
   * Mirrors the sync-path assertion: the async slot must resolve the real
   * filter and stamp the stub provider's correlation id.
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

  /** Liveness responds 200 on the async path, same as the sync path. */
  it('responds 200 on /health/live', async () => {
    await request(app?.getHttpServer()).get('/health/live').expect(200)
  })

  /**
   * Readiness reflects the stub indicator on the async path.
   *
   * The always-registered health controller must reflect a real readiness
   * flip, not merely respond with a fixed shape.
   */
  it('flips /health/ready to 503 when the stub indicator goes down', async () => {
    await request(app?.getHttpServer()).get('/health/ready').expect(200)

    fixture?.indicator.setUp(false)

    const response = await request(app?.getHttpServer()).get('/health/ready').expect(503)
    expect(response.body.status).toBe('error')
  })

  /** Metrics scrape after traffic on the async path, same as the sync path. */
  it('serves /metrics with http_requests_total after traffic flows', async () => {
    await request(app?.getHttpServer()).get('/happy').expect(200)

    const response = await request(app?.getHttpServer()).get('/metrics').expect(200)

    expect(response.text).toMatch(
      /http_requests_total\{method="GET",route="\/happy",status_code="200"\}/
    )
  })
})

describe('BymaxCoreModule.forRootAsync, all features disabled: pass-through transparency', () => {
  let fixture: Fixture | undefined
  let bareApp: INestApplication | undefined

  afterEach(async () => {
    await fixture?.app.close()
    await bareApp?.close()
    fixture = undefined
    bareApp = undefined
  })

  /**
   * Byte-for-byte identical happy-path response.
   *
   * With every feature resolved disabled, the always-on `APP_FILTER` and
   * `APP_INTERCEPTOR` slots select their transparent pass-through
   * implementations; a request must therefore produce the exact same status
   * and body as the same request against a bare application with no
   * `BymaxCoreModule` at all, proving the pass-through adds no observable
   * behavior.
   */
  it('replies identically to a bare app for the happy route', async () => {
    fixture = await buildFixtureApp({
      kind: 'async',
      factory: () => ({
        envelope: { enabled: false },
        timing: { enabled: false },
        health: { enabled: false },
        metrics: { enabled: false }
      })
    })
    bareApp = await buildBareApp()

    const fromFixture = await request(fixture.app.getHttpServer()).get('/happy')
    const fromBare = await request(bareApp.getHttpServer()).get('/happy')

    expect(fromFixture.status).toBe(fromBare.status)
    expect(fromFixture.body).toEqual(fromBare.body)
  })

  /**
   * Byte-for-byte identical error response.
   *
   * The pass-through exception filter delegates to the same default handling
   * Nest applies with no filter at all, so a mapped HttpException must
   * produce the exact same status and body against the fixture (envelope
   * disabled) and the bare app.
   */
  it('replies identically to a bare app for a mapped HttpException', async () => {
    fixture = await buildFixtureApp({
      kind: 'async',
      factory: () => ({
        envelope: { enabled: false },
        timing: { enabled: false },
        health: { enabled: false },
        metrics: { enabled: false }
      })
    })
    bareApp = await buildBareApp()

    const fromFixture = await request(fixture.app.getHttpServer()).get('/missing')
    const fromBare = await request(bareApp.getHttpServer()).get('/missing')

    expect(fromFixture.status).toBe(fromBare.status)
    expect(fromFixture.body).toEqual(fromBare.body)
  })
})
