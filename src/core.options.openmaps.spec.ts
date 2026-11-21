/**
 * Unit tests for the open maps of the module options, held behind a proxy.
 *
 * Layer: unit.
 * Goal: an open map (`metrics.defaultLabels`, `openapi.securitySchemes`, `openapi.operationSecurity`)
 * the host serves through a proxy that answers only `get` has no keys to read, so it is refused at
 * boot and never taken as an empty map; a proxy that lists its keys, and an empty plain object, are
 * honoured.
 * Mocks: none.
 */
import { BymaxCoreModule } from './core.module'

/** The three open maps, each with an entry the host means. */
const MAPS: ReadonlyArray<readonly [string, string, object]> = [
  ['metrics', 'defaultLabels', { region: 'eu' }],
  ['openapi', 'securitySchemes', { bearer: { type: 'http', scheme: 'bearer' } }],
  ['openapi', 'operationSecurity', { 'GET /items': [{ bearer: [] }] }]
]

/** `value` answered through `get` alone, over an empty target. */
function getOnly<T extends object>(value: T): T {
  return new Proxy({} as T, { get: (_target, key) => Reflect.get(value, key) })
}

/** `value` as a proxy that also lists its keys. */
function listing<T extends object>(value: T): T {
  return new Proxy(value, { get: (target, key) => Reflect.get(target, key) })
}

/** The options with one open map as `held`. */
function options(block: string, name: string, held: object): never {
  const rest = block === 'openapi' ? { enabled: true } : {}
  return { [block]: { ...rest, [name]: held } } as never
}

describe('an open map of the options held behind a proxy', () => {
  it.each(MAPS)('refuses %s.%s served through get alone, naming the option', (block, name, map) => {
    let error: Error | undefined
    try {
      BymaxCoreModule.forRoot(options(block, name, getOnly(map)))
    } catch (thrown) {
      error = thrown as Error
    }
    expect(error?.message).toBe('the options could not be read')
    expect(error?.cause).toMatchObject({
      message: 'an option is held behind a proxy that lists no keys',
      option: name
    })
  })

  it.each(MAPS)('honours %s.%s served by a proxy that lists its keys', (block, name, map) => {
    expect(() => BymaxCoreModule.forRoot(options(block, name, listing(map)))).not.toThrow()
  })

  it.each(MAPS)('honours %s.%s given as an empty plain object', (block, name) => {
    expect(() => BymaxCoreModule.forRoot(options(block, name, {}))).not.toThrow()
  })
})
