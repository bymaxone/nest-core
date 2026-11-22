/**
 * Unit tests for options a host leaves out while something planted a key on `Object.prototype`.
 *
 * Layer: unit.
 * Goal: a name planted on the root of all objects is not an option the host set, so an omitted option
 * keeps its default whatever was planted, while a value the host did set always wins.
 * Mocks: none.
 */
import { runInNewContext } from 'node:vm'

import { normalizeCoreOptions } from './core.options'
import { OPTION_SHAPE } from './core.options.shape'

const PLANTED: readonly unknown[] = [true, false, 'x', 1, 0, ['a'], { enabled: true }]

/** Every block of the options, with the names it documents, and the root with its own. */
const GROUPS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['', Object.keys(OPTION_SHAPE)],
  ...Object.entries(OPTION_SHAPE)
    .filter(([, shape]) => typeof shape === 'object')
    .map(([block, shape]) => [block, Object.keys(shape)] as const)
]

/** What `normalizeCoreOptions` resolves, as text, since the defaults hold functions. */
function resolved(given: unknown): string {
  return JSON.stringify(normalizeCoreOptions(given as never), (_key, value: unknown) =>
    typeof value === 'function' ? 'fn' : value
  )
}

/** `value` planted on `Object.prototype` under `name` while `run` executes. */
function planted<T>(name: string, value: unknown, run: () => T): T {
  Object.defineProperty(Object.prototype, name, { value, configurable: true, writable: true })
  try {
    return run()
  } finally {
    delete (Object.prototype as Record<string, unknown>)[name]
  }
}

