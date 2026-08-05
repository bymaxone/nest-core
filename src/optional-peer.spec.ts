/**
 * Unit tests for the shared optional-peer helpers.
 *
 * Layer: unit.
 * Goal: prove a module-resolution failure is recognized under both of Node's
 * codes and nothing else, so a real defect inside a peer is never misreported
 * as the peer being uninstalled; and prove the guidance message names the
 * option, the package, and the exact install command.
 * Mocks: none (pure functions).
 */
import { isMissingModuleError, missingPeerMessage } from './optional-peer'

describe('isMissingModuleError', () => {
  /**
   * Both resolution-failure codes.
   *
   * Node reports an unresolvable module as `ERR_MODULE_NOT_FOUND` from the ESM
   * loader and `MODULE_NOT_FOUND` from CommonJS; this package is published in
   * both formats, so both must be recognized.
   */
  it.each(['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'])(
    'recognizes the resolution failure code %s',
    (code) => {
      const error: NodeJS.ErrnoException = new Error('Cannot find module')
      error.code = code

      expect(isMissingModuleError(error)).toBe(true)
    }
  )

  /**
   * A different error code is not a missing module.
   *
   * A peer that fails for its own reasons must propagate unchanged, so
   * operators see the real cause instead of a misleading "not installed".
   */
  it('rejects an unrelated error code', () => {
    const error: NodeJS.ErrnoException = new Error('permission denied')
    error.code = 'EACCES'

    expect(isMissingModuleError(error)).toBe(false)
  })

  /**
   * An error with no code at all. Edge case.
   *
   * A plain `Error` thrown from inside a peer's module body carries no code and
   * must not be mistaken for a resolution failure.
   */
  it('rejects an error carrying no code', () => {
    expect(isMissingModuleError(new Error('boom'))).toBe(false)
  })

  /**
   * A non-error rejection value. Edge case: thrown string.
   *
   * Nothing guarantees a thrown value is an `Error`; reading the code off a
   * string must return false rather than throw, because this runs inside a
   * catch block whose own failure would mask the original problem.
   */
  it('rejects a thrown string without throwing', () => {
    expect(isMissingModuleError('not an error')).toBe(false)
  })
})

describe('missingPeerMessage', () => {
  /**
   * The message is self-explanatory at boot.
   *
   * It must name the option that turned the feature on, the package that is
   * absent, and a command that fixes it — the three things an operator needs
   * without reading this package's source.
   */
  it('names the option, the package, and the install command', () => {
    const message = missingPeerMessage('openapi.enabled', '@nestjs/swagger')

    expect(message).toBe(
      'openapi.enabled is true but the optional peer @nestjs/swagger is not installed. Run: pnpm add @nestjs/swagger'
    )
  })
})
