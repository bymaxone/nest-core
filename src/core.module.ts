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
import { APP_FILTER, APP_INTERCEPTOR, HttpAdapterHost } from '@nestjs/core'

import { DEFAULT_HEALTH_PATH, normalizeCoreOptions } from './core.options'
import type { BymaxCoreModuleOptions, ResolvedCoreOptions } from './core.options'
import {
  BYMAX_CORE_OPTIONS,
  BYMAX_CORRELATION_PROVIDER,
  BYMAX_HEALTH_INDICATORS,
  BYMAX_TIMING_SINK
} from './core.tokens'
import { buildDefaultProviders } from './defaults.providers'
import type { ICorrelationIdProvider } from './envelope/correlation.interfaces'
import { BymaxExceptionFilter } from './envelope/exception.filter'
import { createHealthController } from './health/health.controller'
import { HealthService } from './health/health.service'
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

/**
 * Build the feature providers registered on the synchronous path. Disabled
 * features contribute nothing, so a fully-disabled configuration yields an
 * empty array. The envelope filter registers as the outermost `APP_FILTER`
 * only when the envelope feature is enabled; the timing interceptor registers
 * as `APP_INTERCEPTOR` only when the timing feature is enabled; `HealthService`
 * is registered only when the health feature is enabled, matching its
 * controller counterpart in {@link buildControllers}.
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
  return providers
}

/**
 * Build the controllers registered on the synchronous path. Disabled features
 * register no controller and therefore no route: when the health feature is
 * disabled, `createHealthController` is never called and no health route
 * exists. When enabled, the controller is built for the resolved
 * `health.path`, honoring a fully custom prefix.
 *
 * @param resolved - The resolved options snapshot the gate reads.
 * @returns The conditionally-registered controllers.
 */
function buildControllers(resolved: ResolvedCoreOptions): Type[] {
  return resolved.health.enabled ? [createHealthController(resolved.health.path)] : []
}

/**
 * Build the always-on pipeline slots for the asynchronous path. Async options
 * are unknown at definition time, so both slots are registered unconditionally
 * and each factory injects the resolved options to pick the real implementation
 * when its feature is enabled or the transparent pass-through otherwise.
 *
 * @returns The `APP_FILTER` and `APP_INTERCEPTOR` slot providers.
 */
function buildAsyncSlots(): Provider[] {
  return [
    {
      provide: APP_FILTER,
      useFactory: (
        options: ResolvedCoreOptions,
        correlation: ICorrelationIdProvider,
        adapterHost: HttpAdapterHost
      ): ExceptionFilter => selectAsyncExceptionFilter(options, correlation, adapterHost),
      inject: [BYMAX_CORE_OPTIONS, BYMAX_CORRELATION_PROVIDER, HttpAdapterHost]
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
 * @returns The augmented `DynamicModule`.
 */
export function augmentModule(
  base: DynamicModule,
  providers: Provider[],
  controllers: Type[]
): DynamicModule {
  return {
    ...base,
    module: BymaxCoreModule,
    providers: [...(base.providers ?? []), ...providers],
    controllers: [...(base.controllers ?? []), ...controllers],
    exports: [
      ...(base.exports ?? []),
      BYMAX_CORE_OPTIONS,
      BYMAX_CORRELATION_PROVIDER,
      BYMAX_TIMING_SINK,
      BYMAX_HEALTH_INDICATORS
    ]
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
    return augmentModule(super.forRoot(options), providers, buildControllers(resolved))
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
      HealthService
    ]
    return augmentModule(super.forRootAsync(options), providers, [
      createHealthController(DEFAULT_HEALTH_PATH)
    ])
  }
}