describe('a name planted on Object.prototype', () => {
  const given = (block: string): object => (block === '' ? {} : { [block]: {} })

  describe.each(GROUPS)('under %j', (block, names) => {
    it.each(names)('does not fill an omitted %s, whatever it holds', (name) => {
      const baseline = resolved(given(block))

      for (const value of PLANTED) {
        expect(planted(name, value, () => resolved(given(block)))).toBe(baseline)
      }
    })
  })

  it.each([
    ['envelope', 'exposeInternals', true, false],
    ['envelope', 'enabled', false, true],
    ['health', 'exposeIndicatorErrors', true, false],
    ['health', 'enabled', false, true],
    ['telemetry', 'exposeTraceId', true, false]
  ])('leaves what the host set in %s.%s alone', (block, name, plantedValue, own) => {
    const input = { [block]: { [name]: own } }
    const baseline = resolved(input)

    expect(planted(name, plantedValue, () => resolved(input))).toBe(baseline)
    expect(baseline).toContain(`"${name}":${String(own)}`)
  })

  it('keeps a metrics token the host set, and sets none the host did not', () => {
    const own = resolved({ metrics: { enabled: true, authToken: 'host' } })

    expect(
      planted('authToken', 'planted', () =>
        resolved({ metrics: { enabled: true, authToken: 'host' } })
      )
    ).toBe(own)
    expect(
      planted('authToken', 'planted', () => resolved({ metrics: { enabled: true } }))
    ).not.toContain('planted')
  })

  it('still reads an option a class holds on its own prototype', () => {
    class Holder {
      get exposeInternals(): boolean {
        return true
      }
    }

    expect(resolved({ envelope: new Holder() })).toContain('"exposeInternals":true')
  })

  it('still reads an option a proxy answers, or holds as its own, even when the same name is planted', () => {
    const answers = new Proxy(
      {},
      { get: (_target, key) => (key === 'exposeInternals' ? true : undefined) }
    )
    const holds = new Proxy({ exposeInternals: true }, {})
    const inherits = new Proxy({}, {})

    expect(resolved({ envelope: answers })).toContain('"exposeInternals":true')
    expect(planted('exposeInternals', true, () => resolved({ envelope: holds }))).toContain(
      '"exposeInternals":true'
    )
    expect(planted('exposeInternals', true, () => resolved({ envelope: inherits }))).toContain(
      '"exposeInternals":false'
    )
  })

  it('still reads an option from an object another realm made', () => {
    const foreign = runInNewContext('({ exposeInternals: true })') as object

    expect(resolved({ envelope: foreign })).toContain('"exposeInternals":true')
    expect(planted('exposeInternals', false, () => resolved({ envelope: foreign }))).toContain(
      '"exposeInternals":true'
    )
  })

  it('does not rely on anything a root holds: a polluted constructor changes nothing', () => {
    const baseline = resolved({ envelope: {} })
    const constructed = Object.getOwnPropertyDescriptor(Object.prototype, 'constructor')

    Object.defineProperty(Object.prototype, 'constructor', { value: {}, configurable: true })
    try {
      expect(planted('exposeInternals', true, () => resolved({ envelope: {} }))).toBe(baseline)
    } finally {
      Object.defineProperty(Object.prototype, 'constructor', constructed as PropertyDescriptor)
    }
  })

  it('ignores a name planted on the root of another realm, with its constructor overwritten', () => {
    const realm = runInNewContext(
      '({ block: {}, root: Object.prototype, plain: Object.create(null) })'
    ) as { block: object; root: Record<string, unknown>; plain: object }
    const baseline = resolved({ envelope: {} })
    realm.root['constructor'] = {}
    realm.root['exposeInternals'] = true

    expect(resolved({ envelope: realm.block })).toBe(baseline)
    expect(resolved({ envelope: Object.assign(realm.block, { exposeInternals: true }) })).toContain(
      '"exposeInternals":true'
    )
    delete realm.root['exposeInternals']
  })

  it('reads a name a null-prototype block holds itself, and one a derived object holds below the root', () => {
    const bare = Object.assign(Object.create(null) as object, { exposeInternals: true })
    const derived = Object.create(
      Object.create(Object.prototype, { exposeInternals: { value: true } }) as object
    ) as object

    expect(resolved({ envelope: bare })).toContain('"exposeInternals":true')
    expect(resolved({ envelope: derived })).toContain('"exposeInternals":true')
  })

  it('refuses an option whose prototype chain never ends', () => {
    const endless: object = new Proxy({}, { getPrototypeOf: () => new Proxy({}, endlessTraps) })
    const endlessTraps: ProxyHandler<object> = { getPrototypeOf: () => new Proxy({}, endlessTraps) }

    expect(() => resolved({ envelope: endless })).toThrow('the options could not be read')
    let thrown: Error | undefined
    try {
      resolved({ envelope: endless })
    } catch (error) {
      thrown = error as Error
    }

    expect((thrown?.cause as Error).message).toBe('an option is too large')
  })

  it('ignores a name a root holds as an accessor, also behind a proxy', () => {
    const baseline = resolved({ envelope: {} })
    Object.defineProperty(Object.prototype, 'exposeInternals', {
      configurable: true,
      get: () => true
    })
    try {
      expect(resolved({ envelope: {} })).toBe(baseline)
      expect(resolved({ envelope: new Proxy({}, {}) })).toBe(baseline)
    } finally {
      delete (Object.prototype as Record<string, unknown>)['exposeInternals']
    }
  })

  it('reads a name a root holds as omitted even when a proxy answers it, so what a root holds is never asked', () => {
    const answers = new Proxy(
      {},
      { get: (_target, key) => (key === 'exposeInternals' ? true : undefined) }
    )

    expect(planted('exposeInternals', false, () => resolved({ envelope: answers }))).toContain(
      '"exposeInternals":false'
    )
  })

  it('accepts an options chain of 999 links and refuses one of 1000', () => {
    const chained = (links: number): object => {
      let object: object = { exposeInternals: true }
      for (let at = 0; at < links - 1; at += 1) object = Object.create(object) as object
      return Object.create(object) as object
    }

    expect(resolved({ envelope: chained(999) })).toContain('"exposeInternals":true')
    expect(() => resolved({ envelope: chained(1000) })).toThrow('the options could not be read')
  })
})
