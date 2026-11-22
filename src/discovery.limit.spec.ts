/**
 * Unit tests for the limit on the providers that carry one marker.
 *
 * Layer: unit.
 * Goal: at most 1000 providers may carry the same marker (a health indicator, a metrics contributor),
 * and one more is refused at boot, before the scan hands them on.
 * Mocks: a hand-built provider graph and reader.
 */
import type { Reflector } from '@nestjs/core'

import { findMarkedProviders } from './discovery'
import type { ProviderScanner } from './discovery'

/** A graph of `size` marked providers, each with a class of its own. */
function graph(size: number): ProviderScanner {
  return {
    getProviders: () =>
      Array.from({ length: size }, (_, index) => ({
        metatype: class {},
        instance: {},
        name: `P${index}`
      }))
  }
}

const READER = { get: () => true } as unknown as Reflector

describe('the providers that carry one marker', () => {
  it('are taken up to 1000 and refused past it', () => {
    expect(findMarkedProviders(graph(1000), READER, 'marker')).toHaveLength(1000)
    expect(() => findMarkedProviders(graph(1001), READER, 'marker')).toThrow(
      '[BymaxCoreModule] more than 1000 providers carry the same marker'
    )
  })

  it('count only the marked ones, so many unmarked providers are not refused', () => {
    const unmarked = { get: () => false } as unknown as Reflector

    expect(findMarkedProviders(graph(5000), unmarked, 'marker')).toHaveLength(0)
  })
})
