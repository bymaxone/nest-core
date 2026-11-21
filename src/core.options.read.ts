/**
 * @fileoverview Taking the consumer options once, as an own copy, where a throw from the host can
 * be attributed.
 * @layer Configuration
 */
import { bootError } from './boot-error'
import type { BymaxCoreModuleOptions } from './core.options'
import { asHostError } from './host-error'
import { ownCopy } from './own-copy'

/**
 * The consumer options as an own copy, taken once: a getter that throws, or a proxy that throws or is
 * revoked, anywhere in them is refused here, with the host error as the cause and no host text.
 *
 * @param given - The consumer options.
 * @returns The copy, or `given` itself when it is not an object or list.
 * @throws Error When reading the options throws.
 */
export function readOptions(
  given: BymaxCoreModuleOptions | undefined
): BymaxCoreModuleOptions | undefined {
  try {
    return ownCopy(given) as BymaxCoreModuleOptions | undefined
  } catch (cause) {
    throw bootError('the options could not be read', {}, { cause: asHostError(cause) })
  }
}
