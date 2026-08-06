/**
 * @fileoverview `BymaxCoreModule`, the dynamic module every feature plugs into.
 * Built on `ConfigurableModuleBuilder`; the `isGlobal` extra maps to
 * `DynamicModule.global` via `setExtras`. The synchronous `forRoot` path knows
 * the options at definition time and omits disabled features from the providers
 * and controllers arrays; the asynchronous `forRootAsync` path registers
 * always-on pipeline slots and a health controller that self-guards against a
 * disabled or path-mismatched resolved configuration at request time.
 * @layer Module
 */
import { ConfigurableModuleBuilder, Module } from '@nestjs/common'
import type {
  DynamicModule,
  ExceptionFilter,
  NestInterceptor,
  Provider,
  Type
} from '@nestjs/common'
import { APP_FILTER, APP_INTERCEPTOR, DiscoveryModule, HttpAdapterHost } from '@nestjs/core'

import { DEFAULT_HEALTH_PATH, DEFAULT_METRICS_PATH, normalizeCoreOptions } from './core.options'
import type { BymaxCoreModuleOptions, ResolvedCoreOptions } from './core.options'
import {
  BYMAX_CORE_OPTIONS,
  BYMAX_CORRELATION_PROVIDER,
  BYMAX_METRICS_REGISTRY,
  BYMAX_TIMING_SINK
} from './core.tokens'
import { buildDefaultProviders, buildTraceContextProvider } from './defaults.providers'
import type { ICorrelationIdProvider } from './envelope/correlation.interfaces'
import { BymaxExceptionFilter } from './envelope/exception.filter'
import { createHealthController } from './health/health.controller'
import { HealthService } from './health/health.service'
import { MetricsContributionRunner } from './metrics/metrics.contribution'
import { createMetricsController } from './metrics/metrics.controller'
import {
  buildMetricsRegistryProvider,
  buildMetricsTimingSinkProvider
} from './metrics/metrics.providers'
import { selectAsyncExceptionFilter, selectAsyncTimingInterceptor } from './passthrough.providers'
import { BYMAX_TIMING_CLOCK } from './timing/timing.clock'
import type { MonotonicClock } from './timing/timing.clock'
import { TimingInterceptor } from './timing/timing.interceptor'
import type { ITimingSink } from './timing/timing.interfaces'

/** Non-option extras accepted by `forRoot` / `forRootAsync`. */
export interface BymaxCoreModuleExtras {
  /** Register the module globally. Default: `true`. */
  isGlobal?: boolean
}

/**
 * Builder-generated base. `BUILDER_OPTIONS_TOKEN` carries the RAW consumer
 * options and stays internal; the public, defaults-applied snapshot is exposed
 * separately under {@link BYMAX_CORE_OPTIONS}. `isGlobal` (default `true`) maps
 * to `DynamicModule.global`, replacing a manual `@Global()` decorator.
 */
// Stryker disable ObjectLiteral: equivalent — removing the `{ isGlobal: true }` default does not change `global`. The callback below reads `isGlobal !== false`: with the default present a caller who says nothing gets `true`, and with it gone the same caller gets `undefined`, which is also not `false`. Either way the module is global for every extras input. The literal stays because it states the default where the extras are declared and gives them their type. The block form is required because a directive does not attach inside a builder chain.
export const {
  ConfigurableModuleClass: BymaxCoreModuleBase,
  MODULE_OPTIONS_TOKEN: BUILDER_OPTIONS_TOKEN,
  OPTIONS_TYPE,
  ASYNC_OPTIONS_TYPE
} = new ConfigurableModuleBuilder<BymaxCoreModuleOptions>()
  .setClassMethodName('forRoot')
  .setExtras<BymaxCoreModuleExtras>({ isGlobal: true }, (definition, extras) => ({
    ...definition,
    // `setExtras` merges the `{ isGlobal: true }` default first, so `isGlobal`
    // is always defined; `!== false` keeps "global unless explicitly disabled".
    global: extras.isGlobal !== false
  }))
  .build()
// Stryker restore ObjectLiteral

/**
 * Build the feature providers registered on the synchronous path. Disabled
 * features contribute nothing, so a fully-disabled configuration yields an
 * empty array. The envelope filter registers as the outermost `APP_FILTER`
 * only when the envelope feature is enabled; the timing interceptor registers
 * as `APP_INTERCEPTOR` only when the timing feature is enabled; `HealthService`
 * is registered only when the health feature is enabled, matching its
 * controller counterpart in {@link buildControllers}. The metrics registry
 * provider is added only when metrics are enabled, so a disabled configuration
 * never loads `prom-client`; the metrics timing-sink bridge is added only when
 * timing and metrics are both enabled, so HTTP samples feed the default HTTP
 * metrics (otherwise `TimingInterceptor` falls back to its own in-code no-op,
 * or to a consumer's own `BYMAX_TIMING_SINK` binding, when one is enabled).
 *
 * @param resolved - The resolved options snapshot the gate reads.
 * @returns The conditionally-registered feature providers.
 */
