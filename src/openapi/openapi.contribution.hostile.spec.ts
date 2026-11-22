/**
 * Unit tests for a contributor whose fragment cannot be read.
 *
 * Layer: unit.
 * Goal: a declared contract version of any kind is described, never echoed; a fragment that is not
 * an object, a getter that throws and a proxy that throws or is revoked, at the fragment, in
 * `operations`, in `components` or in a section, fail the boot as the contributor's labelled error
 * with what went wrong as the cause; and a component section that is not an object copies as empty.
 * Mocks: the provider graph is expressed as plain objects, which is what `ProviderScanner` exists for.
 */
import { Reflector } from '@nestjs/core'

import {
  BYMAX_OPENAPI_CONTRACT_VERSION,
  BYMAX_OPENAPI_CONTRIBUTOR_METADATA
} from './openapi.contract'
import type { IOpenApiContributor, OpenApiFragment } from './openapi.contract'
import { collectContributions, createHandlerIdMap } from './openapi.contribution'
import type { HandlerIdMap } from './openapi.contribution'

/** A scanner over a fixed provider list. */
function scannerOf(providers: readonly { metatype?: unknown; instance?: unknown }[]) {
  return { getProviders: () => providers }
}

/** A class marked as a contributor, returning the given fragment. */
function contributorClass(name: string, fragment: OpenApiFragment): new () => IOpenApiContributor {
  const created = {
    [name]: class {
      contributeOpenApi(): OpenApiFragment {
        return fragment
      }
    }
  }[name] as new () => IOpenApiContributor
  Reflect.defineMetadata(BYMAX_OPENAPI_CONTRIBUTOR_METADATA, true, created)
  return created
}

/** A map already carrying the given handlers, as the scan would have filled it. */
function mapOf(handlers: Readonly<Record<string, string>>): HandlerIdMap {
  const map = createHandlerIdMap()
  for (const [handlerKey, id] of Object.entries(handlers)) {
    const [controllerKey = '', methodKey = ''] = handlerKey.split('.')
    map.record(controllerKey, methodKey, undefined, id)
  }
  return map
}

/** A proxy that has been revoked, so any read of it throws. */
function revokedProxy(): object {
  const revocable = Proxy.revocable({}, {})
  revocable.revoke()
  return revocable.proxy
}

