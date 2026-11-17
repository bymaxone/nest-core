/**
 * Unit tests for how the module resolves what a consumer gave it, over every option of every block.
 *
 * Layer: unit.
 * Goal: every option refuses a value of the wrong type without echoing it, every boolean refuses a
 * string such as 'false', every block refuses a key it does not have, an option left `undefined` or
 * `null` resolves to its default, and a block built as a class instance is read through its getters.
 * Mocks: none; the resolver is real.
 */
import { DEFAULT_CORE_OPTIONS, normalizeCoreOptions } from './core.options'
import type { BymaxCoreModuleOptions } from './core.options'

/** What a hostile or mistaken value must never leak into a message. */
const SECRET = 'SECRET-sentinel-7f3a'

/** The values whose text could reach a message: a string, a symbol and a function named after it. */
const SENTINELS: readonly (readonly [string, unknown])[] = [
  ['a string', SECRET],
  ['a symbol', Symbol(SECRET)],
  ['a function', Object.defineProperty(() => 1, 'name', { value: SECRET })],
  ['an object', { toString: () => SECRET }],
  ['a bigint', BigInt(12345)]
]

/** Every option of every block, as `[block, option]`. */
const OPTIONS: readonly (readonly [string, string])[] = [
  ['envelope', 'enabled'],
  ['envelope', 'exposeInternals'],
  ['envelope', 'serverErrorWindowMs'],
  ['timing', 'enabled'],
  ['timing', 'slowRequestThresholdMs'],
  ['bodyDepth', 'enabled'],
  ['bodyDepth', 'maxDepth'],
  ['health', 'enabled'],
  ['health', 'path'],
  ['health', 'indicatorTimeoutMs'],
  ['health', 'readinessCacheMs'],
  ['health', 'autoDiscover'],
  ['health', 'exposeIndicatorErrors'],
  ['metrics', 'enabled'],
  ['metrics', 'path'],
  ['metrics', 'defaultLabels'],
  ['metrics', 'collectDefaultMetrics'],
  ['metrics', 'authToken'],
  ['metrics', 'edgeProtected'],
  ['metrics', 'scrapeTimeoutMs'],
  ['handlerTimeout', 'enabled'],
  ['handlerTimeout', 'timeoutMs'],
  ['handlerTimeout', 'excludePaths'],
  ['shutdown', 'deadlineMs'],
  ['openapi', 'enabled'],
  ['openapi', 'path'],
  ['openapi', 'jsonPath'],
  ['openapi', 'title'],
  ['openapi', 'description'],
  ['openapi', 'version'],
  ['openapi', 'servers'],
  ['openapi', 'securitySchemes'],
  ['openapi', 'security'],
  ['openapi', 'operationSecurity'],
  ['openapi', 'operationIdFactory'],
  ['openapi', 'includeCoreSchemas'],
  ['telemetry', 'enabled'],
  ['telemetry', 'exposeTraceId']
]

/** The options that are booleans. */
const BOOLEANS: readonly (readonly [string, string])[] = OPTIONS.filter(([, option]) =>
  /^(enabled|exposeInternals|autoDiscover|exposeIndicatorErrors|collectDefaultMetrics|edgeProtected|includeCoreSchemas|exposeTraceId)$/.test(
    option
  )
)

/** Options with `option` set to `value` inside `block`. */
function given(block: string, option: string, value: unknown): BymaxCoreModuleOptions {
  return { [block]: { [option]: value } } as BymaxCoreModuleOptions
}

/** The message of what `normalizeCoreOptions` throws for `options`, or `undefined` when it does not. */
function refusal(options: BymaxCoreModuleOptions): string | undefined {
  try {
    normalizeCoreOptions(options)
    return undefined
  } catch (error) {
    expect(error).toBeInstanceOf(Error)
    return (error as Error).message
  }
}

describe('a refusal names the option and the type of the value, and nothing else', () => {
  const cases = OPTIONS.flatMap(([block, option]) =>
    SENTINELS.map(([kind, value]) => [`${block}.${option}`, kind, block, option, value] as const)
  )

  it.each(cases)('%s given %s', (_name, _kind, block, option, value) => {
    const message = refusal(given(block, option, value))
    if (message !== undefined) {
      expect(message).not.toContain(SECRET)
      expect(message).not.toContain('12345')
      expect(message).toContain(`${block}.${option}`)
    }
  })

  it.each(['envelope', 'timing', 'bodyDepth', 'health', 'metrics', 'handlerTimeout', 'shutdown'])(
    'the %s block given a string, a symbol or a function is refused without echoing it',
    (block) => {
      for (const [, value] of SENTINELS.filter(([kind]) => kind !== 'an object')) {
        const message = refusal({ [block]: value } as BymaxCoreModuleOptions)
        expect(message).toContain(`${block} must be an object`)
        expect(message).not.toContain(SECRET)
      }
    }
  )

  it('refuses an `environment` that is not a string', () => {
    for (const [, value] of SENTINELS.slice(1)) {
      const message = refusal({ environment: value } as unknown as BymaxCoreModuleOptions)
      expect(message).toContain('environment must be a string')
      expect(message).not.toContain(SECRET)
    }
  })

  it('names a number it refuses and shows it', () => {
    expect(refusal(given('envelope', 'serverErrorWindowMs', 1.5))).toContain('received 1.5')
    expect(refusal(given('envelope', 'serverErrorWindowMs', 'abc'))).toContain('received a string')
    expect(refusal(given('envelope', 'serverErrorWindowMs', Number.NaN))).toContain('received NaN')
  })
})

