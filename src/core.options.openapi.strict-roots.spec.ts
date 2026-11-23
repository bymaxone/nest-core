/**
 * Unit tests for the strict roots of the OpenAPI block: the options whose value must reach the document
 * as the host gave it.
 *
 * Layer: unit.
 * Goal: a proxy is refused as the root of each of them before anything is read through it, a hole is
 * never filled from `Array.prototype`, and a name planted on `Object.prototype` is not an answer for a
 * declaration that left it out.
 * Mocks: the guard that refuses a planted `Object.prototype` at boot, so the reads under it are still exercised.
 */
import { BymaxCoreModule } from './core.module'
import { normalizeCoreOptions } from './core.options'
import { readOptions } from './read-options'

jest.mock('./object-prototype', () => ({ assertObjectPrototypeClean: (): void => undefined }))

/** Whether a name is planted so that `for...in` sees it: every row runs both ways. */
let ENUMERABLE = false

/** The four options a strict copy takes, each with a value that is valid when it is not a proxy. */
const ROOTS: ReadonlyArray<readonly [string, () => unknown]> = [
  ['security', () => [{ bearer: [] }]],
  ['servers', () => [{ url: 'https://api.example' }]],
  ['operationSecurity', () => ({ 'GET /items': [{ bearer: [] }] })]
]

/** A proxy that reports no items, around a list that has some. */
function lying(list: unknown[]): unknown[] {
  return new Proxy(list, {
    get: (target, key) => (key === 'length' ? 0 : Reflect.get(target, key))
  })
}

/** What `forRoot` throws for `openapi`, or nothing. */
function failure(openapi: object): Error | undefined {
  try {
    BymaxCoreModule.forRoot({ openapi: { enabled: true, ...openapi } } as never)
  } catch (error) {
    return error as Error
  }
  return undefined
}

describe('a proxy as the root of a strict option', () => {
  it.each(['security', 'servers'])(
    'is refused for %s, lying about its length or transparent',
    (name) => {
      const make = ROOTS.find(([key]) => key === name)?.[1] as () => unknown[]

      expect(failure({ [name]: lying(make()) })?.message).toBeDefined()
      expect(failure({ [name]: new Proxy(make(), {}) })?.message).toBeDefined()
      expect(() =>
        normalizeCoreOptions({ openapi: { enabled: true, [name]: lying(make()) } } as never)
      ).toThrow()
    }
  )

  it('keeps the limit of 1000 items for a security list: 1000 are accepted, 1001 are refused naming the option', () => {
    const list = (length: number): unknown[] => Array.from({ length }, () => ({ bearer: [] }))

    expect(failure({ security: list(1000) })).toBeUndefined()
    expect(failure({ security: list(1001) })?.cause).toMatchObject({
      option: 'security',
      cause: { message: 'an option is too large' }
    })
  })

  it('names a proxy as the reason when the servers list is one', () => {
    expect(
      failure({ servers: new Proxy([{ url: 'https://api.example' }], {}) })?.cause
    ).toMatchObject({
      message: 'an option is held behind a proxy'
    })
  })

  it('is refused for the lists inside operationSecurity and for the map', () => {
    const list = [{ bearer: [] }]

    expect(failure({ operationSecurity: { 'GET /items': lying(list) } })).toBeDefined()
    expect(failure({ operationSecurity: { 'GET /items': new Proxy(list, {}) } })).toBeDefined()
    expect(failure({ operationSecurity: new Proxy({ 'GET /items': list }, {}) })).toBeDefined()
  })

  it('is refused for securitySchemes, whole or as one scheme', () => {
    const scheme = { type: 'http', scheme: 'bearer' }

    expect(failure({ securitySchemes: new Proxy({ bearer: scheme }, {}) })).toBeDefined()
    expect(failure({ securitySchemes: { bearer: new Proxy(scheme, {}) } })).toBeDefined()
  })

  it('names the option when the lying proxy is a security list', () => {
    expect(failure({ security: lying([{ bearer: [] }]) })?.cause).toMatchObject({
      option: 'security'
    })
  })

  it.each(ROOTS)('still accepts a plain %s', (name, make) => {
    expect(failure({ [name]: make() })).toBeUndefined()
  })
})

describe('a hole in a list', () => {
  /** `value` planted at the index 0 of every list while `run` executes. */
  function withArrayPrototype<T>(value: unknown, run: () => T): T {
    Object.defineProperty(Array.prototype, 0, { value, configurable: true, writable: true })
    try {
      return run()
    } finally {
      delete (Array.prototype as unknown as Record<number, unknown>)[0]
    }
  }

  it('is not filled from Array.prototype in a strict list', () => {
    const security: unknown[] = new Array<unknown>(2)
    security[1] = { bearer: [] }

    expect(withArrayPrototype({}, () => failure({ security }))?.cause).toMatchObject({
      option: 'security'
    })
  })

  it('is not filled from Array.prototype in a list the options read', () => {
    const list: unknown[] = new Array<unknown>(2)
    list[1] = 1

    expect(withArrayPrototype('x', () => readOptions({ list }, { list: 0 }))).toEqual({
      list: [undefined, 1]
    })
  })
})

describe.each([false, true])(
  'a name planted on Object.prototype under a declaration (enumerable: %s)',
  (enumerable) => {
    beforeAll(() => {
      ENUMERABLE = enumerable
    })
    /** `value` planted under `name` while `run` executes. */
    function planted<T>(name: string, value: unknown, run: () => T): T {
      Object.defineProperty(Object.prototype, name, {
        value,
        configurable: true,
        writable: true,
        enumerable: ENUMERABLE
      })
      try {
        return run()
      } finally {
        delete (Object.prototype as Record<string, unknown>)[name]
      }
    }

    it.each([
      ['url', 'http://evil.example', { servers: [{ description: 'd' }] }],
      ['scheme', 'bearer', { securitySchemes: { a: { type: 'http' } } }],
      ['name', 'X-Key', { securitySchemes: { a: { type: 'apiKey', in: 'header' } } }],
      ['in', 'header', { securitySchemes: { a: { type: 'apiKey', name: 'X-Key' } } }],
      ['type', 'http', { securitySchemes: { a: { scheme: 'bearer' } } }],
      [
        'openIdConnectUrl',
        'http://evil.example',
        { securitySchemes: { a: { type: 'openIdConnect' } } }
      ],
      ['flows', {}, { securitySchemes: { a: { type: 'oauth2' } } }]
    ])('does not complete a declaration that left out %s', (name, value, openapi) => {
      expect(failure(openapi)).toBeDefined()
      expect(planted(name, value, () => failure(openapi))).toBeDefined()
    })

    it('does not change a complete declaration', () => {
      const openapi = {
        enabled: true,
        servers: [{ url: 'https://api.example', description: 'd' }],
        securitySchemes: { a: { type: 'http', scheme: 'bearer' } }
      }
      const resolved = (): string =>
        JSON.stringify(normalizeCoreOptions({ openapi } as never).openapi)
      const baseline = resolved()

      for (const name of ['url', 'description', 'scheme', 'type', 'name', 'in']) {
        expect(planted(name, 'planted', resolved)).toBe(baseline)
      }
    })
  }
)
