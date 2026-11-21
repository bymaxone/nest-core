/**
 * Unit tests tying each table of documented options to its interface.
 *
 * Layer: unit.
 * Goal: the shape the options are read by is exactly the options each interface documents: a key
 * the interface has and the shape lacks, or the other way, fails to compile here, and the keys are
 * checked at run time too, so a new option cannot be added unread.
 * Mocks: none.
 */
import type { BymaxCoreModuleOptions, MetricsOptions, HealthOptions } from './core.options'
import { OPTION_SHAPE } from './core.options.shape'
import { HEALTH_KEYS, METRICS_KEYS } from './core.options.keys'
import { CORS_KEYS } from './http/http-floors.cors'
import type { HttpFloorsCorsOptions } from './http/http-floors.cors'

/** Compiles only when `Left` and `Right` list exactly the same keys. */
type SameKeys<Left, Right> = [keyof Left] extends [keyof Right]
  ? [keyof Right] extends [keyof Left]
    ? true
    : never
  : never

describe('the tables the options are read by', () => {
  it('list exactly the options of their interfaces', () => {
    const options: SameKeys<
      typeof OPTION_SHAPE,
      Record<keyof BymaxCoreModuleOptions | 'isGlobal', 0>
    > = true
    const metrics: SameKeys<typeof METRICS_KEYS, MetricsOptions> = true
    const health: SameKeys<typeof HEALTH_KEYS, HealthOptions> = true
    const cors: SameKeys<typeof CORS_KEYS, HttpFloorsCorsOptions> = true

    expect([options, metrics, health, cors]).toEqual([true, true, true, true])
  })

  it('read every option of the module by name, the blocks as tables', () => {
    expect(Object.keys(OPTION_SHAPE).sort()).toEqual(
      [
        'bodyDepth',
        'envelope',
        'environment',
        'handlerTimeout',
        'health',
        'isGlobal',
        'metrics',
        'openapi',
        'shutdown',
        'telemetry',
        'timing'
      ].sort()
    )
    expect(OPTION_SHAPE.metrics).toBe(METRICS_KEYS)
    expect(OPTION_SHAPE.openapi.servers).toEqual([{ url: 0, description: 0 }])
  })
})
