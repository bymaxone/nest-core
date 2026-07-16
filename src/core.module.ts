/**
 * @fileoverview `BymaxCoreModule`, the dynamic module every feature plugs into.
 * Built on `ConfigurableModuleBuilder`; the `isGlobal` extra maps to
 * `DynamicModule.global` via `setExtras`. The synchronous `forRoot` path knows
 * the options at definition time and omits disabled features from the providers
 * and controllers arrays. Feature classes attach to the seams here in later
 * phases; this module ships only the options snapshot and the registration
 * machinery.
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

import { normalizeCoreOptions } from './core.options'
import type { BymaxCoreModuleOptions, ResolvedCoreOptions } from './core.options'
import {
  BYMAX_CORE_OPTIONS,
  BYMAX_CORRELATION_PROVIDER,
  BYMAX_HEALTH_INDICATORS,
  BYMAX_TIMING_SINK
} from './core.tokens'
import { buildDefaultProviders } from './defaults.providers'
import { selectAsyncExceptionFilter, selectAsyncTimingInterceptor } from './passthrough.providers'

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
 * empty array. Feature phases append their gated providers through this seam.
 *
 * @param _resolved - The resolved options snapshot the gate reads.
 * @returns The conditionally-registered feature providers.
 */
function buildSyncProviders(_resolved: ResolvedCoreOptions): Provider[] {
  return []
}

/**
 * Build the controllers registered on the synchronous path. Disabled features
 * register no controller and therefore no route. Feature phases append their
 * gated controllers through this seam.
 *
 * @param _resolved - The resolved options snapshot the gate reads.
 * @returns The conditionally-registered controllers.
 */
function buildControllers(_resolved: ResolvedCoreOptions): Type[] {
  return []
}

/**
 * Build the always-on pipeline slots for the asynchronous path. Async options
 * are unknown at definition time, so both slots are registered unconditionally
 * and each factory injects the resolved options to pick the real implementation
 * (wired in later phases) or the transparent pass-through otherwise.
 *
 * @returns The `APP_FILTER` and `APP_INTERCEPTOR` slot providers.
 */
function buildAsyncSlots(): Provider[] {
  return [
    {
      provide: APP_FILTER,
      useFactory: (options: ResolvedCoreOptions, adapterHost: HttpAdapterHost): ExceptionFilter =>
        selectAsyncExceptionFilter(options, adapterHost),
      inject: [BYMAX_CORE_OPTIONS, HttpAdapterHost]
    },
    {
      provide: APP_INTERCEPTOR,
      useFactory: (options: ResolvedCoreOptions): NestInterceptor =>
        selectAsyncTimingInterceptor(options),
      inject: [BYMAX_CORE_OPTIONS]
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
   * pass-throughs; controllers that cannot register conditionally guard their
   * routes with {@link assertAsyncFeatureEnabled} in later phases.
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
      ...buildAsyncSlots()
    ]
    return augmentModule(super.forRootAsync(options), providers, [])
  }
}
