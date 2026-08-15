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

/**
 * The environment name to classify, composed from the two places it can come
 * from: the process, and what the application declared.
 *
 * `NODE_ENV` wins whenever it says anything at all, and no configured value can
 * override it. That is the property worth stating plainly, because it is what
 * keeps a declaration from serving an internal API surface in a deployment the
 * runtime already identified as production.
 *
 * The declared value is consulted only where the runtime declares *nothing* —
 * unset, or set to whitespace, which is a variable that exists without saying
 * anything. Treating that case as production was a guess, and a costly one for
 * the application that validates its own `APP_ENV` and never sets `NODE_ENV`:
 * it earned a refusal it never asked for, with no way to answer back. Replacing
 * a guess with a declaration is not the same as allowing an override.
 *
 * Absent both, the fail-closed default is unchanged: absence of evidence still
 * resolves to production.
 *
 * @param declared - The environment the application configured, if any.
 * @returns The name to classify, or `undefined` when neither source names one.
 */
export function runtimeEnvironmentName(declared?: string): string | undefined {
  const fromProcess = process.env['NODE_ENV']
  // Read as "did the process say anything", not "is the variable present": an
  // exported-but-empty variable is the shape a shell produces for `NODE_ENV=`,
  // and it declares no more than an unset one does.
  if (fromProcess !== undefined && fromProcess.trim() !== '') {
    return fromProcess
  }
  return declared
}
