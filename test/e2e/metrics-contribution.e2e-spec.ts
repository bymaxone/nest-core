/**
 * End-to-end suite: metrics contribution.
 *
 * Layer: e2e.
 * Goal: prove the promise the contract makes, over real HTTP: importing a module
 * whose provider is marked as a contributor puts that library's metrics on the
 * application's scrape endpoint with nothing registered by hand; the default
 * HTTP metrics still work alongside them; a colliding metric name fails the boot
 * naming the contributor; and with metrics off, a marked provider changes
 * nothing and the peer is never reached.
 * Mocks: none; a real Express Nest application driven with supertest, reached
 * only through the published specifiers.
 */
import { Global, Module } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { Counter } from 'prom-client'
import request from 'supertest'

import { BymaxCoreModule } from '@bymax-one/nest-core'
import type { BymaxCoreModuleOptions } from '@bymax-one/nest-core'
import { BymaxMetricsContributor } from '@bymax-one/nest-core/metrics'
import type { IMetricsContributor, MetricsRegistry } from '@bymax-one/nest-core/metrics'

/** A contributor shipped by a library the application merely imports. */
@BymaxMetricsContributor()
class QueueMetricsContributor implements IMetricsContributor {
  /**
   * Publish the library's own collector.
   *
   * @param registry - The registry the scrape endpoint serves.
   */
  registerMetrics(registry: MetricsRegistry): void {
    new Counter({
      name: 'bymax_queue_jobs_total',
      help: 'Jobs processed by the queue library',
      registers: [registry]
    }).inc(3)
  }
}

/** A second contributor claiming the same metric name, to force a collision. */
@BymaxMetricsContributor()
class CollidingContributor implements IMetricsContributor {
  /**
   * Publish a collector under a name another contributor already claimed.
   *
   * @param registry - The registry the scrape endpoint serves.
   */
  registerMetrics(registry: MetricsRegistry): void {
    new Counter({
      name: 'bymax_queue_jobs_total',
      help: 'A colliding definition',
      registers: [registry]
    })
  }
}

/** The library module a consuming application imports. */
@Global()
@Module({ providers: [QueueMetricsContributor], exports: [QueueMetricsContributor] })
class QueueLibraryModule {}

/** A second library whose contributor collides with the first. */
@Global()
@Module({ providers: [CollidingContributor], exports: [CollidingContributor] })
class CollidingLibraryModule {}

/** Boot an application importing the queue library, with the given core options. */
async function bootApp(options: BymaxCoreModuleOptions): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [BymaxCoreModule.forRoot(options), QueueLibraryModule]
  }).compile()
  const app = moduleRef.createNestApplication()
  await app.init()
  return app
}

describe('metrics contribution', () => {
  let app: INestApplication | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  /**
   * The feature, end to end.
   *
   * An application that imports a library and enables metrics gets that
   * library's collectors on its own scrape endpoint, with no token injected and
   * nothing registered.
   */
  it('serves a library collector at the scrape endpoint with no registration', async () => {
    app = await bootApp({ metrics: { enabled: true, collectDefaultMetrics: false } })

    const response = await request(app.getHttpServer()).get('/metrics')

    expect(response.status).toBe(200)
    expect(response.text).toContain('bymax_queue_jobs_total 3')
  })

  /**
   * Contributed metrics live alongside the package's own.
   *
   * The registry is shared, so the HTTP metrics the timing bridge feeds and a
   * library's collectors must appear in the same scrape — that is the entire
   * point of contributing to one registry rather than standing up another.
   */
  it('serves contributed and built-in HTTP metrics from the same registry', async () => {
    app = await bootApp({
      metrics: { enabled: true, collectDefaultMetrics: false },
      timing: { enabled: true }
    })
    await request(app.getHttpServer()).get('/health/live')

    const response = await request(app.getHttpServer()).get('/metrics')

    expect(response.text).toContain('bymax_queue_jobs_total')
    expect(response.text).toContain('http_requests_total')
  })

  /**
   * A name collision fails the boot, naming the contributor.
   *
   * Two libraries claiming one metric name is a real composition failure. It
   * must surface at startup with the responsible class named, not as a partially
   * populated scrape endpoint nobody notices.
   *
   * Which of the two is named is not a coin flip: contributors run sorted by
   * class name, so `CollidingContributor` registers first and
   * `QueueMetricsContributor` is the one that collides — on every boot. Asserting
   * the specific name is what proves that ordering holds end to end.
   */
  it('fails to boot naming the contributor whose metric name collides', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        BymaxCoreModule.forRoot({ metrics: { enabled: true, collectDefaultMetrics: false } }),
        QueueLibraryModule,
        CollidingLibraryModule
      ]
    }).compile()
    const built = moduleRef.createNestApplication()

    await expect(built.init()).rejects.toThrow(
      /"QueueMetricsContributor" failed to register its metrics: .*bymax_queue_jobs_total/
    )
    await built.close()
  })

  /**
   * Metrics off means contribution off. Regression guard.
   *
   * The marked provider is still in the container; with the feature disabled it
   * must not run, and the scrape route must not exist at all.
   */
  it('runs no contributor and serves no scrape route while metrics are disabled', async () => {
    app = await bootApp({})

    const response = await request(app.getHttpServer()).get('/metrics')

    expect(response.status).toBe(404)
  })
})
