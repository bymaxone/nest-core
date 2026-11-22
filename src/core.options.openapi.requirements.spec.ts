/**
 * Unit tests for the security options of the OpenAPI block, from the value the host gives to the one
 * the document is built from.
 *
 * Layer: unit.
 * Goal: a requirement that is not a plain object (a class instance with its requirement in an accessor,
 * one with a `toJSON`, one derived from another object) is refused at boot, on the path that reads the
 * options once and on the one that hands them over as they are, instead of being checked as one thing
 * and emitted as another; a plain requirement is emitted as it was given.
 * Mocks: none.
 */
import { BymaxCoreModule } from './core.module'
import { normalizeCoreOptions } from './core.options'
import { resolveOpenApi } from './core.options.openapi'

/** A requirement whose scheme is held by an accessor of the class. */
class WithAccessor {
  get bearer(): string[] {
    return []
  }
}

/** A requirement that serializes as something other than what it holds. */
class WithToJson {
  bearer: string[] = ['read']

  toJSON(): object {
    return {}
  }
}

/** The requirements a host could give that are not plain objects. */
const IMPOSSIBLE: ReadonlyArray<readonly [string, () => object]> = [
  ['a class with an accessor', () => new WithAccessor()],
  ['a class with a toJSON', () => new WithToJson()],
  ['an object derived from another', () => Object.create({ bearer: [] }) as object]
]

/** The three options that hold requirements, each given one. */
const PLACES: ReadonlyArray<readonly [string, (requirement: object) => object]> = [
  ['security', (requirement) => ({ security: [requirement] })],
  ['operationSecurity', (requirement) => ({ operationSecurity: { 'GET /items': [requirement] } })],
  [
    'securitySchemes',
    (requirement) => ({
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', requirement } }
    })
  ]
]

/** A requirement whose tag answers a built-in one for the copy and `Object` afterwards. */
function flipping(): object {
  let answers = 0
  return Object.defineProperty({ bearer: ['x'], toJSON: () => ({}) }, Symbol.toStringTag, {
    get: () => ((answers += 1) <= 2 ? 'X' : 'Object')
  })
}

