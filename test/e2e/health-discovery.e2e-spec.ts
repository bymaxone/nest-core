/**
 * End-to-end suite: health-indicator discovery.
 *
 * Layer: e2e.
 * Goal: prove the promise the feature makes to an application, over real HTTP:
 * importing a module whose provider is marked as an indicator makes that check
 * appear in readiness with nothing registered by hand; a discovered check can
 * fail the probe; an explicitly registered indicator still wins its name; and
 * with the feature off, a marked provider changes nothing.
 * Mocks: none; a real Express Nest application driven with supertest, reached
 * only through the published specifiers.
 */
import { Global, Module } from '@nestjs/common'
import type { INestApplication, ModuleMetadata } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { BymaxCoreModule, BYMAX_HEALTH_INDICATORS } from '@bymax-one/nest-core'
import type { BymaxCoreModuleOptions } from '@bymax-one/nest-core'
import { BymaxHealthIndicator } from '@bymax-one/nest-core/health'
import type { HealthIndicatorResult, IHealthIndicator } from '@bymax-one/nest-core/health'

/**
 * An indicator shipped by a library the application merely imports, declared the
 * way a sibling `@bymax-one/*` package would declare one.
 */
@BymaxHealthIndicator()
class CacheHealthIndicator implements IHealthIndicator {
  readonly name = 'cache'

  /** Whether the simulated dependency is currently reachable. */
  private reachable = true

  /**
   * Switch the reported status, so one test can flip readiness mid-suite.
   *
   * @param reachable - `true` reports healthy.
   */
  setReachable(reachable: boolean): void {
    this.reachable = reachable
  }

  /**
   * Report the configured status.
   *
   * @returns `up` when reachable, `down` otherwise.
   */
  async check(): Promise<HealthIndicatorResult> {
    return this.reachable ? { status: 'up' } : { status: 'down' }
  }
}

/** The library module a consuming application imports. */
@Global()
@Module({ providers: [CacheHealthIndicator], exports: [CacheHealthIndicator] })
class CacheLibraryModule {}

/** An indicator the application registers by hand, under a name the library also uses. */
const applicationCacheIndicator: IHealthIndicator = {
  name: 'cache',
  check: async (): Promise<HealthIndicatorResult> => ({ status: 'up', details: { owner: 'app' } })
}

/** The application's own binding of the explicit indicator multi-token. */
@Global()
@Module({
  providers: [{ provide: BYMAX_HEALTH_INDICATORS, useValue: [applicationCacheIndicator] }],
  exports: [BYMAX_HEALTH_INDICATORS]
})
class ApplicationIndicatorsModule {}

/** Boot an application importing the library module, with the given core options. */
async function bootApp(
  options: BymaxCoreModuleOptions,
  extraImports: NonNullable<ModuleMetadata['imports']> = []
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [BymaxCoreModule.forRoot(options), CacheLibraryModule, ...extraImports]
  }).compile()
  const app = moduleRef.createNestApplication()
  await app.init()
  return app
}

describe('health indicator discovery', () => {
  let app: INestApplication | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  /**
   * The feature, end to end.
   *
   * An application that imports a library and enables discovery gets that
   * library's readiness check without naming it anywhere — the whole point of
   * the marker.
   */
  it('reports a marked indicator from an imported module without any registration', async () => {
    app = await bootApp({ health: { autoDiscover: true } })

    const response = await request(app.getHttpServer()).get('/health/ready')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: 'ok', checks: [{ name: 'cache', status: 'up' }] })
  })

  /**
   * A discovered check can take the application out of rotation.
   *
   * Aggregating a check that cannot fail the probe would be decoration; this is
   * the behavior that makes discovery worth enabling, and the risk that makes it
   * opt-in.
   */
  it('fails readiness when a discovered indicator reports down', async () => {
    app = await bootApp({ health: { autoDiscover: true } })
    app.get(CacheHealthIndicator).setReachable(false)

    const response = await request(app.getHttpServer()).get('/health/ready')

    expect(response.status).toBe(503)
    expect(response.body).toEqual({ status: 'error', checks: [{ name: 'cache', status: 'down' }] })
  })

  /**
   * The application's own indicator wins the name.
   *
   * A library must not be able to replace a check the application already
   * defined; the explicit registration keeps both the name and its result.
   */
  it('keeps the explicitly registered indicator when the names collide', async () => {
    app = await bootApp({ health: { autoDiscover: true } }, [ApplicationIndicatorsModule])

    const response = await request(app.getHttpServer()).get('/health/ready')

    expect(response.body).toEqual({
      status: 'ok',
      checks: [{ name: 'cache', status: 'up', details: { owner: 'app' } }]
    })
  })

  /**
   * Off by default, and observationally identical to before. Regression guard.
   *
   * The same application, with the same marked provider in the container, must
   * report exactly what it reported before this feature existed.
   */
  it('ignores marked providers while discovery is disabled', async () => {
    app = await bootApp({})

    const response = await request(app.getHttpServer()).get('/health/ready')

    expect(response.body).toEqual({ status: 'ok', checks: [] })
  })

  /**
   * Discovery works on the asynchronous registration path too.
   *
   * That path cannot decide its imports from the resolved options, so it always
   * imports Nest's discovery module and gates at runtime instead; this proves
   * the gate opens.
   */
  it('discovers indicators when the module is registered asynchronously', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        BymaxCoreModule.forRootAsync({
          inject: [],
          useFactory: () => ({ health: { autoDiscover: true } })
        }),
        CacheLibraryModule
      ]
    }).compile()
    app = moduleRef.createNestApplication()
    await app.init()

    const response = await request(app.getHttpServer()).get('/health/ready')

    expect(response.body).toEqual({ status: 'ok', checks: [{ name: 'cache', status: 'up' }] })
  })
})
