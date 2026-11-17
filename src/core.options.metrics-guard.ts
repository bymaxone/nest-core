/**
 * @fileoverview The production guard on the metrics endpoint: an open scrape route is refused at
 * boot unless the deployment states that the edge protects it.
 * @layer Configuration
 */
import { isProductionRuntime, runtimeEnvironmentName } from './runtime.environment'

/**
 * Refuse an open metrics endpoint in production unless the deployment says the edge protects it.
 *
 * @param raw - The consumer's `enabled` and `edgeProtected` settings.
 * @param authToken - The resolved scrape token, if any.
 * @param declaredEnvironment - The environment the application declared, used only where
 *   `NODE_ENV` declares nothing.
 * @throws Error When metrics are enabled in production with neither a token nor `edgeProtected`.
 */
export function assertMetricsProtected(
  raw: { readonly enabled?: boolean; readonly edgeProtected?: boolean },
  authToken: string | undefined,
  declaredEnvironment?: string
): void {
  const open = raw.enabled === true && authToken === undefined && raw.edgeProtected !== true
  if (open && isProductionRuntime(runtimeEnvironmentName(declaredEnvironment))) {
    throw new Error(
      '[BymaxCoreModule] "metrics.enabled" is on in production with no "metrics.authToken", so ' +
        'any caller can read the route inventory and process internals. Set "metrics.authToken", ' +
        'or set "metrics.edgeProtected: true" to state that the route is protected at the edge.'
    )
  }
}