describe('a requirement that is not a plain object', () => {
  describe.each(IMPOSSIBLE)('%s', (_kind, make) => {
    it.each(PLACES)('is refused in %s, read once by forRoot and as given', (_place, within) => {
      const openapi = { enabled: true, ...within(make()) }

      expect(() => BymaxCoreModule.forRoot({ openapi } as never)).toThrow(
        'the options could not be read'
      )
      expect(() => normalizeCoreOptions({ openapi } as never)).toThrow()
    })
  })

  it.each([
    ['a Map', () => new Map()],
    ['a Set', () => new Set()],
    ['a Date', () => new Date(0)]
  ])('is refused when a security item is %s, and is never emitted', (_name, make) => {
    const openapi = { enabled: true, security: [make()] }

    expect(() => normalizeCoreOptions({ openapi } as never)).toThrow(
      'the options could not be read'
    )
    expect(() => BymaxCoreModule.forRoot({ openapi } as never)).toThrow()
  })

  describe.each(IMPOSSIBLE)(
    '%s, given straight to the resolution of the OpenAPI block',
    (_kind, make) => {
      it.each(PLACES)('is refused in %s by the copy the resolution takes', (place, within) => {
        let thrown: Error | undefined
        try {
          resolveOpenApi({ enabled: true, ...within(make()) })
        } catch (error) {
          thrown = error as Error
        }

        expect(thrown?.message).toBe(`openapi.${place} must hold only plain data`)
        expect(thrown?.cause).toBeInstanceOf(RangeError)
      })
    }
  )

  it('is refused when a security scheme carries a toJSON, as the document would serialize it differently', () => {
    const openapi = {
      enabled: true,
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', toJSON: () => ({}) } },
      security: [{ bearer: [] }]
    }

    expect(() => normalizeCoreOptions({ openapi } as never)).toThrow()
    expect(() => resolveOpenApi(openapi)).toThrow('must hold only plain data')
  })

  it('takes the url of a server once, so the one checked is the one the document carries', () => {
    let reads = 0
    const server = {
      get url(): string {
        reads += 1
        return reads === 1 ? 'https://checked.example' : 'https://other.example'
      }
    }

    const resolved = resolveOpenApi({ enabled: true, servers: [server] })

    expect(resolved.servers[0]?.url).toBe('https://checked.example')
    expect(reads).toBe(1)
  })

  it('counts the work of every option of one resolution against one limit', () => {
    const operationSecurity = Object.fromEntries(
      Array.from({ length: 9 }, (_, index) => [
        `GET /k${index}`,
        Array.from({ length: 100_000 }, () => 0)
      ])
    )
    const security = Array.from({ length: 100_000 }, () => 0)

    expect(() => resolveOpenApi({ enabled: true, security, operationSecurity })).toThrow(
      'must hold only plain data'
    )
  })

  it.each([
    ['security', { security: [{ bearer: [], validate: (): void => undefined }] }],
    [
      'securitySchemes',
      {
        securitySchemes: {
          bearer: { type: 'http', scheme: 'bearer', validate: (): void => undefined }
        }
      }
    ],
    [
      'operationSecurity',
      { operationSecurity: { 'GET /items': [{ bearer: [], validate: (): void => undefined }] } }
    ]
  ])('names %s when a host passes an object that holds a method', (option, held) => {
    let thrown: Error | undefined
    try {
      BymaxCoreModule.forRoot({ openapi: { enabled: true, ...held } } as never)
    } catch (error) {
      thrown = error as Error
    }

    expect(thrown?.message).toBe('the options could not be read')
    expect(thrown?.cause).toMatchObject({
      option,
      message: 'an option holds what cannot be copied as plain data'
    })
  })

  it('names the option when a host getter throws while the security copy is taken, keeping what it threw', () => {
    const security = [
      {
        get bearer(): string[] {
          throw new Error('host error')
        }
      }
    ]
    let thrown: Error | undefined
    try {
      BymaxCoreModule.forRoot({ openapi: { enabled: true, security } } as never)
    } catch (error) {
      thrown = error as Error
    }

    expect(thrown?.message).toBe('the options could not be read')
    expect(thrown?.cause).toMatchObject({ option: 'security' })
    expect(((thrown?.cause as Error).cause as Error).message).toBe('host error')
  })

  it.each([
    [
      'a proxy with no ownKeys trap around a class instance holding some names on its prototype',
      'security'
    ],
    ['the same, as an operation requirement', 'operationSecurity']
  ])('refuses %s (%s) instead of serving the requirement without its scopes', (_name, place) => {
    class Mixed {
      b: string[] = []
      get o(): string[] {
        return ['read', 'write']
      }
    }
    const requirement = new Proxy(new Mixed(), {})
    const given =
      place === 'security'
        ? { security: [requirement] }
        : { operationSecurity: { 'GET /items': [requirement] } }

    expect(() =>
      BymaxCoreModule.forRoot({ openapi: { enabled: true, ...given } } as never)
    ).toThrow('the options could not be read')
    expect(() => normalizeCoreOptions({ openapi: { enabled: true, ...given } } as never)).toThrow()
  })

  it.each([
    [
      'a list whose length is not a number',
      (): object =>
        new Proxy([], { get: (t, k, r) => (k === 'length' ? Number.NaN : Reflect.get(t, k, r)) })
    ],
    [
      'a revoked proxy',
      (): object => {
        const { proxy, revoke } = Proxy.revocable({}, {})
        revoke()
        return proxy
      }
    ]
  ])('names the option when the security list holds %s', (_name, make) => {
    let thrown: Error | undefined
    try {
      BymaxCoreModule.forRoot({ openapi: { enabled: true, security: [make()] } } as never)
    } catch (error) {
      thrown = error as Error
    }

    expect(thrown?.message).toBe('the options could not be read')
    expect(thrown?.cause).toMatchObject({ option: 'security' })
  })

  it('is refused whatever its tag answers, since plainness is not decided by the tag', () => {
    const openapi = { enabled: true, security: [flipping()] }

    expect(() => BymaxCoreModule.forRoot({ openapi } as never)).toThrow()
    expect(() => normalizeCoreOptions({ openapi } as never)).toThrow()
  })

  it('is not what a plain requirement is: that one is emitted as it was given', () => {
    const resolved = normalizeCoreOptions({
      openapi: { enabled: true, security: [{ bearer: [] }, {}] }
    } as never)

    expect(JSON.stringify(resolved.openapi.security)).toBe('[{"bearer":[]},{}]')
  })
})
