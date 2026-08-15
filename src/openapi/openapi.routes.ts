/**
 * @fileoverview Recognizing the routes this package registered, inside a
 * document it did not write.
 *
 * Two features need the same answer to "is this operation ours?" and would
 * otherwise each derive it: the merge removes a disabled feature's routes and
 * documents the security of the ones that remain, and the unsecured-operation
 * report must neither name our routes nor count them as evidence that a
 * consumer described a security posture. One derivation, one place to correct
 * it, and the recognition rules stay testable on their own.
 *
 * Nothing here reads a document's contents. It answers about paths, from the
 * resolved options and the prefixes the application serves under — which is
 * what keeps it free of any assumption about the document's shape.
 * @layer Service
 */
import type { ResolvedCoreOptions } from '../core.options'
// Imported from the leaf module rather than from `core.options`, which
// re-exports them: this is a separate bundle, and reaching into the resolver
// for two strings inlines the whole of it here. See `route-defaults.ts`.
import { DEFAULT_HEALTH_PATH, DEFAULT_METRICS_PATH } from '../route-defaults'

/**
 * Strip the slashes around a configured route segment, so a consumer who wrote
 * `'/health'` and one who wrote `'health'` produce the same match.
 *
 * @param segment - The configured route.
 * @returns The segment without leading or trailing slashes.
 */
function trimSlashes(segment: string): string {
  // Split-and-rejoin rather than a pair of anchored regexes: it drops empty
  // segments wherever they occur, so a doubled slash inside the path collapses
  // too, and every part of the transformation is observable from a test — an
  // anchored `/^\/+/` cannot be distinguished from `/^\/*/` by any input.
  return segment
    .split('/')
    .filter((part) => part !== '')
    .join('/')
}

/**
 * The path `@nestjs/swagger` documents for a route this package registered.
 *
 * The peer writes paths *including* the application's global prefix, so an
 * application calling `setGlobalPrefix('api/v2')` documents this package's
 * health probe as `/api/v2/health/live`. The prefix is read from the running
 * application and handed to this module as data, which is what lets the
 * comparison be exact.
 *
 * Inferring the prefix from the document instead — "the segment shared by every
 * path" — is the tempting shortcut and it is wrong: an application whose routes
 * all sit under `/tenants/{id}` would have that inferred as its prefix, and a
 * consumer's own `/tenants/{id}/health/live` would be deleted from their
 * document as though this package owned it. Guessing loses consumer content to
 * fix ours. Asking does not.
 *
 * @param prefix - The application's global prefix, without surrounding slashes.
 * @param suffix - The route this package registered, without leading slash.
 * @returns The path the document is expected to carry.
 */
function routePath(prefix: string, suffix: string): string {
  return prefix === '' ? `/${suffix}` : `/${prefix}/${suffix}`
}

/**
 * The health routes this package may have registered.
 *
 * Both the configured path and the default are considered, because the two
 * registration paths differ: `forRoot` mounts the controller at the configured
 * path, while `forRootAsync` must fix route metadata before the async options
 * resolve and therefore always mounts at the default. Only one of the two ever
 * appears in a given document; matching both means this module does not need to
 * know which registration path the consumer used.
 *
 * @param options - The resolved options.
 * @returns The route suffixes, without leading slashes.
 */
function healthRoutes(options: ResolvedCoreOptions): readonly string[] {
  const bases = new Set([trimSlashes(options.health.path), DEFAULT_HEALTH_PATH])
  return [...bases].flatMap((base) => [`${base}/live`, `${base}/ready`])
}

/**
 * The metrics routes this package may have registered. See {@link healthRoutes}
 * for why both the configured and the default path are considered.
 *
 * @param options - The resolved options.
 * @returns The route suffixes, without leading slashes.
 */
function metricsRoutes(options: ResolvedCoreOptions): readonly string[] {
  return [...new Set([trimSlashes(options.metrics.path), DEFAULT_METRICS_PATH])]
}

/** Recognizes the routes this package registered, in one document. */
export interface OwnRouteIndex {
  /** Whether the path is one of this package's health probes. */
  isHealth(path: string): boolean
  /** Whether the path is this package's scrape endpoint. */
  isMetrics(path: string): boolean
}

/**
 * Index this package's own routes against one document.
 *
 * Built once and passed down rather than recomputed per path: the route lists
 * and the prefix test both depend only on the document and the options, and
 * rebuilding them inside a loop over every operation is work proportional to
 * the square of the API's size for an answer that never changes.
 *
 * @param options - The resolved options.
 * @param prefixes - Every path prefix the application can serve these routes
 *   under: its global prefix combined with each URI version segment, or a
 *   single empty string when it uses neither.
 * @returns The recognizer for this document.
 */
export function indexOwnRoutes(
  options: ResolvedCoreOptions,
  prefixes: readonly string[]
): OwnRouteIndex {
  const normalized = prefixes.map(trimSlashes)
  const expand = (suffixes: readonly string[]): readonly string[] =>
    normalized.flatMap((prefix) => suffixes.map((suffix) => routePath(prefix, suffix)))
  const health = expand(healthRoutes(options))
  const metrics = expand(metricsRoutes(options))
  return {
    isHealth: (path) => health.includes(path),
    isMetrics: (path) => metrics.includes(path)
  }
}

/**
 * Whether a path item's operation is one this package registered.
 *
 * The controllers this package registers expose GET and nothing else, so a
 * consumer who mounts another method under the same path owns that operation —
 * the same cut the merge makes when it decides whether it may state a security
 * requirement for one.
 *
 * @param path - The documented path.
 * @param method - The operation's lowercase method key.
 * @param routes - The recognizer for this package's own routes.
 * @returns Whether this package owns the operation.
 */
export function isOwnRoute(path: string, method: string, routes: OwnRouteIndex): boolean {
  return method === 'get' && (routes.isHealth(path) || routes.isMetrics(path))
}