function buildSyncProviders(resolved: ResolvedCoreOptions): Provider[] {
  const providers: Provider[] = []
  if (resolved.envelope.enabled) {
    providers.push({ provide: APP_FILTER, useClass: BymaxExceptionFilter })
  }
  if (resolved.timing.enabled) {
    providers.push({ provide: APP_INTERCEPTOR, useClass: TimingInterceptor })
  }
  if (resolved.health.enabled) {
    providers.push(HealthService)
  }
  if (resolved.telemetry.enabled) {
    providers.push(buildTraceContextProvider())
  }
  if (resolved.metrics.enabled) {
    providers.push(buildMetricsRegistryProvider())
    providers.push(MetricsContributionRunner)
    if (resolved.timing.enabled) {
      providers.push(buildMetricsTimingSinkProvider())
    }
  }
  return providers
}

/**
 * Build the controllers registered on the synchronous path. Disabled features
 * register no controller and therefore no route: when the health feature is
 * disabled, `createHealthController` is never called and no health route
 * exists, and likewise for metrics. When enabled, each controller is built for
 * its resolved path, honoring a fully custom prefix.
 *
 * @param resolved - The resolved options snapshot the gate reads.
 * @returns The conditionally-registered controllers.
 */
function buildControllers(resolved: ResolvedCoreOptions): Type[] {
  const controllers: Type[] = []
  if (resolved.health.enabled) {
    controllers.push(createHealthController(resolved.health.path))
  }
  if (resolved.metrics.enabled) {
    controllers.push(createMetricsController(resolved.metrics.path))
  }
  return controllers
}

/**
 * Build the always-on pipeline slots for the asynchronous path. Async options
 * are unknown at definition time, so both slots are registered unconditionally
 * and each factory injects the resolved options to pick the real implementation
 * when its feature is enabled or the transparent pass-through otherwise. The
 * correlation provider is injected as an optional dependency: `BymaxCoreModule`
 * binds no local default for that token, so a sibling consumer module's own
 * binding is not shadowed by one (see `defaults.providers.ts`); the factory
 * hands the possibly-`undefined` result to {@link selectAsyncExceptionFilter},
 * which forwards it to `BymaxExceptionFilter`'s own no-op fallback.
 *
 * @returns The `APP_FILTER` and `APP_INTERCEPTOR` slot providers.
 */
function buildAsyncSlots(): Provider[] {
  return [
    {
      provide: APP_FILTER,
      useFactory: (
        options: ResolvedCoreOptions,
        correlation: ICorrelationIdProvider | undefined,
        adapterHost: HttpAdapterHost
      ): ExceptionFilter => selectAsyncExceptionFilter(options, correlation, adapterHost),
      inject: [
        BYMAX_CORE_OPTIONS,
        { token: BYMAX_CORRELATION_PROVIDER, optional: true },
        HttpAdapterHost
      ]
    },
    {
      provide: APP_INTERCEPTOR,
      useFactory: (
        options: ResolvedCoreOptions,
        sink: ITimingSink,
        clock: MonotonicClock
      ): NestInterceptor => selectAsyncTimingInterceptor(options, sink, clock),
      inject: [BYMAX_CORE_OPTIONS, BYMAX_TIMING_SINK, BYMAX_TIMING_CLOCK]
    }
  ]
}

/**
 * Merge library providers, controllers, and exports into the builder-produced
 * base definition. The `?? []` guards keep the merge total across any base
 * shape the builder may return, present or absent arrays alike.
 *
 * @internal Exported only for unit testing; NOT re-exported by the package
 *   barrel, so it is not part of the public API.
 * @param base - The `DynamicModule` returned by the builder.
 * @param providers - Library providers to append.
 * @param controllers - Controllers to append.
 * @param exportTokens - The full set of tokens to export. Callers list only
 *   the tokens actually provided on their path: `BYMAX_CORRELATION_PROVIDER`
 *   and `BYMAX_HEALTH_INDICATORS` are never listed, since `BymaxCoreModule`
 *   binds no local provider for them (see `defaults.providers.ts`), and
 *   exporting an unprovided token is rejected by Nest at bootstrap.
 * @returns The augmented `DynamicModule`.
 */
export function augmentModule(
  base: DynamicModule,
  providers: Provider[],
  controllers: Type[],
  exportTokens: (string | symbol)[] = [BYMAX_CORE_OPTIONS],
  imports: NonNullable<DynamicModule['imports']> = []
): DynamicModule {
  return {
    ...base,
    module: BymaxCoreModule,
    imports: [...(base.imports ?? []), ...imports],
    providers: [...(base.providers ?? []), ...providers],
    controllers: [...(base.controllers ?? []), ...controllers],
    exports: [...(base.exports ?? []), ...exportTokens]
  }
}

