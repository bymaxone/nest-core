/**
 * Unit tests for the synchronous `BymaxCoreModule.forRoot` registration path.
 *
 * Layer: unit.
 * Goal: prove the sync path omits every disabled feature (zero feature
 * providers, zero controllers), exposes the normalized frozen options under
 * BYMAX_CORE_OPTIONS, and maps the `isGlobal` extra onto the module.
 * Mocks: none; assertions run against the returned DynamicModule and a compiled
 * testing module.
 */
import type { DynamicModule, Provider } from '@nestjs/common'
import { APP_FILTER, APP_INTERCEPTOR, DiscoveryModule } from '@nestjs/core'
import { Test } from '@nestjs/testing'

import { normalizeCoreOptions } from './core.options'
import { augmentModule, BymaxCoreModule } from './core.module'
import {
  BYMAX_CORE_OPTIONS,
  BYMAX_METRICS_REGISTRY,
  BYMAX_TIMING_SINK,
  BYMAX_TRACE_CONTEXT
} from './core.tokens'
import { HealthService } from './health/health.service'
import { MetricsContributionRunner } from './metrics/metrics.contribution'

/** Extract the injection token of a provider regardless of its shape. */
function tokenOf(provider: Provider): unknown {
  return typeof provider === 'object' && 'provide' in provider ? provider.provide : provider
}

/** Count how many providers of a module definition are bound to `token`. */
function countProvidersFor(def: DynamicModule, token: unknown): number {
  return (def.providers ?? []).map(tokenOf).filter((candidate) => candidate === token).length
}

const ALL_DISABLED = {
  envelope: { enabled: false },
  timing: { enabled: false },
  health: { enabled: false },
  metrics: { enabled: false }
}

describe('BymaxCoreModule.forRoot', () => {
  /**
   * Fully-disabled configuration registers nothing feature-related.
   *
   * The sync path knows options at definition time, so a disabled feature must
   * contribute neither a pipeline provider nor a controller.
   */
  it('registers zero feature providers and zero controllers when all features are disabled', () => {
    const def: DynamicModule = BymaxCoreModule.forRoot(ALL_DISABLED)
    const tokens = (def.providers ?? []).map(tokenOf)

    expect(tokens).not.toContain(APP_FILTER)
    expect(tokens).not.toContain(APP_INTERCEPTOR)
    expect(tokens).not.toContain(HealthService)
    expect(def.controllers ?? []).toHaveLength(0)
  })

  /**
   * Enabled health registers the aggregator service.
   *
   * `HealthService` must be appended to the providers exactly when the health
   * feature is enabled; a gate stuck open would register it even when disabled,
   * so both the enabled presence here and the disabled absence above pin it.
   */
  it('registers HealthService exactly when health is enabled', () => {
    const enabled = BymaxCoreModule.forRoot({ health: { enabled: true } })
    const disabled = BymaxCoreModule.forRoot({ health: { enabled: false } })

    expect((enabled.providers ?? []).map(tokenOf)).toContain(HealthService)
    expect((disabled.providers ?? []).map(tokenOf)).not.toContain(HealthService)
  })

  /**
   * The metrics timing-sink bridge is bound only when timing is also enabled.
   *
   * With metrics on but timing off there must be a single `BYMAX_TIMING_SINK`
   * provider (the no-op default): the bridge provider is added only when both
   * features are enabled, and the token is then exported so consumers can inject
   * the effective sink. This pins the inner timing gate inside the metrics block.
   */
  it('adds the metrics timing-sink bridge and exports it only when timing and metrics are both enabled', () => {
    const metricsOnly = BymaxCoreModule.forRoot({
      metrics: { enabled: true },
      timing: { enabled: false }
    })
    const both = BymaxCoreModule.forRoot({
      metrics: { enabled: true },
      timing: { enabled: true }
    })

    // Metrics on, timing off: no BYMAX_TIMING_SINK provider is bound at all (the
    // timing pipeline falls back to its in-code no-op), so the bridge is absent.
    expect(countProvidersFor(metricsOnly, BYMAX_TIMING_SINK)).toBe(0)
    expect(metricsOnly.exports).toContain(BYMAX_METRICS_REGISTRY)
    expect(metricsOnly.exports).not.toContain(BYMAX_TIMING_SINK)

    // Both on: the bridge binds BYMAX_TIMING_SINK once, and the token is exported.
    expect(countProvidersFor(both, BYMAX_TIMING_SINK)).toBe(1)
    expect(both.exports).toContain(BYMAX_TIMING_SINK)
    expect(both.exports).toContain(BYMAX_METRICS_REGISTRY)
  })

  /**
   * The resolved-options token is always exported.
   *
   * Every consumer injects `BYMAX_CORE_OPTIONS`, so `forRoot` must always list it
   * among the module exports, even for the fully-default configuration.
   */
  it('always exports the BYMAX_CORE_OPTIONS token', () => {
    expect(BymaxCoreModule.forRoot({}).exports).toContain(BYMAX_CORE_OPTIONS)
  })

  /**
   * Enabled envelope registers the exception filter.
   *
   * The sync path must append the APP_FILTER provider exactly when the envelope
   * feature is enabled, wiring the stable error envelope into the pipeline.
   */
  it('registers the APP_FILTER provider when the envelope is enabled', () => {
    const def: DynamicModule = BymaxCoreModule.forRoot({ envelope: { enabled: true } })
    const tokens = (def.providers ?? []).map(tokenOf)

    expect(tokens).toContain(APP_FILTER)
  })

  /**
   * The resolved options are exposed and immutable.
   *
   * Consumers inject BYMAX_CORE_OPTIONS expecting the defaults-applied, frozen
   * snapshot, not their raw input.
   */
  it('provides the normalized frozen options under BYMAX_CORE_OPTIONS', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [BymaxCoreModule.forRoot({ health: { path: 'status' } })]
    }).compile()

    const options = moduleRef.get(BYMAX_CORE_OPTIONS)

    expect(options).toEqual(normalizeCoreOptions({ health: { path: 'status' } }))
    expect(Object.isFrozen(options)).toBe(true)
  })

  /**
   * The module is global by default.
   *
   * A foundation module is imported once and must be visible app-wide unless
   * the consumer opts out.
   */
  it('produces a global module by default', () => {
    expect(BymaxCoreModule.forRoot({}).global).toBe(true)
  })

  /**
   * `isGlobal: false` yields a non-global module.
   *
   * The extra must flow through `setExtras` to `DynamicModule.global` so a
   * consumer can scope the module explicitly.
   */
  it('produces a non-global module when isGlobal is false', () => {
    expect(BymaxCoreModule.forRoot({ isGlobal: false }).global).toBe(false)
  })
})

