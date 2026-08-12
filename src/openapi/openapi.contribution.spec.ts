/**
 * Unit tests for collecting and resolving library contributions.
 *
 * Layer: unit.
 * Goal: prove the handler-to-id map records what the peer asks about; that a
 * marked provider which cannot contribute fails the build naming itself rather
 * than being skipped; that a fragment addressing a handler the application does
 * not have is reported with the handlers that exist; and that contributors run
 * in an order that does not depend on the container.
 * Mocks: the provider graph is expressed as plain objects, which is what
 * `ProviderScanner` exists for — no container is needed to test a scan.
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
    map.record(controllerKey, methodKey, id)
  }
  return map
}

describe('createHandlerIdMap', () => {
  /**
   * The map answers with the id the peer assigned.
   *
   * This is the whole mechanism: a library addresses a handler, the peer names
   * the operation, and the map is the only place those two meet.
   */
  it('records an id per handler and reads it back', () => {
    const map = createHandlerIdMap()

    map.record('AuthController', 'login', 'AuthController_login')

    expect(map.idFor('AuthController.login')).toBe('AuthController_login')
    expect(map.keys()).toEqual(['AuthController.login'])
  })

  /**
   * An unknown handler has no id.
   *
   * Distinguishing "not recorded" from "recorded as something" is what lets the
   * resolver report a stale key instead of writing a fragment nowhere.
   */
  it('returns undefined for a handler it never saw', () => {
    expect(createHandlerIdMap().idFor('Missing.handler')).toBeUndefined()
  })
})

