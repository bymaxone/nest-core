/**
 * Unit tests for the dependency-injection token set.
 *
 * Layer: unit.
 * Goal: prove every DI token is a distinct `Symbol` carrying its documented
 * description, protecting the explicit-injection contract from accidental
 * string tokens or duplicate identities.
 * Mocks: none.
 */
import {
  BYMAX_CORE_OPTIONS,
  BYMAX_CORRELATION_PROVIDER,
  BYMAX_HEALTH_INDICATORS,
  BYMAX_METRICS_REGISTRY,
  BYMAX_TIMING_SINK
} from './core.tokens'

describe('core DI tokens', () => {
  const tokens: ReadonlyArray<readonly [symbol, string]> = [
    [BYMAX_CORE_OPTIONS, 'BYMAX_CORE_OPTIONS'],
    [BYMAX_CORRELATION_PROVIDER, 'BYMAX_CORRELATION_PROVIDER'],
    [BYMAX_TIMING_SINK, 'BYMAX_TIMING_SINK'],
    [BYMAX_HEALTH_INDICATORS, 'BYMAX_HEALTH_INDICATORS'],
    [BYMAX_METRICS_REGISTRY, 'BYMAX_METRICS_REGISTRY']
  ]

  it.each(tokens)('exposes %s as a Symbol with its own description', (token, description) => {
    // A Symbol token cannot collide with a consumer's string token and keeps
    // injection sites explicit and self-documenting.
    expect(typeof token).toBe('symbol')
    expect(token.toString()).toBe(`Symbol(${description})`)
  })

  it('mints a unique identity for every token', () => {
    // Distinct identities guarantee the container never conflates two contracts.
    const identities = new Set(tokens.map(([token]) => token))
    expect(identities.size).toBe(tokens.length)
  })
})
