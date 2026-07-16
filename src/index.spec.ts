/**
 * Unit tests for the package root barrel.
 *
 * Layer: unit.
 * Goal: prove the public surface is exported and stable, and that internal
 * registration helpers and no-op default classes do not leak.
 * Mocks: none.
 */
import * as publicApi from './index'

describe('package root barrel', () => {
  /**
   * Public surface presence.
   *
   * Consumers depend on the module, tokens, error codes, and helper being
   * exported from the root subpath; a missing name is a breaking API change.
   */
  it('exports the module, tokens, error codes, and codeForStatus', () => {
    expect(publicApi.BymaxCoreModule).toBeDefined()
    expect(typeof publicApi.BYMAX_CORE_OPTIONS).toBe('symbol')
    expect(typeof publicApi.BYMAX_METRICS_REGISTRY).toBe('symbol')
    expect(publicApi.BYMAX_NOT_FOUND).toBe('BYMAX_NOT_FOUND')
    expect(publicApi.codeForStatus(404)).toBe('BYMAX_NOT_FOUND')
  })

  /**
   * Envelope surface presence.
   *
   * The exception filter and envelope builder are part of the public contract:
   * consumers subclass the filter and reuse the builder, so both must export.
   */
  it('exports the exception filter and envelope builder', () => {
    expect(publicApi.BymaxExceptionFilter).toBeDefined()
    expect(typeof publicApi.buildErrorEnvelope).toBe('function')
  })

  /**
   * Internal surface stays hidden.
   *
   * The barrel is selective: registration helpers and no-op default classes are
   * implementation details and must not be re-exported.
   */
  it('does not leak internal helpers or default classes', () => {
    const names = Object.keys(publicApi)

    expect(names).not.toContain('augmentModule')
    expect(names).not.toContain('buildDefaultProviders')
    expect(names).not.toContain('NoopTimingSink')
    expect(names).not.toContain('PassThroughExceptionFilter')
    expect(names).not.toContain('selectAsyncExceptionFilter')
  })

  /**
   * Every re-export is a live binding.
   *
   * Reading each exported member proves the barrel's re-export bindings resolve
   * and that no exported name is a dangling reference.
   */
  it('resolves every re-exported member', () => {
    for (const value of Object.values(publicApi)) {
      expect(value).toBeDefined()
    }
  })
})
