/**
 * @fileoverview The one place that decides whether the process is running in
 * production. Features that must never exist outside development — today, the
 * OpenAPI document and its UI — read this and nothing else, so the rule has a
 * single definition, a single test surface, and cannot drift between the layer
 * that resolves options and the layer that mounts routes.
 *
 * The predicate is deliberately fail-closed: only an environment that positively
 * declares itself non-production is treated as such. An unset, empty, or
 * unrecognized value is production. A permissive default would mean that the one
 * deployment nobody remembered to configure is the one that publishes its
 * internal API surface.
 * @layer Utility
 */

/**
 * The only values that count as non-production. Kept exhaustive and explicit
 * rather than "anything that is not `production`", because the risk is
 * asymmetric: mislabeling development as production hides documentation from a
 * developer, while mislabeling production as development publishes it.
 */
const NON_PRODUCTION_ENVIRONMENTS: ReadonlySet<string> = new Set(['development', 'test'])

/**
 * Decide whether the current runtime is production.
 *
 * Comparison is case-insensitive and ignores surrounding whitespace, so a value
 * carried through a shell or a container manifest is not rejected on formatting
 * alone. Everything else — including an unset or empty variable — is production.
 *
 * @param value - The environment name to classify. Defaults to `NODE_ENV`, read
 *   at call time rather than at module load so a process that configures its
 *   environment during bootstrap is still classified correctly.
 * @returns `true` when the runtime must be treated as production.
 */
export function isProductionRuntime(value: string | undefined = process.env['NODE_ENV']): boolean {
  if (value === undefined) {
    return true
  }
  return !NON_PRODUCTION_ENVIRONMENTS.has(value.trim().toLowerCase())
}
