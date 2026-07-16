/**
 * @fileoverview The end-to-end fixture application. Boots a real Nest
 * application (Express, driven by supertest) with `BymaxCoreModule` wired
 * exactly the way a real application would wire it: one small controller
 * exercising the happy path, a mapped `HttpException`, an unmapped error, and
 * an artificially slow route; a stub correlation provider and a stub health
 * indicator bound through the documented consumer-override pattern (a
 * `@Global()` sibling module providing `BYMAX_CORRELATION_PROVIDER` and
 * `BYMAX_HEALTH_INDICATORS`, imported alongside `BymaxCoreModule`), so both
 * stubs are switchable at request time from the test that built the fixture.
 * Every README integration example is mirrored by this file, so a snippet a
 * consumer copies from the README is guaranteed to compile and behave exactly
 * as shown here.
 * @layer Fixture
 */
import { Controller, Get, Global, Module, NotFoundException } from '@nestjs/common'
import type { DynamicModule, INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import {
  BymaxCoreModule,
  BYMAX_CORRELATION_PROVIDER,
  BYMAX_HEALTH_INDICATORS
} from '@bymax-one/nest-core'
import type { BymaxCoreModuleOptions, ICorrelationIdProvider } from '@bymax-one/nest-core'
import type { HealthIndicatorResult, IHealthIndicator } from '@bymax-one/nest-core/health'

/** Milliseconds the fixture's slow route artificially waits before replying. */
export const FIXTURE_SLOW_ROUTE_DELAY_MS = 20

/**
 * Correlation provider stub. Mutable so a single test can flip the id it
 * resolves and observe the effect on a subsequent request's envelope.
 */
export class StubCorrelationIdProvider implements ICorrelationIdProvider {
  private id: string | undefined = 'fixture-correlation-id'

  /**
   * Change the id resolved by subsequent calls, or clear it.
   *
   * @param id - The new correlation id, or `undefined` to resolve none.
   */
  setCorrelationId(id: string | undefined): void {
    this.id = id
  }

  /**
   * Resolve the currently configured correlation id.
   *
   * @returns The current correlation id, or `undefined` when cleared.
   */
  getCorrelationId(): string | undefined {
    return this.id
  }
}

/**
 * Health indicator stub. Starts up and is switchable to down and back, so a
 * single test can flip readiness mid-suite and observe the transition.
 */
export class StubHealthIndicator implements IHealthIndicator {
  readonly name = 'fixture-dependency'

  private isUp = true

  /**
   * Switch the indicator's reported status.
   *
   * @param up - `true` reports healthy; `false` reports the dependency down.
   */
  setUp(up: boolean): void {
    this.isUp = up
  }

  /**
   * Report the currently configured status.
   *
   * @returns `up` with no detail, or `down` with a safe diagnostic reason.
   */
  async check(): Promise<HealthIndicatorResult> {
    return this.isUp
      ? { status: 'up' }
      : { status: 'down', details: { reason: 'fixture indicator forced down' } }
  }
}

/**
 * The fixture's HTTP surface: one happy route, one mapped `HttpException`, one
 * unmapped error, and one artificially slow route, so every documented
 * mapping rule and the timing interceptor both have a route to exercise.
 */
@Controller()
export class FixtureController {
  /** Returns a trivial success body. */
  @Get('happy')
  happy(): { ok: boolean } {
    return { ok: true }
  }

  /** Throws a mapped `HttpException`, exercising the catalog-derived code path. */
  @Get('missing')
  missing(): never {
    throw new NotFoundException('fixture resource not found')
  }

  /** Throws a plain `Error`, exercising the unknown-error collapse. */
  @Get('boom')
  boom(): never {
    throw new Error('fixture unexpected failure')
  }

  /** Waits past a short delay before replying, for slow-flag assertions. */
  @Get('slow')
  async slow(): Promise<{ ok: boolean }> {
    await new Promise((resolve) => {
      setTimeout(resolve, FIXTURE_SLOW_ROUTE_DELAY_MS)
    })
    return { ok: true }
  }
}

/**
 * Build the `@Global()` sibling module binding the stub correlation provider
 * and the stub health indicator, mirroring the consumer-override pattern
 * documented in the technical specification (§4.3): `BymaxCoreModule` binds
 * no local default for either token, so this module's bindings reach
 * `BymaxExceptionFilter` and `HealthService` directly.
 *
 * @param correlation - The stub correlation provider instance to bind.
 * @param indicator - The stub health indicator instance to bind.
 * @returns The dynamic module to import alongside `BymaxCoreModule`.
 */
function observabilityModule(
  correlation: StubCorrelationIdProvider,
  indicator: StubHealthIndicator
): DynamicModule {
  @Global()
  @Module({
    providers: [
      { provide: BYMAX_CORRELATION_PROVIDER, useValue: correlation },
      { provide: BYMAX_HEALTH_INDICATORS, useValue: [indicator] }
    ],
    exports: [BYMAX_CORRELATION_PROVIDER, BYMAX_HEALTH_INDICATORS]
  })
  class ObservabilityModule {}
  return { module: ObservabilityModule }
}

/** How the fixture registers `BymaxCoreModule`: the sync or the async path. */
export type FixtureRegistration =
  | { readonly kind: 'sync'; readonly options: BymaxCoreModuleOptions }
  | { readonly kind: 'async'; readonly factory: () => BymaxCoreModuleOptions }

/** The booted fixture application plus its switchable stub instances. */
export interface Fixture {
  readonly app: INestApplication
  readonly correlation: StubCorrelationIdProvider
  readonly indicator: StubHealthIndicator
}

/**
 * Boot the fixture application with `BymaxCoreModule` registered per
 * `registration`, the stub correlation provider and health indicator bound
 * through the real consumer-override mechanism.
 *
 * @param registration - Which registration path to exercise, and its options.
 * @returns The booted application and its stub instances.
 */
export async function buildFixtureApp(registration: FixtureRegistration): Promise<Fixture> {
  const correlation = new StubCorrelationIdProvider()
  const indicator = new StubHealthIndicator()
  const coreModule =
    registration.kind === 'sync'
      ? BymaxCoreModule.forRoot(registration.options)
      : BymaxCoreModule.forRootAsync({ inject: [], useFactory: registration.factory })
  const moduleRef = await Test.createTestingModule({
    imports: [coreModule, observabilityModule(correlation, indicator)],
    controllers: [FixtureController]
  }).compile()
  const app = moduleRef.createNestApplication()
  await app.init()
  return { app, correlation, indicator }
}

/**
 * Boot a bare Nest application exposing the same `FixtureController` with no
 * `BymaxCoreModule` involved at all: the reference used to prove the async
 * everything-off pass-through is byte-for-byte transparent.
 *
 * @returns The booted bare application.
 */
export async function buildBareApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [FixtureController]
  }).compile()
  const app = moduleRef.createNestApplication()
  await app.init()
  return app
}