describe('a boolean option is a boolean', () => {
  it.each(BOOLEANS)(
    '%s.%s refuses the strings "false" and "true", 0, 1 and an object',
    (block, option) => {
      for (const value of ['false', 'true', 0, 1, {}, []]) {
        expect(refusal(given(block, option, value))).toContain(
          `${block}.${option} must be true or false`
        )
      }
    }
  )

  it.each(BOOLEANS)('%s.%s accepts true, false, undefined and null', (block, option) => {
    for (const value of [true, false, undefined, null]) {
      expect(refusal(given(block, option, value))).toBeUndefined()
    }
  })

  it('refuses the string "false" on exposeInternals before it can read as truthy', () => {
    expect(refusal(given('envelope', 'exposeInternals', 'false'))).toBe(
      'envelope.exposeInternals must be true or false, received a string'
    )
  })
})

describe('a block has only the keys it documents', () => {
  it.each([...new Set(OPTIONS.map(([block]) => block))])(
    '%s refuses a key it does not have',
    (block) => {
      const message = refusal({ [block]: { bogusKey: 1 } } as BymaxCoreModuleOptions)
      expect(message).toBe(`${block} has an unknown option "bogusKey"`)
    }
  )

  it('the options object refuses a block it does not have', () => {
    expect(refusal({ bogusBlock: {} } as BymaxCoreModuleOptions)).toBe(
      'options has an unknown option "bogusBlock"'
    )
  })

  it('does not echo a hostile key beyond a bounded length', () => {
    const message = refusal({ envelope: { [`${SECRET}${'x'.repeat(500)}`]: 1 } } as never)
    expect(message?.length).toBeLessThan(200)
  })
})

describe('an option left undefined or null resolves to its default', () => {
  it('on every option of every block', () => {
    const blank: Record<string, Record<string, unknown>> = {}
    for (const [block, option] of OPTIONS) {
      blank[block] = { ...blank[block], [option]: undefined }
    }
    expect(normalizeCoreOptions(blank as BymaxCoreModuleOptions)).toEqual(DEFAULT_CORE_OPTIONS)
    for (const block of Object.keys(blank)) {
      for (const option of Object.keys(blank[block] ?? {})) {
        blank[block] = { ...blank[block], [option]: null }
      }
    }
    expect(normalizeCoreOptions(blank as BymaxCoreModuleOptions)).toEqual(DEFAULT_CORE_OPTIONS)
  })

  it('on a whole block given as undefined or null', () => {
    expect(normalizeCoreOptions({ envelope: undefined, shutdown: null } as never)).toEqual(
      DEFAULT_CORE_OPTIONS
    )
  })
})

describe('a block built as a class instance is read through its getters', () => {
  class Timeouts {
    get enabled(): boolean {
      return true
    }
    get timeoutMs(): number {
      return 1234
    }
  }

  it('reads options defined on the prototype', () => {
    const resolved = normalizeCoreOptions({ handlerTimeout: new Timeouts() })
    expect(resolved.handlerTimeout.enabled).toBe(true)
    expect(resolved.handlerTimeout.timeoutMs).toBe(1234)
  })

  it('still refuses a prototype getter that returns a wrong type', () => {
    class Wrong {
      get exposeInternals(): unknown {
        return 'false'
      }
    }
    expect(refusal({ envelope: new Wrong() as never })).toContain(
      'envelope.exposeInternals must be true or false'
    )
  })
})

describe('metrics.authToken', () => {
  it.each([123, true, {}, []])('refuses a token that is not a string: %j', (token) => {
    expect(refusal(given('metrics', 'authToken', token))).toContain(
      'metrics.authToken must be a string'
    )
  })
})

describe('metrics.defaultLabels', () => {
  it('copies the labels so the snapshot does not freeze the consumer object', () => {
    const labels = { service: 'api' }
    const resolved = normalizeCoreOptions({ metrics: { defaultLabels: labels } })
    expect(resolved.metrics.defaultLabels).toEqual(labels)
    expect(Object.isFrozen(labels)).toBe(false)
  })

  it('refuses labels that are a string, a list, or a value that is not a string', () => {
    expect(refusal(given('metrics', 'defaultLabels', 'x'))).toBe(
      'metrics.defaultLabels must be an object, received a string'
    )
    expect(refusal(given('metrics', 'defaultLabels', []))).toContain('must be an object')
    expect(refusal(given('metrics', 'defaultLabels', { a: 1 }))).toBe(
      'metrics.defaultLabels.a must be a string, received 1'
    )
  })

  it('refuses a label name Prometheus would not accept, without showing it', () => {
    const message = refusal(given('metrics', 'defaultLabels', { [`${SECRET} x`]: 'v' }))
    expect(message).toContain('an invalid label name')
    expect(message).not.toContain(SECRET)
  })
})

describe('handlerTimeout.excludePaths', () => {
  it('refuses a value that is not a list, and an entry that is not a path, by position', () => {
    expect(refusal(given('handlerTimeout', 'excludePaths', '/a'))).toBe(
      'handlerTimeout.excludePaths must be an array, received a string'
    )
    expect(refusal(given('handlerTimeout', 'excludePaths', ['/a', SECRET]))).toBe(
      'handlerTimeout.excludePaths entry 2 must be a path starting with "/", with no query, fragment or space'
    )
  })
})

describe('the health block', () => {
  it('refuses a readiness cache that is not a non-negative integer, showing a number only', () => {
    expect(refusal(given('health', 'readinessCacheMs', -1))).toBe(
      'health.readinessCacheMs must be a non-negative safe integer, received -1'
    )
    expect(refusal(given('health', 'readinessCacheMs', SECRET))).toContain('received a string')
  })
})
