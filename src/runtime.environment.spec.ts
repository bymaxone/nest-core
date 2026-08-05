/**
 * Unit tests for the production-runtime predicate.
 *
 * Layer: unit.
 * Goal: prove the classification is fail-closed — only an environment that
 * positively declares itself `development` or `test` is non-production, and
 * everything else, including an unset or unrecognized value, is production.
 * Mocks: none; the default-argument path reads `process.env`, which is set and
 * restored per test.
 */
import { isProductionRuntime } from './runtime.environment'

describe('isProductionRuntime', () => {
  const originalNodeEnv = process.env['NODE_ENV']

  afterEach(() => {
    // Restored explicitly: `restoreMocks` does not reach process.env.
    process.env['NODE_ENV'] = originalNodeEnv
  })

  /**
   * The two recognized development-time environments.
   *
   * These are the only values that unlock development-only features, so both
   * must classify as non-production.
   */
  it.each(['development', 'test'])('classifies "%s" as non-production', (value) => {
    expect(isProductionRuntime(value)).toBe(false)
  })

  /**
   * Formatting is not a rejection reason.
   *
   * A value carried through a shell or a container manifest may arrive padded
   * or capitalized; treating it as unknown would hide documentation from a
   * developer for a cosmetic difference.
   */
  it.each(['  development  ', 'Development', 'TEST'])(
    'normalizes case and whitespace in "%s"',
    (value) => {
      expect(isProductionRuntime(value)).toBe(false)
    }
  )

  /**
   * The declared production environment.
   *
   * The obvious case, asserted so a future refactor of the set cannot invert
   * the predicate unnoticed.
   */
  it('classifies "production" as production', () => {
    expect(isProductionRuntime('production')).toBe(true)
  })

  /**
   * Unknown environments are production. Fail-closed boundary.
   *
   * `staging` is a real deployment that is not this package's development
   * environment; publishing an internal API surface there because the name was
   * unrecognized is exactly the failure this predicate exists to prevent.
   */
  it.each(['staging', 'qa', '', '   '])(
    'classifies the unknown value "%s" as production',
    (value) => {
      expect(isProductionRuntime(value)).toBe(true)
    }
  )

  /**
   * The default argument reads the live environment.
   *
   * Reading at call time rather than at module load is what lets a process that
   * configures its environment during bootstrap still be classified correctly.
   */
  it('falls back to NODE_ENV read at call time', () => {
    process.env['NODE_ENV'] = 'development'
    expect(isProductionRuntime()).toBe(false)

    process.env['NODE_ENV'] = 'production'
    expect(isProductionRuntime()).toBe(true)
  })

  /**
   * The default argument with no NODE_ENV set. Edge case: deleted variable.
   *
   * Covers the interaction between the default argument and the undefined
   * branch, the exact shape a bare `node dist/main.js` produces.
   */
  it('reports production when NODE_ENV is not set at all', () => {
    delete process.env['NODE_ENV']

    expect(isProductionRuntime()).toBe(true)
  })
})