describe('augmentModule', () => {
  /**
   * Absent base arrays.
   *
   * When the builder returns a bare base the merge must still yield arrays,
   * exercising the empty-fallback side of every `?? []` guard.
   */
  it('merges into a base that has no providers, controllers, or exports', () => {
    const merged = augmentModule({ module: BymaxCoreModule }, [{ provide: 'A', useValue: 1 }], [])

    expect(merged.providers).toHaveLength(1)
    expect(merged.controllers).toHaveLength(0)
    expect(merged.exports).toContain(BYMAX_CORE_OPTIONS)
    expect(merged.exports).toHaveLength(1)
  })

  /**
   * Present base arrays.
   *
   * When the base already carries arrays the merge must append to them,
   * exercising the value side of every `?? []` guard.
   */
  it('appends to a base that already carries providers, controllers, and exports', () => {
    const base = {
      module: BymaxCoreModule,
      providers: [{ provide: 'BASE', useValue: 0 }] as const,
      controllers: [class BaseController {}],
      exports: ['BASE'] as const
    }

    const merged = augmentModule(
      { ...base, providers: [...base.providers], exports: [...base.exports] },
      [{ provide: 'A', useValue: 1 }],
      [class AddedController {}]
    )

    expect(merged.providers).toHaveLength(2)
    expect(merged.controllers).toHaveLength(2)
    expect(merged.exports?.[0]).toBe('BASE')
    expect(merged.exports).toContain(BYMAX_CORE_OPTIONS)
    expect(merged.exports).toHaveLength(2)
  })

  /**
   * Explicit export list.
   *
   * A caller passing its own export-token array (as `forRoot` and
   * `forRootAsync` do) must see exactly those tokens appended, not the
   * single-token default.
   */
  it('appends an explicit export-token list instead of the default', () => {
    const merged = augmentModule(
      { module: BymaxCoreModule },
      [],
      [],
      [BYMAX_CORE_OPTIONS, 'CUSTOM_TOKEN']
    )

    expect(merged.exports).toEqual([BYMAX_CORE_OPTIONS, 'CUSTOM_TOKEN'])
  })
})

