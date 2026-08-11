/**
 * Unit tests for the dependency-injection token set.
 *
 * Layer: unit.
 * Goal: prove every DI token is a distinct `Symbol` carrying its documented
 * global-registry key, protecting the explicit-injection contract from
 * accidental string tokens or duplicate identities — and protecting the
 * cross-bundle identity that the per-subpath build depends on.
 * Mocks: none.
 */
import * as allTokens from './core.tokens'
import {
  BYMAX_CORE_OPTIONS,
  BYMAX_CORRELATION_PROVIDER,
  BYMAX_HEALTH_INDICATORS,
  BYMAX_METRICS_REGISTRY,
  BYMAX_TIMING_SINK,
  BYMAX_TRACE_CONTEXT
} from './core.tokens'

describe('core DI tokens', () => {
  const tokens: ReadonlyArray<readonly [symbol, string]> = [
    [BYMAX_CORE_OPTIONS, '@bymax-one/nest-core:core-options'],
    [BYMAX_CORRELATION_PROVIDER, '@bymax-one/nest-core:correlation-provider'],
    [BYMAX_TIMING_SINK, '@bymax-one/nest-core:timing-sink'],
    [BYMAX_HEALTH_INDICATORS, '@bymax-one/nest-core:health-indicators'],
    [BYMAX_METRICS_REGISTRY, '@bymax-one/nest-core:metrics-registry'],
    [BYMAX_TRACE_CONTEXT, '@bymax-one/nest-core:trace-context']
  ]

  it.each(tokens)('exposes %s under its own registry key', (token, key) => {
    // A Symbol token cannot collide with a consumer's string token and keeps
    // injection sites explicit and self-documenting.
    expect(typeof token).toBe('symbol')
    expect(token.description).toBe(key)
  })

  it.each(tokens)('resolves %s through the global symbol registry', (token, key) => {
    // The identity check that the per-subpath bundles depend on: this file is
    // inlined into every published bundle, so a `Symbol()` token would mint a
    // separate identity per bundle and a provider registered from the package
    // root would be invisible to a subpath injecting the same import. Only a
    // registry-backed symbol satisfies this — `Symbol(k) !== Symbol.for(k)` — so
    // the assertion fails the moment a token regresses to `Symbol()`.
    expect(Symbol.for(key)).toBe(token)
  })

  it('namespaces every registry key with the package name', () => {
    // The global registry is process-wide and shared with every other library
    // in the application; the npm package name is the one prefix guaranteed not
    // to collide with theirs.
    for (const [, key] of tokens) {
      expect(key.startsWith('@bymax-one/nest-core:')).toBe(true)
    }
  })

  it('holds the registry invariant for every token this module exports', () => {
    // Swept from the module namespace rather than the table above, so the
    // registry invariant reaches a token added later even before anyone lists it
    // — that omission is how the 1.3.0 defect would come back, one token at a
    // time. The length check then forces the table to be updated too, since the
    // table is what pins the exact keys, and the keys are contract.
    const exported = Object.values(allTokens).filter((value) => typeof value === 'symbol')

    expect(exported).toHaveLength(tokens.length)
    for (const token of exported) {
      // `String` rather than a cast: a token whose description is somehow
      // undefined stringifies to "undefined", whose registry entry is not this
      // token, so the assertion below still fails — and it fails without the
      // type system being told to look away.
      expect(typeof token.description).toBe('string')
      expect(Symbol.for(String(token.description))).toBe(token)
    }
  })

  it('mints a unique identity for every token', () => {
    // Distinct identities guarantee the container never conflates two contracts.
    const identities = new Set(tokens.map(([token]) => token))
    expect(identities.size).toBe(tokens.length)
  })
})
