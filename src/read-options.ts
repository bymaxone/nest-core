/**
 * @fileoverview Taking the options a host passes once, as an own copy, where a throw from the host can
 * be attributed.
 * @layer Configuration
 */
import { bootError } from './boot-error'
import { ownCopy } from './own-copy'

/**
 * The options a host passed, as an own copy, taken once: a getter that throws, or a proxy that throws or is
 * revoked, anywhere in them is refused here, with what was thrown as the cause and no host text.
 *
 * @param given - The options.
 * @returns The copy, or `given` itself when it is not a plain object or a list.
 * @throws Error When reading the options throws.
 */
export function readOptions<T>(given: T): T {
  try {
    return ownCopy(given) as T
  } catch (cause) {
    throw bootError('the options could not be read', {}, { cause })
  }
}