describe('collectContributions', () => {
  const reflector = new Reflector()

  /**
   * A marked contributor is called and its fragment resolved.
   *
   * The handler key becomes the operation id here, which is what lets the merge
   * stay free of any notion of a controller.
   */
  it('resolves handler keys into operation ids', () => {
    const Contributor = contributorClass('AuthOpenApi', {
      contractVersion: BYMAX_OPENAPI_CONTRACT_VERSION,
      operations: { 'AuthController.login': { security: [] } },
      components: { securitySchemes: { authCookie: { type: 'apiKey' } } }
    })

    const [contribution] = collectContributions(
      scannerOf([{ metatype: Contributor, instance: new Contributor() }]),
      reflector,
      mapOf({ 'AuthController.login': 'AuthController_login' })
    )

    expect(contribution?.label).toBe('AuthOpenApi')
    expect(contribution?.operations).toEqual({ AuthController_login: { security: [] } })
    expect(contribution?.components).toEqual({
      securitySchemes: { authCookie: { type: 'apiKey' } }
    })
  })

  /**
   * A fragment may contribute components alone, or nothing at all.
   *
   * Both members are optional, and a contributor that decides it has nothing to
   * say for this configuration must be able to say so without failing.
   */
  it('accepts a fragment with neither member', () => {
    const Contributor = contributorClass('Quiet', {
      contractVersion: BYMAX_OPENAPI_CONTRACT_VERSION
    })

    const [contribution] = collectContributions(
      scannerOf([{ metatype: Contributor, instance: new Contributor() }]),
      reflector,
      mapOf({})
    )

    expect(contribution?.operations).toEqual({})
    expect(contribution?.components).toEqual({})
  })

  /**
   * An unmarked provider is never called.
   *
   * Marking is a declaration of intent; a class that merely happens to expose
   * `contributeOpenApi` has not made it.
   */
  it('ignores providers without the marker', () => {
    class Unmarked {
      contributeOpenApi(): OpenApiFragment {
        throw new Error('must not be called')
      }
    }

    expect(
      collectContributions(
        scannerOf([{ metatype: Unmarked, instance: new Unmarked() }]),
        reflector,
        mapOf({})
      )
    ).toEqual([])
  })

  /**
   * A marked class that cannot contribute fails, named.
   *
   * Skipping it silently would produce a document missing exactly the
   * operations someone marked a class to describe, and the marker is the
   * evidence they meant to.
   */
  it('throws when a marked provider does not implement the contract', () => {
    class Broken {}
    Reflect.defineMetadata(BYMAX_OPENAPI_CONTRIBUTOR_METADATA, true, Broken)

    expect(() =>
      collectContributions(
        scannerOf([{ metatype: Broken, instance: new Broken() }]),
        reflector,
        mapOf({})
      )
    ).toThrow(/"Broken" is marked @BymaxOpenApiContributor\(\) but does not implement/)
  })

  /**
   * A non-object instance is not a contributor either. Edge case.
   *
   * A `useValue` binding can be a primitive, and reading a method off one would
   * throw somewhere less informative than here.
   */
  it('throws when a marked provider resolved to a primitive', () => {
    class Primitive {}
    Reflect.defineMetadata(BYMAX_OPENAPI_CONTRIBUTOR_METADATA, true, Primitive)

    expect(() =>
      collectContributions(scannerOf([{ metatype: Primitive, instance: 42 }]), reflector, mapOf({}))
    ).toThrow(/does not implement IOpenApiContributor/)
  })

  /**
   * A null instance is not a contributor either. Edge case.
   *
   * `typeof null` is `'object'`, so a guard checking only the type would read a
   * method off it and throw somewhere with no contributor named.
   */
  it('throws when a marked provider resolved to null', () => {
    class Nullish {}
    Reflect.defineMetadata(BYMAX_OPENAPI_CONTRIBUTOR_METADATA, true, Nullish)

    expect(() =>
      collectContributions(scannerOf([{ metatype: Nullish, instance: null }]), reflector, mapOf({}))
    ).toThrow(/does not implement IOpenApiContributor/)
  })

  /**
   * A contributor that throws fails the build with its name and its cause.
   *
   * A library that meant to describe its routes and could not is a defect. The
   * cause is chained because the reason lives in the library, not here.
   */
  it('names the contributor when it throws', () => {
    const Exploding = {
      Exploding: class {
        contributeOpenApi(): OpenApiFragment {
          throw new Error('options not resolved')
        }
      }
    }.Exploding
    Reflect.defineMetadata(BYMAX_OPENAPI_CONTRIBUTOR_METADATA, true, Exploding)

    expect(() =>
      collectContributions(
        scannerOf([{ metatype: Exploding, instance: new Exploding() }]),
        reflector,
        mapOf({})
      )
    ).toThrow(/"Exploding" failed to contribute to the OpenAPI document: options not resolved/)
  })

  /**
   * The original failure is chained, not just quoted.
   *
   * The message says which library failed; the cause says where in it. Losing
   * the stack would leave whoever has to fix it with a sentence and no line.
   */
  it('chains the contributor original error as the cause', () => {
    const failure = new Error('options not resolved')
    const Chained = {
      Chained: class {
        contributeOpenApi(): OpenApiFragment {
          throw failure
        }
      }
    }.Chained
    Reflect.defineMetadata(BYMAX_OPENAPI_CONTRIBUTOR_METADATA, true, Chained)

    try {
      collectContributions(
        scannerOf([{ metatype: Chained, instance: new Chained() }]),
        reflector,
        mapOf({})
      )
      throw new Error('expected the collection to fail')
    } catch (error) {
      expect((error as { cause?: unknown }).cause).toBe(failure)
    }
  })

  /**
   * A contributor throwing a non-Error is still reported. Edge case.
   *
   * Nothing obliges a library to throw an `Error`, and the message must not
   * become "[object Object]" for whoever has to find the cause.
   */
  it('reports a contributor that threw a non-Error', () => {
    const Odd = {
      Odd: class {
        contributeOpenApi(): OpenApiFragment {
          throw 'plain string'
        }
      }
    }.Odd
    Reflect.defineMetadata(BYMAX_OPENAPI_CONTRIBUTOR_METADATA, true, Odd)

    expect(() =>
      collectContributions(
        scannerOf([{ metatype: Odd, instance: new Odd() }]),
        reflector,
        mapOf({})
      )
    ).toThrow(/"Odd" failed to contribute to the OpenAPI document: plain string/)
  })

  /**
   * A fragment for a handler the application lacks fails, listing what exists.
   *
   * Renaming a method is a refactor nobody thinks of as a documentation change,
   * so a stale key is a check that quietly stops running — the failure this
   * whole lane is least able to notice on its own.
   */
  it('throws when a fragment addresses an unknown handler', () => {
    const Contributor = contributorClass('AuthOpenApi', {
      contractVersion: BYMAX_OPENAPI_CONTRACT_VERSION,
      operations: { 'AuthController.renamed': {}, 'AuthController.gone': {} }
    })

    const build = () =>
      collectContributions(
        scannerOf([{ metatype: Contributor, instance: new Contributor() }]),
        reflector,
        mapOf({
          'AuthController.login': 'AuthController_login',
          'AuthController.logout': 'AuthController_logout'
        })
      )

    expect(build).toThrow(/"AuthOpenApi" contributed fragments for 2 handler\(s\)/)
    expect(build).toThrow(/does not have: AuthController\.renamed, AuthController\.gone\./)
    expect(build).toThrow(/"<ControllerClassName>\.<methodName>"/)
    expect(build).toThrow(/The application has: AuthController\.login, AuthController\.logout\./)
  })

  /**
   * An application with no handlers at all says so. Edge case.
   *
   * The list is the actionable half of the message; trailing off after the
   * colon would read as truncation rather than as emptiness.
   */
  it('names an application with no handlers explicitly', () => {
    const Contributor = contributorClass('AuthOpenApi', {
      contractVersion: BYMAX_OPENAPI_CONTRACT_VERSION,
      operations: { 'A.b': {} }
    })

    expect(() =>
      collectContributions(
        scannerOf([{ metatype: Contributor, instance: new Contributor() }]),
        reflector,
        mapOf({})
      )
    ).toThrow(/The application has: \(none\)\./)
  })

  /**
   * A library can mark a class without importing anything at runtime.
   *
   * This is the contract's most consequential property and the reason it can
   * live beside the merge engine rather than on a subpath of its own: a
   * contributing library consumes the fragment shapes with `import type`, which
   * compiles away, and writes the documented literal with its own metadata
   * call. It ships zero bytes of this package. Pinned here because it is a
   * promise made to other repositories, not an implementation detail — the
   * literal is spelled out rather than imported, exactly as a library would.
   */
  it('discovers a class marked with the documented literal alone', () => {
    class LibraryContributor {
      contributeOpenApi(): OpenApiFragment {
        return {
          contractVersion: BYMAX_OPENAPI_CONTRACT_VERSION,
          components: { securitySchemes: { libScheme: { type: 'apiKey' } } }
        }
      }
    }
    Reflect.defineMetadata('bymax-one:openapi-contributor', true, LibraryContributor)

    const [contribution] = collectContributions(
      scannerOf([{ metatype: LibraryContributor, instance: new LibraryContributor() }]),
      reflector,
      mapOf({})
    )

    expect(contribution?.label).toBe('LibraryContributor')
    expect(contribution?.components).toEqual({ securitySchemes: { libScheme: { type: 'apiKey' } } })
  })

  /**
   * A fragment from an unknown contract revision fails, naming both.
   *
   * Types cannot catch this: a library and the application installing it each
   * type-check against their own copy of this package, so a shape mismatch is
   * invisible until the value arrives at runtime. Naming both revisions turns
   * an afternoon reading a subtly wrong document into one line of instruction.
   */
  it('throws when a fragment declares an unknown contract revision', () => {
    const Ahead = {
      Ahead: class {
        contributeOpenApi(): OpenApiFragment {
          return { contractVersion: 2 as unknown as 1 }
        }
      }
    }.Ahead
    Reflect.defineMetadata(BYMAX_OPENAPI_CONTRIBUTOR_METADATA, true, Ahead)

    const build = () =>
      collectContributions(
        scannerOf([{ metatype: Ahead, instance: new Ahead() }]),
        reflector,
        mapOf({})
      )

    expect(build).toThrow(/"Ahead" contributed a fragment written against OpenAPI contract/)
    expect(build).toThrow(/version 2, and this package speaks version 1/)
    expect(build).toThrow(/the shapes are not interchangeable/i)
  })

  /**
   * Contributors run in a stable order.
   *
   * Two libraries contributing to the same operation must resolve the same way
   * on every boot; an order taken from the container's traversal would let one
   * win on Monday and the other on Tuesday, which is the kind of defect that
   * survives a green suite.
   */
  it('orders contributors by class name, not by container order', () => {
    const version = BYMAX_OPENAPI_CONTRACT_VERSION
    const Zulu = contributorClass('ZuluOpenApi', { contractVersion: version })
    const Alpha = contributorClass('AlphaOpenApi', { contractVersion: version })

    const collected = collectContributions(
      scannerOf([
        { metatype: Zulu, instance: new Zulu() },
        { metatype: Alpha, instance: new Alpha() }
      ]),
      reflector,
      mapOf({})
    )

    expect(collected.map((entry) => entry.label)).toEqual(['AlphaOpenApi', 'ZuluOpenApi'])
  })
})
