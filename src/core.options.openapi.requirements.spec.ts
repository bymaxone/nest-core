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
      'openapi.security[0] must be an object'
    )
    expect(() => BymaxCoreModule.forRoot({ openapi } as never)).toThrow()
  })

  it('is not what a plain requirement is: that one is emitted as it was given', () => {
    const resolved = normalizeCoreOptions({
      openapi: { enabled: true, security: [{ bearer: [] }, {}] }
    } as never)

    expect(JSON.stringify(resolved.openapi.security)).toBe('[{"bearer":[]},{}]')
  })
})
