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
    map.record(controllerKey, methodKey, undefined, id)
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

    map.record('AuthController', 'login', undefined, 'AuthController_login')

    expect(map.idsFor('AuthController.login')).toEqual(['AuthController_login'])
    expect(map.keys()).toEqual(['AuthController.login'])
  })

  /**
   * A versioned handler keeps every id it produced.
   *
   * Under URI versioning the same handler answers at `/v1/...` and `/v2/...`,
   * and the peer asks for an id per version. Keeping only the last would leave
   * every other version undocumented while the fragment looked applied.
   */
  it('records one id per version of the same handler', () => {
    const map = createHandlerIdMap()

    map.record('AuthController', 'login', 'v1', 'AuthController_login_v1')
    map.record('AuthController', 'login', 'v2', 'AuthController_login_v2')

    expect(map.idsFor('AuthController.login')).toEqual([
      'AuthController_login_v1',
      'AuthController_login_v2'
    ])
  })

  /**
   * Two controllers sharing a name are refused, not merged.
   *
   * The key addresses both, so a fragment written for one would document the
   * other as well. That is unresolvable rather than awkward, and silence would
   * mean a library's description landing on a route it has never heard of.
   */
  it('throws when the same handler and version is recorded twice', () => {
    const map = createHandlerIdMap()
    map.record('AuthController', 'login', undefined, 'AuthController_login')

    const again = (): void =>
      map.record('AuthController', 'login', undefined, 'AuthController_login')

    expect(again).toThrow(
      /two route handlers in this application answer to "AuthController\.login"/
    )
    expect(again).toThrow(/an OpenAPI fragment addressing it would apply to both/)
    expect(again).toThrow(/Handler keys are "<ControllerClassName>\.<methodName>"/)
    expect(again).toThrow(/rename one of the controller classes/)
  })

  /**
   * An unknown handler has no id.
   *
   * Distinguishing "not recorded" from "recorded as something" is what lets the
   * resolver report a stale key instead of writing a fragment nowhere.
   */
  it('returns undefined for a handler it never saw', () => {
    expect(createHandlerIdMap().idsFor('Missing.handler')).toEqual([])
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
   * Two contributors sharing a class name are refused, not ordered.
   *
   * They sort equal, so whichever wins a collision between them would be
   * decided by the container's traversal — stable-looking right up until a
   * refactor moves a provider. The label is also the only identity an error
   * could name, so there is no report that would help either.
   */
  it('throws when two contributors share a class name', () => {
    const first = contributorClass('AuthOpenApi', {
      contractVersion: BYMAX_OPENAPI_CONTRACT_VERSION
    })
    const second = contributorClass('AuthOpenApi', {
      contractVersion: BYMAX_OPENAPI_CONTRACT_VERSION
    })

    expect(() =>
      collectContributions(
        scannerOf([
          { metatype: first, instance: new first() },
          { metatype: second, instance: new second() }
        ]),
        reflector,
        mapOf({})
      )
    ).toThrow(
      /more than one OpenAPI contributor is named "AuthOpenApi", so the order they merge in would depend on the container rather than on anything stated\. Rename one of the contributor classes\./
    )
  })

  /**
   * Every duplicated name is reported, separated.
   *
   * One boot per collision would be a poor trade, and a list rendered without
   * separators reads as a single nonsense class name — the opposite of what a
   * message naming the mistake is for.
   */
  it('lists every duplicated contributor name it found', () => {
    const version = BYMAX_OPENAPI_CONTRACT_VERSION
    const alphaOne = contributorClass('AlphaOpenApi', { contractVersion: version })
    const alphaTwo = contributorClass('AlphaOpenApi', { contractVersion: version })
    const zuluOne = contributorClass('ZuluOpenApi', { contractVersion: version })
    const zuluTwo = contributorClass('ZuluOpenApi', { contractVersion: version })

    expect(() =>
      collectContributions(
        scannerOf([
          { metatype: alphaOne, instance: new alphaOne() },
          { metatype: alphaTwo, instance: new alphaTwo() },
          { metatype: zuluOne, instance: new zuluOne() },
          { metatype: zuluTwo, instance: new zuluTwo() }
        ]),
        reflector,
        mapOf({})
      )
    ).toThrow(/is named "AlphaOpenApi", "ZuluOpenApi", so the order/)
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
