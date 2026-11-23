/**
 * Unit tests for the one decision on whether a host's value is a block of options.
 *
 * Layer: unit.
 * Goal: a value whose `Symbol.toStringTag` answers differently on a second read is judged once, so a
 * block the options read refused as not plain is never accepted later by a second read of its tag, and
 * none of its own getters runs live.
 * Mocks: none.
 */
import { normalizeCoreOptions } from './core.options'

/** An object whose tag says `first` on the first read and `Object` after, counting its `enabled` getter. */
function flipping(first: string): { value: object; live: () => number; tagReads: () => number } {
  let reads = 0
  let live = 0
  const value = Object.defineProperty(
    {
      get enabled(): boolean {
        live += 1
        return true
      }
    },
    Symbol.toStringTag,
    { get: () => ((reads += 1) === 1 ? first : 'Object') }
  )
  return { value, live: () => live, tagReads: () => reads }
}

describe('a value whose tag changes between two reads', () => {
  it.each(['envelope', 'timing', 'health', 'metrics', 'telemetry', 'openapi'])(
    'is refused as the %s block and none of its getters runs live',
    (block) => {
      const given = flipping('Array')

      expect(() => normalizeCoreOptions({ [block]: given.value } as never)).toThrow()
      expect(given.live()).toBe(0)
      expect(given.tagReads()).toBe(1)
    }
  )

  it('is refused as the whole options object, with none of its getters run live', () => {
    const given = flipping('Map')

    expect(() => normalizeCoreOptions(given.value as never)).toThrow()
    expect(given.live()).toBe(0)
  })
})
