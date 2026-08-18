/**
 * @fileoverview `BymaxCoreModule`, the dynamic module every feature plugs into.
 * Built on `ConfigurableModuleBuilder`; the `isGlobal` extra maps to
 * `DynamicModule.global` via `setExtras`. The synchronous `forRoot` path knows
 * the options at definition time and omits disabled features from the providers
 * and controllers arrays; the asynchronous `forRootAsync` path registers an
 * always-on pipeline slot and a health controller that self-guards against a
 * disabled or path-mismatched resolved configuration at request time.
 * @layer Module
 */
import { ConfigurableModuleBuilder, Inject, Module, Optional } from '@nestjs/common'
import type {
  DynamicModule,
  ExceptionFilter,
  MiddlewareConsumer,
  NestModule,
  Provider,
  Type
} from '@nestjs/common'
import { APP_FILTER, DiscoveryModule, HttpAdapterHost } from '@nestjs/core'

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
import { selectAsyncExceptionFilter } from './passthrough.providers'
import { bridgeFastifyRouteMetadata } from './timing/fastify-route.bridge'
import type { HttpAdapterShape } from './timing/fastify-route.bridge'
import { BymaxTimingMiddleware } from './timing/timing.middleware'

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
 * only when the envelope feature is enabled; the timing middleware is provided
 * only when the timing feature is enabled, and `configure` applies it under the
 * same condition; `HealthService` is registered only when the health feature is
 * enabled, matching its controller counterpart in {@link buildControllers}. The
 * metrics registry provider is added only when metrics are enabled, so a
 * disabled configuration never loads `prom-client`; the metrics timing-sink
 * bridge is added only when timing and metrics are both enabled, so HTTP
 * samples feed the default HTTP metrics (otherwise the middleware falls back to
 * its own in-code no-op, or to a consumer's own `BYMAX_TIMING_SINK` binding,
 * when one is enabled).
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
    providers.push(BymaxTimingMiddleware)
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
 * Timing needs no slot here. Its recorder is middleware, and `configure` reads
 * the already-resolved options to decide whether to apply it, so the runtime
 * gate a pass-through interceptor existed to provide has somewhere better to
 * live on this path.
 *
 * @returns The `APP_FILTER` slot provider.
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
export class BymaxCoreModule extends BymaxCoreModuleBase implements NestModule {
  /**
   * @param options - The resolved snapshot, read to decide whether the timing
   *   middleware is applied at all.
   */
  constructor(
    @Inject(BYMAX_CORE_OPTIONS) private readonly resolved: ResolvedCoreOptions,
    // Injected by explicit token, never by parameter type: this package is
    // bundled with tsup, which strips `emitDecoratorMetadata`, so type-based
    // DI resolves to `undefined` in the published build. `@Optional()` because
    // a module compiled without an application — as a unit test does — has no
    // adapter to resolve, and the bridge treats its absence as "not Fastify".
    @Optional() @Inject(HttpAdapterHost) private readonly adapterHost?: HttpAdapterHost
  ) {
    super()
  }

  /**
   * Apply the request-timing middleware to every route.
   *
   * Middleware rather than the interceptor this replaced, because guards run
   * before interceptors: a request rejected by an authentication, authorization
   * or throttling guard never reached the interceptor, and one matching no
   * route never reached a controller at all. A deployment could therefore be
   * under a credential-stuffing run — a flood of 401s — with a flat error
   * graph, which is why this is a security fix rather than a metrics
   * improvement.
   *
   * Applied on both registration paths, and only when timing is enabled: the
   * middleware is the sole recorder now, since a second one would count every
   * matched request twice.
   *
   * There is no single pattern that covers both adapters, which is the whole
   * reason this reads the adapter first. Measured, requesting the root, a
   * parameterised route, a nested path and an unmatched path, with and without
   * `setGlobalPrefix('api')`:
   *
   * | `forRoutes(...)` | Express          | Fastify              |
   * | ---------------- | ---------------- | -------------------- |
   * | `'*splat'`       | skips the root   | —                    |
   * | `'{*splat}'`     | skips `/api`     | every path           |
   * | `'/'`            | every path       | matches `/` only     |
   *
   * On Express `'/'` is a mount and matches everything beneath whatever prefix
   * it is scoped to, while `'{*splat}'` — the form Nest 11's migration guide
   * prescribes for "all routes" — stops matching the prefixed root once an
   * application calls `setGlobalPrefix`. That was reported as nest#14520 and
   * fixed by nest#14522, whose regression test covers Fastify; on the Express
   * adapter the prefixed root still reaches no middleware while resolving to
   * `200`. Measured on `@nestjs/core` 11.1.28 and re-measured unchanged on
   * 11.2.1 — a minor release is exactly where this would plausibly have been
   * fixed, so the version this was last confirmed against is part of the
   * claim rather than a footnote to it.
   *
   * On Fastify the same `'/'` is an exact match rather than a mount — one of
   * three requests reached the middleware — so the wildcard is the only form
   * that works there.
   *
   * A recorder that quietly omits one route is the same class of defect this
   * middleware exists to fix, so each adapter gets the form that omits none.
   *
   * Fastify also needs {@link bridgeFastifyRouteMetadata}, because middie hands
   * middleware the raw request, which carries no route metadata at all; see
   * that file for why the label would otherwise be `<unmatched>` for every
   * request.
   *
   * One limit stays and is documented in the README: Nest scopes module
   * middleware to the global prefix, so with `setGlobalPrefix('api')` a request
   * to `/nope` — outside the prefix entirely — reaches no middleware and is not
   * recorded, while `/api/nope` is. No `forRoutes` argument changes that, and
   * nothing this module can register reaches outside its own scope.
   *
   * @param consumer - Nest's middleware consumer.
   */
  configure(consumer: MiddlewareConsumer): void {
    if (!this.resolved.timing.enabled) {
      return
    }
    const adapter = this.adapterHost?.httpAdapter as HttpAdapterShape | undefined
    const onFastify = bridgeFastifyRouteMetadata(adapter)
    consumer.apply(BymaxTimingMiddleware).forRoutes(onFastify ? '{*splat}' : '/')
  }

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
    // run — readiness discovery, metrics contribution, or OpenAPI contribution —
    // so a configuration that needs none of them registers nothing extra.
    // The document is the newest of the three and the easiest to forget: an
    // application that enables nothing but OpenAPI still scans, because a
    // library it imports may describe its own routes, and without the scanner
    // that description would be silently dropped.
    const scansProviders =
      (resolved.health.enabled && resolved.health.autoDiscover) ||
      resolved.metrics.enabled ||
      resolved.openapi.enabled
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
      // Registered unconditionally, applied conditionally: the class must be
      // resolvable before `configure` can apply it, and whether timing is
      // enabled is unknown until the consumer's factory has run. An unapplied
      // middleware provider costs one construction and observes nothing.
      BymaxTimingMiddleware,
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
