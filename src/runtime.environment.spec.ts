/**
 * Unit tests for the production-runtime predicate.
 *
 * Layer: unit.
 * Goal: prove the classification is fail-closed — only an environment that
 * positively declares itself `development` or `test` is non-production, and
 * everything else, including an unset or unrecognized value, is production —
 * and that composing the two sources never lets a declared value overrule a
 * process that named its own environment.
 * Mocks: none; the default-argument path reads `process.env`, which is set and
 * restored per test.
 */
import { isProductionRuntime, runtimeEnvironmentName } from './runtime.environment'

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

describe('runtimeEnvironmentName', () => {
  const originalNodeEnv = process.env['NODE_ENV']

  afterEach(() => {
    // Restored explicitly: `restoreMocks` does not reach process.env.
    process.env['NODE_ENV'] = originalNodeEnv
  })

  /**
   * The process wins whenever it says anything.
   *
   * The property the whole composition exists to preserve: no configured value
   * may make a runtime that identified itself as production serve a document.
   * If this reverses, a snapshot a consumer bound decides the answer in a
   * deployment that already answered.
   */
  it('ignores the declared value when NODE_ENV names an environment', () => {
    process.env['NODE_ENV'] = 'production'

    expect(runtimeEnvironmentName('development')).toBe('production')
    expect(isProductionRuntime(runtimeEnvironmentName('development'))).toBe(true)
  })

  /**
   * The process wins even when both agree it is not production.
   *
   * Asserted separately from the case above so the rule is pinned as "the
   * process is read", not "production is sticky" — a composition that returned
   * the declared value here would pass a production-only test and still be
   * wrong.
   */
  it('returns NODE_ENV rather than the declaration when both are set', () => {
    process.env['NODE_ENV'] = 'test'

    expect(runtimeEnvironmentName('development')).toBe('test')
  })

  /**
   * An unset NODE_ENV is where the declaration is consulted.
   *
   * The case the option exists for: an application that validates its own
   * environment variable and never sets `NODE_ENV` was previously classified
   * as production, because absence was the only evidence available.
   */
  it('uses the declared value when NODE_ENV is not set', () => {
    delete process.env['NODE_ENV']

    expect(runtimeEnvironmentName('development')).toBe('development')
    expect(isProductionRuntime(runtimeEnvironmentName('development'))).toBe(false)
  })

  /**
   * A variable that exists without declaring anything is the same as absent.
   *
   * `NODE_ENV=` in a shell exports an empty string, and whitespace survives a
   * container manifest. Neither names an environment, so neither should be
   * allowed to suppress a declaration that does.
   */
  it.each([[''], ['   '], ['\t']])('uses the declared value when NODE_ENV is %j', (blank) => {
    process.env['NODE_ENV'] = blank

    expect(runtimeEnvironmentName('development')).toBe('development')
  })

  /**
   * Neither source naming an environment keeps the fail-closed default.
   *
   * Absence of evidence still resolves to production; the option adds a way to
   * answer, not a permissive default for applications that answer nothing.
   */
  it('names no environment when neither source does', () => {
    delete process.env['NODE_ENV']

    expect(runtimeEnvironmentName()).toBeUndefined()
    expect(isProductionRuntime(runtimeEnvironmentName())).toBe(true)
  })

  /**
   * A blank NODE_ENV with no declaration is still production.
   *
   * The two "says nothing" shapes compose: an empty variable falls through to
   * an absent declaration, and the result must not become non-production by
   * passing through the fallback.
   */
  it('reports production when NODE_ENV is blank and nothing is declared', () => {
    process.env['NODE_ENV'] = ''

    expect(runtimeEnvironmentName()).toBeUndefined()
    expect(isProductionRuntime(runtimeEnvironmentName())).toBe(true)
  })
})
