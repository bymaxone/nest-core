/**
 * Unit tests for module-options resolution and immutability.
 *
 * Layer: unit.
 * Goal: prove `normalizeCoreOptions` applies the documented defaults, merges
 * partial input per feature without dropping siblings, keeps unset optional
 * fields absent, and deep-freezes the result so configuration cannot drift at
 * runtime.
 * Mocks: none (pure function).
 */
import { DEFAULT_CORE_OPTIONS, normalizeCoreOptions } from './core.options'

describe('normalizeCoreOptions', () => {
  /**
   * Empty-input defaults.
   *
   * With no consumer input the resolver must yield the exact documented default
   * matrix; this snapshot is the contract every feature relies on.
   */
  it('applies the documented defaults for empty input', () => {
    expect(normalizeCoreOptions()).toEqual({
      envelope: { enabled: true, exposeInternals: false },
      timing: { enabled: true },
      health: { enabled: true, path: 'health', indicatorTimeoutMs: 5000 },
      metrics: { enabled: false, path: 'metrics', collectDefaultMetrics: true, defaultLabels: {} }
    })
  })

  /**
   * Unset optional field stays absent.
   *
   * `slowRequestThresholdMs` has no default, so it must not appear as a key on
   * the resolved object rather than being present as `undefined`.
   */
  it('omits slowRequestThresholdMs when the consumer does not set it', () => {
    expect('slowRequestThresholdMs' in normalizeCoreOptions().timing).toBe(false)
  })

  /**
   * Per-feature merge preserves siblings.
   *
   * Overriding one field of one feature must keep that feature's other defaults
   * and must not touch the other features' defaults.
   */
  it('merges a partial feature block without dropping sibling defaults', () => {
    const resolved = normalizeCoreOptions({ health: { path: 'status' } })

    expect(resolved.health).toEqual({ enabled: true, path: 'status', indicatorTimeoutMs: 5000 })
    expect(resolved.metrics.enabled).toBe(false)
    expect(resolved.envelope.enabled).toBe(true)
  })

  /**
   * Every overridable field is honored.
   *
   * A fully-specified input must be reflected verbatim, proving each default is
   * actually overridable (guards against a hard-coded value ignoring input).
   */
  it('honors every explicitly provided field', () => {
    const resolved = normalizeCoreOptions({
      envelope: { enabled: false, exposeInternals: true },
      timing: { enabled: false, slowRequestThresholdMs: 1000 },
      health: { enabled: false, path: 'hz', indicatorTimeoutMs: 250 },
      metrics: {
        enabled: true,
        path: 'prom',
        collectDefaultMetrics: false,
        defaultLabels: { app: 'api' }
      }
    })

    expect(resolved).toEqual({
      envelope: { enabled: false, exposeInternals: true },
      timing: { enabled: false, slowRequestThresholdMs: 1000 },
      health: { enabled: false, path: 'hz', indicatorTimeoutMs: 250 },
      metrics: {
        enabled: true,
        path: 'prom',
        collectDefaultMetrics: false,
        defaultLabels: { app: 'api' }
      }
    })
  })

  /**
   * Consumer-owned label object is not captured.
   *
   * The resolver must clone `defaultLabels` so deep-freezing the snapshot never
   * freezes the object the consumer passed in.
   */
  it('clones defaultLabels instead of freezing the consumer object', () => {
    const labels = { app: 'api' }
    const resolved = normalizeCoreOptions({ metrics: { defaultLabels: labels } })

    expect(resolved.metrics.defaultLabels).not.toBe(labels)
    expect(Object.isFrozen(labels)).toBe(false)
  })

  /**
   * Deep immutability.
   *
   * The snapshot and every nested block must be frozen so no consumer can mutate
   * live configuration after the module is built.
   */
  it('deep-freezes the resolved snapshot and its nested blocks', () => {
    const resolved = normalizeCoreOptions({ metrics: { defaultLabels: { app: 'api' } } })

    expect(Object.isFrozen(resolved)).toBe(true)
    expect(Object.isFrozen(resolved.envelope)).toBe(true)
    expect(Object.isFrozen(resolved.timing)).toBe(true)
    expect(Object.isFrozen(resolved.health)).toBe(true)
    expect(Object.isFrozen(resolved.metrics)).toBe(true)
    expect(Object.isFrozen(resolved.metrics.defaultLabels)).toBe(true)
  })

  /**
   * Mutation is rejected in strict mode.
   *
   * A frozen snapshot must throw on write; specs run as ES modules (strict), so
   * the assignment is expected to throw rather than silently no-op.
   */
  it('throws when a nested field is mutated', () => {
    const resolved = normalizeCoreOptions()

    expect(() => {
      ;(resolved.health as { path: string }).path = 'hacked'
    }).toThrow()
  })

  /**
   * DEFAULT_CORE_OPTIONS mirrors the empty-input resolution.
   *
   * The exported constant must equal a fresh default resolution and be frozen,
   * so consumers can rely on it as the canonical default snapshot.
   */
  it('exposes DEFAULT_CORE_OPTIONS as the frozen default resolution', () => {
    expect(DEFAULT_CORE_OPTIONS).toEqual(normalizeCoreOptions())
    expect(Object.isFrozen(DEFAULT_CORE_OPTIONS)).toBe(true)
  })
})