describe('BymaxCoreModule, trace-context wiring', () => {
  /**
   * A disabled feature contributes no provider — telemetry included.
   *
   * This is the package's own rule, and the trace-context provider is the one
   * that could quietly break it: it is bound unconditionally on the asynchronous
   * path, so the synchronous path has to gate it like every other feature.
   */
  it('binds the trace-context provider on the sync path only when telemetry is enabled', () => {
    const off = BymaxCoreModule.forRoot({})
    const on = BymaxCoreModule.forRoot({ telemetry: { enabled: true } })

    expect((off.providers ?? []).map(tokenOf)).not.toContain(BYMAX_TRACE_CONTEXT)
    expect((on.providers ?? []).map(tokenOf)).toContain(BYMAX_TRACE_CONTEXT)
  })

  /**
   * The async path binds it unconditionally, on purpose.
   *
   * Whether telemetry is enabled is unknown when the module is defined, so the
   * token is always bound there and its factory gates instead. Asserted so the
   * asymmetry stays deliberate rather than becoming a surprise.
   */
  it('always binds the trace-context provider on the async path', () => {
    const def = BymaxCoreModule.forRootAsync({ inject: [], useFactory: () => ({}) })

    expect((def.providers ?? []).map(tokenOf)).toContain(BYMAX_TRACE_CONTEXT)
  })
})

describe('BymaxCoreModule, DiscoveryModule wiring', () => {
  /**
   * Discovery imports nothing until it is asked for.
   *
   * The sync path knows the options at definition time, so a configuration that
   * never enables discovery must not carry `DiscoveryModule` at all — the same
   * "disabled means absent" rule every other feature follows.
   */
  it('imports DiscoveryModule on the sync path only when discovery is enabled', () => {
    const off = BymaxCoreModule.forRoot({ health: { enabled: true } })
    const on = BymaxCoreModule.forRoot({ health: { enabled: true, autoDiscover: true } })

    expect(off.imports ?? []).not.toContain(DiscoveryModule)
    expect(on.imports ?? []).toContain(DiscoveryModule)
  })

  /**
   * Metrics alone are enough to need the scan.
   *
   * Contribution rides on the metrics feature with no separate flag, so enabling
   * metrics must bring the scanner in even when readiness discovery is off.
   */
  it('imports DiscoveryModule when metrics are enabled without health discovery', () => {
    const def = BymaxCoreModule.forRoot({ health: { enabled: false }, metrics: { enabled: true } })

    expect(def.imports ?? []).toContain(DiscoveryModule)
  })

  /**
   * The contribution runner follows the metrics feature.
   *
   * It is what calls contributors at bootstrap, so registering it while metrics
   * are off would scan the container for a registry that does not exist.
   */
  it('registers the contribution runner only when metrics are enabled', () => {
    const off = BymaxCoreModule.forRoot({ metrics: { enabled: false } })
    const on = BymaxCoreModule.forRoot({ metrics: { enabled: true } })

    expect((off.providers ?? []).map(tokenOf)).not.toContain(MetricsContributionRunner)
    expect((on.providers ?? []).map(tokenOf)).toContain(MetricsContributionRunner)
  })

  /**
   * Discovery cannot outlive a disabled health feature.
   *
   * With health off there is no readiness endpoint to aggregate into, so the
   * import would register a scanner nothing can ever read.
   */
  it('does not import DiscoveryModule when health is disabled', () => {
    const def = BymaxCoreModule.forRoot({ health: { enabled: false, autoDiscover: true } })

    expect(def.imports ?? []).not.toContain(DiscoveryModule)
  })

  /**
   * The async path imports it unconditionally, on purpose.
   *
   * Whether discovery is enabled is unknown when the module is defined and an
   * import cannot be decided later, so the async path always carries it and
   * gates at runtime instead. Asserted so the asymmetry stays deliberate rather
   * than becoming a surprise.
   */
  it('always imports DiscoveryModule on the async path', () => {
    const def = BymaxCoreModule.forRootAsync({ inject: [], useFactory: () => ({}) })

    expect(def.imports ?? []).toContain(DiscoveryModule)
  })
})
