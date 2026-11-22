/**
 * Unit tests for the limit on the maps an option holds.
 *
 * Layer: unit.
 * Goal: a map an option holds (`metrics.defaultLabels`, `openapi.operationSecurity`,
 * `openapi.securitySchemes`) has at most 1000 keys, like a list, and is refused past that before any of
 * it is copied, naming the option for the security ones.
 * Mocks: none.
 */
import { normalizeCoreOptions } from './core.options'

const SCHEME = { type: 'http', scheme: 'bearer' }

/** A map of `size` keys built by `entry`. */
function map(size: number, entry: (index: number) => readonly [string, unknown]): object {
  return Object.fromEntries(Array.from({ length: size }, (_, index) => entry(index)))
}

/** What `normalizeCoreOptions` throws for `options`, or nothing. */
function failure(options: object): Error | undefined {
  try {
    normalizeCoreOptions(options as never)
  } catch (error) {
    return error as Error
  }
  return undefined
}

const MAPS: ReadonlyArray<readonly [string, (size: number) => object]> = [
  [
    'metrics.defaultLabels',
    (size) => ({ metrics: { enabled: true, defaultLabels: map(size, (i) => [`k${i}`, 'x']) } })
  ],
  [
    'openapi.operationSecurity',
    (size) => ({
      openapi: {
        enabled: true,
        securitySchemes: { b: SCHEME },
        operationSecurity: map(size, (i) => [`GET /p${i}`, [{ b: [] }]])
      }
    })
  ],
  [
    'openapi.securitySchemes',
    (size) => ({
      openapi: { enabled: true, securitySchemes: map(size, (i) => [`s${i}`, SCHEME]) }
    })
  ]
]

describe('the maps an option holds', () => {
  it.each(MAPS)('%s takes 1000 keys and refuses 1001', (_name, make) => {
    expect(failure(make(1000))).toBeUndefined()
    expect(failure(make(1001))?.message).toBe('the options could not be read')
  })

  it('names the option when a security map is refused for its size', () => {
    const error = failure(MAPS[1]?.[1](1001) as object)

    expect(error?.cause).toMatchObject({
      option: 'operationSecurity',
      cause: { message: 'an option is too large' }
    })
  })

  it('refuses 1001 keys listed by a proxy, as it does for a plain map', () => {
    const labels = new Proxy(
      map(1001, (i) => [`k${i}`, 'x']),
      {}
    )

    expect(failure({ metrics: { enabled: true, defaultLabels: labels } })?.message).toBe(
      'the options could not be read'
    )
  })
})
