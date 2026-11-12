/**
 * @fileoverview Lazy `helmet` loader. The peer is optional: an application that never calls
 * `applyHttpFloors` never installs it and never loads it. Every runtime touch of `helmet` stays
 * behind the dynamic `import()` below.
 * @layer Provider
 */
import { isMissingModuleError } from '../optional-peer'

/** The factory `helmet` exports: security-header options in, a middleware out. */
export type HelmetFactory = (
  options?: object
) => (req: never, res: never, next: (error?: unknown) => void) => void

/** Guidance shown when the helper runs and the optional peer is absent. */
const MISSING_PEER_MESSAGE =
  'applyHttpFloors needs the optional peer helmet, which is not installed. Run: pnpm add helmet'

/**
 * Load `helmet` through a dynamic import.
 *
 * @returns The `helmet` middleware factory.
 * @throws Error When `helmet` is not installed; any other failure propagates unchanged.
 */
export async function loadHelmet(): Promise<HelmetFactory> {
  try {
    const loaded = (await import('helmet')) as unknown as { default: HelmetFactory }
    return loaded.default
  } catch (cause) {
    if (isMissingModuleError(cause)) {
      throw new Error(MISSING_PEER_MESSAGE, { cause })
    }
    throw cause
  }
}
