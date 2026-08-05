/**
 * @fileoverview Shared discrimination for optional-peer loading. Every optional
 * peer in this package is reached through a dynamic `import()` inside its own
 * loader, and every loader has to answer the same question about a failure:
 * is the package absent, or did it fail for its own reasons? The answer is the
 * difference between a legible "install this" boot error and a misleading one
 * that hides a real defect, so it is decided in one place rather than repeated
 * per loader.
 * @layer Utility
 */

/**
 * True when a dynamic-import failure means the module could not be resolved,
 * the only case that indicates an optional peer is absent. Any other failure
 * (a syntax or runtime error inside the peer, a broken transitive dependency)
 * is left unwrapped by callers so operators see the real cause instead of a
 * misleading "not installed".
 *
 * @param cause - The error thrown by the dynamic import.
 * @returns `true` for a module-not-found error, `false` otherwise.
 */
export function isMissingModuleError(cause: unknown): boolean {
  const code = (cause as { code?: string }).code
  return code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND'
}

/**
 * Compose the guidance shown when a feature is enabled but its optional peer is
 * absent. Naming the option, the package and the exact install command makes the
 * failure self-explanatory at boot rather than a cryptic module-resolution error
 * at the first request.
 *
 * @param option - The option that turned the feature on, for example `metrics.enabled`.
 * @param peer - The npm package name of the absent peer.
 * @returns The message a loader throws when the peer cannot be resolved.
 */
export function missingPeerMessage(option: string, peer: string): string {
  return `${option} is true but the optional peer ${peer} is not installed. Run: pnpm add ${peer}`
}
