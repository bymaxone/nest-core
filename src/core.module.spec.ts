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
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core'
import { Test } from '@nestjs/testing'

import { normalizeCoreOptions } from './core.options'
import { augmentModule, BymaxCoreModule } from './core.module'
import { BYMAX_CORE_OPTIONS } from './core.tokens'

/** Extract the injection token of a provider regardless of its shape. */
function tokenOf(provider: Provider): unknown {
  return typeof provider === 'object' && 'provide' in provider ? provider.provide : provider
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
    expect(def.controllers ?? []).toHaveLength(0)
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
    expect(merged.exports).toHaveLength(4)
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
    expect(merged.exports).toHaveLength(5)
  })
})