describe('collectContributions, a fragment that cannot be read', () => {
  const reflector = new Reflector()

  /**
   * A contract version that cannot be read is described, not thrown through.
   *
   * The message is library text for any value the contributor declared, and the declared value is the
   * cause, so a throwing `toString`, a null prototype or a revoked proxy cannot escape the boot error raw.
   */
  it.each([
    [
      'a throwing toString',
      {
        toString: () => {
          throw new Error('boom')
        }
      },
      'an object'
    ],
    ['a null-prototype object', Object.create(null) as object, 'an object'],
    ['a string', 'SECRET-v', 'a string'],
    [
      'a revoked proxy',
      (() => {
        const r = Proxy.revocable({}, {})
        r.revoke()
        return r.proxy
      })(),
      'a value that cannot be read'
    ]
  ])('names the revision declared as %s without its text', (_name, declared, shown) => {
    const Odd = {
      Odd: class {
        contributeOpenApi(): OpenApiFragment {
          return { contractVersion: declared as unknown as 1 }
        }
      }
    }.Odd
    Reflect.defineMetadata(BYMAX_OPENAPI_CONTRIBUTOR_METADATA, true, Odd)

    let caught: unknown
    try {
      collectContributions(
        scannerOf([{ metatype: Odd, instance: new Odd() }]),
        reflector,
        mapOf({})
      )
    } catch (error) {
      caught = error
    }

    expect((caught as Error).message).toBe(
      `[BymaxCoreModule] an OpenAPI contributor contributed a fragment written against OpenAPI contract version ${shown}, ` +
        `and this package speaks version 1. Upgrade whichever of the two is behind; the shapes are not interchangeable.`
    )
    expect(((caught as Error).cause as Error).cause).toBe(declared)
  })

  /**
   * A fragment that cannot be read is the contributor's failure, labelled, with what threw as the cause.
   *
   * The three members are read inside the guard, so a missing fragment, a getter that throws and a
   * proxy whose `get` throws cannot escape as a raw error that names no contributor.
   */
  it.each([
    ['undefined', undefined],
    ['null', null],
    [
      'a throwing contractVersion getter',
      {
        get contractVersion(): never {
          throw new Error('SECRET-getter')
        }
      }
    ],
    [
      'a throwing operations getter',
      {
        contractVersion: BYMAX_OPENAPI_CONTRACT_VERSION,
        get operations(): never {
          throw new Error('SECRET-getter')
        }
      }
    ],
    [
      'operations as a proxy whose ownKeys throws',
      {
        contractVersion: BYMAX_OPENAPI_CONTRACT_VERSION,
        operations: new Proxy(
          {},
          {
            ownKeys: () => {
              throw new Error('SECRET-ownKeys')
            }
          }
        )
      }
    ],
    [
      'operations as a revoked proxy',
      { contractVersion: BYMAX_OPENAPI_CONTRACT_VERSION, operations: revokedProxy() }
    ],
    [
      'components as a proxy whose descriptor read throws',
      {
        contractVersion: BYMAX_OPENAPI_CONTRACT_VERSION,
        components: new Proxy(
          { schemas: {} },
          {
            getOwnPropertyDescriptor: () => {
              throw new Error('SECRET-gopd')
            }
          }
        )
      }
    ],
    [
      'a components section that is a revoked proxy',
      {
        contractVersion: BYMAX_OPENAPI_CONTRACT_VERSION,
        components: { schemas: revokedProxy() }
      }
    ],
    [
      'a schema read by a getter that throws',
      {
        contractVersion: BYMAX_OPENAPI_CONTRACT_VERSION,
        components: {
          schemas: {
            get Widget(): never {
              throw new Error('SECRET-schema')
            }
          }
        }
      }
    ],
    [
      'a proxy whose get throws',
      new Proxy(
        {},
        {
          get: () => {
            throw new Error('SECRET-getter')
          }
        }
      )
    ]
  ])('labels a contributor that returned %s', (_name, returned) => {
    const Odd = {
      Odd: class {
        contributeOpenApi(): OpenApiFragment {
          return returned as OpenApiFragment
        }
      }
    }.Odd
    Reflect.defineMetadata(BYMAX_OPENAPI_CONTRIBUTOR_METADATA, true, Odd)

    let caught: unknown
    try {
      collectContributions(
        scannerOf([{ metatype: Odd, instance: new Odd() }]),
        reflector,
        mapOf({})
      )
    } catch (error) {
      caught = error
    }

    expect(caught).toMatchObject({
      message:
        '[BymaxCoreModule] an OpenAPI contributor failed to contribute to the OpenAPI document',
      contributor: 'Odd'
    })
    expect((caught as Error).cause).toBeInstanceOf(Error)
  })

  /**
   * A component section that is not an object offers nothing and does not stop the boot.
   *
   * A JavaScript contributor can hand over `null` or a string for a member; the merge treats it as
   * offering no entries, and the copy taken under the guard keeps that.
   */
  it('copies a component section that is not an object as an empty one', () => {
    const Odd = contributorClass('Odd', {
      contractVersion: BYMAX_OPENAPI_CONTRACT_VERSION,
      components: { schemas: null, parameters: 'x', responses: { Ok: { description: 'ok' } } }
    } as unknown as OpenApiFragment)

    const [contribution] = collectContributions(
      scannerOf([{ metatype: Odd, instance: new Odd() }]),
      reflector,
      mapOf({})
    )

    expect(contribution?.components).toEqual({
      schemas: {},
      parameters: {},
      responses: { Ok: { description: 'ok' } }
    })
  })

  /** The result of collecting one contributor that returns `fragment`, or what was thrown. */
  function collectOne(fragment: unknown): { thrown?: Error; components?: object } {
    const Odd = contributorClass('Odd', fragment as OpenApiFragment)
    try {
      const [contribution] = collectContributions(
        scannerOf([{ metatype: Odd, instance: new Odd() }]),
        reflector,
        mapOf({ 'Items.list': 'Items_list' })
      )
      return { components: contribution?.components as object }
    } catch (error) {
      return { thrown: error as Error }
    }
  }

  /**
   * A fragment that holds itself, or nests past the limit, fails as the contributor's error.
   *
   * Copying under the guard must end: a cycle never does, so it is refused with a range error as
   * the cause, and so is a nesting no document needs.
   */
  it.each([
    [
      'holds itself',
      (): object => {
        const schema: Record<string, unknown> = { type: 'object' }
        schema['self'] = schema
        return { schemas: { Loop: schema } }
      }
    ],
    [
      'is nested past the limit',
      (): object => {
        let deepest: Record<string, unknown> = {}
        for (let level = 0; level < 70; level += 1) deepest = { next: deepest }
        return { schemas: { Deep: deepest } }
      }
    ]
  ])('refuses a fragment that %s', (_name, components) => {
    const { thrown } = collectOne({
      contractVersion: BYMAX_OPENAPI_CONTRACT_VERSION,
      components: components()
    })

    expect(thrown).toMatchObject({ contributor: 'Odd' })
    expect(thrown?.cause).toBeInstanceOf(RangeError)
  })

  /**
   * What is not a plain object or a list is kept as given, and a shared object is not a cycle.
   *
   * An example may be a `Date`; copying it as an object would serve `{}`. The same schema used in
   * two places is one object reached twice, which is not a loop.
   */
  it('keeps a Date as it is and copies an object used in two places', () => {
    const when = new Date(0)
    const shared = { type: 'string' }
    const { thrown, components } = collectOne({
      contractVersion: BYMAX_OPENAPI_CONTRACT_VERSION,
      components: { schemas: { A: { example: when, one: shared, two: shared } } }
    })

    expect(thrown).toBeUndefined()
    const schemas = (components as { schemas: { A: Record<string, unknown> } }).schemas
    expect(schemas.A['example']).toBe(when)
    expect(schemas.A['one']).toEqual({ type: 'string' })
    expect(schemas.A['two']).toEqual({ type: 'string' })
    expect(schemas.A['one']).not.toBe(shared)
  })

  /**
   * A component section that is a class instance is read under the guard like a plain one.
   *
   * The copy keeps a class instance as given, so the entries of a section are taken from it here:
   * a getter that throws must fail the boot as the contributor's labelled error, with the cause, and
   * not later as the raw host error from the merge.
   */
  it('labels a contributor whose component section is a class instance with a throwing getter', () => {
    class Section {
      constructor() {
        Object.defineProperty(this, 'Item', {
          enumerable: true,
          get: (): never => {
            throw new Error('SECRET-host')
          }
        })
      }
    }

    const { thrown } = collectOne({
      contractVersion: BYMAX_OPENAPI_CONTRACT_VERSION,
      components: { schemas: new Section() }
    })

    expect(thrown).toMatchObject({
      message:
        '[BymaxCoreModule] an OpenAPI contributor failed to contribute to the OpenAPI document',
      contributor: 'Odd',
      cause: { message: 'SECRET-host' }
    })
  })

  /**
   * An operations map, or an operation, that is not plain is the contributor's failure, not an operation
   * with no security: a `Map` has no own entries, a class instance or an object derived from another
   * keeps its entries elsewhere, and a proxy that lists none says nothing.
   */
  describe.each([
    ['a Map', (): object => new Map([['Items.list', { responses: {} }]])],
    [
      'a class instance',
      (): object =>
        new (class Held {
          'Items.list' = {}
        })()
    ],
    ['an object derived from another', (): object => Object.create({ 'Items.list': {} }) as object],
    ['a proxy that lists no keys', (): object => new Proxy({}, { get: () => ({}) })]
  ])('operations given as %s', (_kind, make) => {
    it('is refused as the map and as an entry', () => {
      const asMap = collectOne({
        contractVersion: BYMAX_OPENAPI_CONTRACT_VERSION,
        operations: make()
      })
      const asEntry = collectOne({
        contractVersion: BYMAX_OPENAPI_CONTRACT_VERSION,
        operations: { 'Items.list': make() }
      })

      expect(asMap.thrown).toMatchObject({ contributor: 'Odd' })
      expect(asEntry.thrown).toMatchObject({ contributor: 'Odd' })
    })
  })

  it('names why a Map is refused, and accepts a map and an operation made with no prototype', () => {
    const refused = collectOne({
      contractVersion: BYMAX_OPENAPI_CONTRACT_VERSION,
      operations: new Map()
    })
    const bare = Object.assign(Object.create(null) as object, { responses: {} })
    const accepted = collectOne({
      contractVersion: BYMAX_OPENAPI_CONTRACT_VERSION,
      operations: Object.assign(Object.create(null) as object, { 'Items.list': bare })
    })

    expect((refused.thrown?.cause as Error).message).toBe(
      'An OpenAPI fragment must be a plain object'
    )
    expect(accepted.thrown).toBeUndefined()
  })

  it.each([
    ['Object.prototype', (): object | null => Object.prototype],
    ['null', (): object | null => null]
  ])(
    'refuses an operation, and a map, that is a proxy answering %s as its prototype',
    (_name, answer) => {
      class Op {
        responses = {}
        get security(): object[] {
          return [{ bearer: ['read'] }]
        }
      }
      const asEntry = collectOne({
        contractVersion: BYMAX_OPENAPI_CONTRACT_VERSION,
        operations: { 'Items.list': new Proxy(new Op(), { getPrototypeOf: answer }) }
      })
      const asMap = collectOne({
        contractVersion: BYMAX_OPENAPI_CONTRACT_VERSION,
        operations: new Proxy({ 'Items.list': { responses: {} } }, { ownKeys: () => [] })
      })

      expect(asEntry.thrown).toMatchObject({ contributor: 'Odd' })
      expect(asMap.thrown).toMatchObject({ contributor: 'Odd' })
    }
  )

  it('refuses an operation, and a map, that is a proxy around a class holding names on its prototype', () => {
    class Op {
      responses = {}
      get security(): object[] {
        return [{ bearer: ['read'] }]
      }
    }
    class Operations {
      get 'Items.list'(): object {
        return { responses: {} }
      }
    }

    const asEntry = collectOne({
      contractVersion: BYMAX_OPENAPI_CONTRACT_VERSION,
      operations: { 'Items.list': new Proxy(new Op(), {}) }
    })
    const asMap = collectOne({
      contractVersion: BYMAX_OPENAPI_CONTRACT_VERSION,
      operations: new Proxy(new Operations(), {})
    })

    expect(asEntry.thrown).toMatchObject({ contributor: 'Odd' })
    expect(asMap.thrown).toMatchObject({ contributor: 'Odd' })
  })

  it('refuses a list with a hole in an operation instead of serving a null entry', () => {
    const holey: unknown[] = new Array<unknown>(2)
    holey[1] = { name: 'id' }

    const { thrown } = collectOne({
      contractVersion: BYMAX_OPENAPI_CONTRACT_VERSION,
      operations: { 'Items.list': { parameters: holey } }
    })

    expect(thrown).toMatchObject({ contributor: 'Odd', cause: { message: 'A list has a hole' } })
  })

  it('keeps a plain operations map and a plain operation', () => {
    const { thrown } = collectOne({
      contractVersion: BYMAX_OPENAPI_CONTRACT_VERSION,
      operations: { 'Items.list': { responses: {} } }
    })

    expect(thrown).toBeUndefined()
  })
})