/**
 * `BymaxCoreModule`, the application foundation module for NestJS 11.
 */
@Module({})
export class BymaxCoreModule extends BymaxCoreModuleBase {
  /**
   * Register the module synchronously. Options are known now, so disabled
   * features are omitted from the providers and controllers arrays and the
   * resolved snapshot is provided under {@link BYMAX_CORE_OPTIONS}.
   *
   * @param options - Core options plus the optional `isGlobal` extra. Omit for
   *   all documented defaults.
   * @returns The configured `DynamicModule`.
   * @example
   *   BymaxCoreModule.forRoot({ metrics: { enabled: true } })
   */
  static override forRoot(options: typeof OPTIONS_TYPE = {}): DynamicModule {
    const resolved = normalizeCoreOptions(options)
    const providers: Provider[] = [
      { provide: BYMAX_CORE_OPTIONS, useValue: resolved },
      ...buildDefaultProviders(),
      ...buildSyncProviders(resolved)
    ]
    // Export only the tokens `buildSyncProviders` actually bound above: the
    // metrics registry when metrics are enabled, and the timing sink when the
    // metrics bridge replaced the interceptor's own no-op fallback (metrics
    // and timing both enabled). `BYMAX_CORRELATION_PROVIDER` and
    // `BYMAX_HEALTH_INDICATORS` are never exported here; see `augmentModule`.
    const exportTokens: (string | symbol)[] = [BYMAX_CORE_OPTIONS]
    if (resolved.metrics.enabled) {
      exportTokens.push(BYMAX_METRICS_REGISTRY)
      if (resolved.timing.enabled) {
        exportTokens.push(BYMAX_TIMING_SINK)
      }
    }
    // `DiscoveryModule` is imported only when a marker-based scan can actually
    // run — readiness discovery, or metrics contribution — so a configuration
    // that needs neither registers nothing extra.
    const scansProviders =
      (resolved.health.enabled && resolved.health.autoDiscover) || resolved.metrics.enabled
    const imports = scansProviders ? [DiscoveryModule] : []
    return augmentModule(
      super.forRoot(options),
      providers,
      buildControllers(resolved),
      exportTokens,
      imports
    )
  }

  /**
   * Register the module asynchronously. The resolved options are produced by
   * the consumer's factory and normalized under {@link BYMAX_CORE_OPTIONS}.
   * Because those options are unknown when the module is defined, the pipeline
   * slots register unconditionally and gate at runtime with transparent
   * pass-throughs. The health controller cannot register conditionally either,
   * since its route metadata is fixed before the async options resolve: it is
   * always registered at the default health path, and its handlers guard
   * every request against the resolved options being disabled or requesting a
   * different path, throwing a descriptive configuration error in either case.
   * The metrics controller follows the same mechanism at the default metrics
   * path; the `BYMAX_METRICS_REGISTRY` factory gates on the resolved options and
   * resolves to a guarded placeholder when metrics are disabled, so the optional
   * peer `prom-client` is never loaded unless metrics are actually enabled.
   *
   * @param options - Async options (factory + inject + imports, or class).
   * @returns The configured `DynamicModule`.
   * @example
   *   BymaxCoreModule.forRootAsync({ inject: [Config], useFactory: (c) => ({ ... }) })
   */
  static override forRootAsync(options: typeof ASYNC_OPTIONS_TYPE): DynamicModule {
    const providers: Provider[] = [
      {
        provide: BYMAX_CORE_OPTIONS,
        useFactory: (raw?: BymaxCoreModuleOptions): ResolvedCoreOptions =>
          normalizeCoreOptions(raw),
        inject: [BUILDER_OPTIONS_TOKEN]
      },
      ...buildDefaultProviders(),
      ...buildAsyncSlots(),
      HealthService,
      buildMetricsRegistryProvider(),
      buildMetricsTimingSinkProvider(),
      MetricsContributionRunner,
      buildTraceContextProvider()
    ]
    // The metrics registry and the timing-sink bridge are always registered on
    // this path (see the `providers` array above), so both are always
    // exported. `BYMAX_CORRELATION_PROVIDER` and `BYMAX_HEALTH_INDICATORS` are
    // never exported here; see `augmentModule`.
    // `DiscoveryModule` is imported unconditionally here: whether discovery is
    // enabled is unknown when the module is defined, and an import cannot be
    // decided later. It contributes two providers from an already-required peer
    // and nothing runs unless the resolved options ask for it.
    return augmentModule(
      super.forRootAsync(options),
      providers,
      [createHealthController(DEFAULT_HEALTH_PATH), createMetricsController(DEFAULT_METRICS_PATH)],
      [BYMAX_CORE_OPTIONS, BYMAX_TIMING_SINK, BYMAX_METRICS_REGISTRY],
      [DiscoveryModule]
    )
  }
}
