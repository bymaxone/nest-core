/**
 * Unit tests for the shared marker-based provider scan.
 *
 * Layer: unit.
 * Goal: prove the scan keeps exactly the providers carrying the requested key,
 * skips the ones that cannot carry metadata at all, and labels each survivor by
 * something a reader can find — the class name, or the provider token when the
 * class is anonymous.
 * Mocks: the provider graph is expressed as plain objects against the structural
 * `ProviderScanner` contract; metadata is read by the real `Reflector`.
 */
import { SetMetadata } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { findMarkedProviders } from './discovery'
import type { ProviderNode } from './discovery'

/** Two independent marker keys, to prove the scan matches only what it is asked for. */
const WANTED_KEY = 'test:wanted'
const OTHER_KEY = 'test:other'

/** A class carrying the key the scan looks for. */
@SetMetadata(WANTED_KEY, true)
class WantedProvider {}

/** A class carrying a different marker entirely. */
@SetMetadata(OTHER_KEY, true)
class OtherMarkedProvider {}

/** A class carrying no marker at all. */
class PlainProvider {}

/** Build a scanner over the given provider entries. */
function scannerOver(nodes: readonly ProviderNode[]): { getProviders(): readonly ProviderNode[] } {
  return { getProviders: () => nodes }
}

describe('findMarkedProviders', () => {
  const reflector = new Reflector()

  /**
   * Only the requested key matches.
   *
   * Two features share this scan, each with its own key; a scan that matched any
   * marker would hand a readiness aggregator a metrics contributor.
   */
  it('keeps only providers carrying the requested key', () => {
    const nodes = [
      { metatype: WantedProvider, instance: new WantedProvider(), name: 'WantedProvider' },
      {
        metatype: OtherMarkedProvider,
        instance: new OtherMarkedProvider(),
        name: 'OtherMarkedProvider'
      },
      { metatype: PlainProvider, instance: new PlainProvider(), name: 'PlainProvider' }
    ]

    const marked = findMarkedProviders(scannerOver(nodes), reflector, WANTED_KEY)

    expect(marked.map((entry) => entry.label)).toEqual(['WantedProvider'])
  })

  /**
   * A provider with no class is skipped. Edge case: value provider.
   *
   * `useValue` and `useFactory` bindings have no metatype to carry metadata, so
   * they can never be marked; reading metadata off them would throw.
   */
  it('skips providers that have no class', () => {
    const nodes: ProviderNode[] = [
      { metatype: null, instance: {}, name: 'VALUE_TOKEN' },
      { metatype: undefined, instance: {}, name: 'FACTORY_TOKEN' },
      { metatype: WantedProvider, instance: new WantedProvider(), name: 'WantedProvider' }
    ]

    const marked = findMarkedProviders(scannerOver(nodes), reflector, WANTED_KEY)

    expect(marked.map((entry) => entry.label)).toEqual(['WantedProvider'])
  })

  /**
   * The instance is returned unvalidated.
   *
   * Each feature checks its own contract, so the scan must hand back whatever is
   * there — including a `null` instance — rather than filtering on a shape it
   * does not know.
   */
  it('returns the instance without inspecting it', () => {
    const nodes: ProviderNode[] = [
      { metatype: WantedProvider, instance: null, name: 'WantedProvider' }
    ]

    const marked = findMarkedProviders(scannerOver(nodes), reflector, WANTED_KEY)

    expect(marked).toEqual([{ instance: null, label: 'WantedProvider' }])
  })

  /**
   * An anonymous class falls back to the provider token. Edge case.
   *
   * The label exists to point a reader at something they can find; an empty
   * class name would point at nothing.
   */
  it('labels an anonymous class by its provider token', () => {
    const anonymous = class {}
    // A class expression inherits the variable's name, so the name is cleared
    // explicitly to reproduce a genuinely anonymous provider class.
    Object.defineProperty(anonymous, 'name', { value: '' })
    Reflect.defineMetadata(WANTED_KEY, true, anonymous)
    const nodes: ProviderNode[] = [{ metatype: anonymous, instance: {}, name: 'ANON_TOKEN' }]

    const marked = findMarkedProviders(scannerOver(nodes), reflector, WANTED_KEY)

    expect(marked.map((entry) => entry.label)).toEqual(['ANON_TOKEN'])
  })

  /**
   * An empty graph finds nothing. Edge case.
   *
   * The scan must degrade to "nothing marked", not to an error, so a feature can
   * be enabled in an application that declares none.
   */
  it('finds nothing in an application with no marked providers', () => {
    expect(findMarkedProviders(scannerOver([]), reflector, WANTED_KEY)).toEqual([])
  })
})
