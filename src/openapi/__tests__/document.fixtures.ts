/**
 * @fileoverview Shared fixtures for the document-augmentation unit suites.
 *
 * The merge module has five separable behaviors — component merging, route
 * removal, security, responses, library contributions — and one report derived
 * from the result. Each has its own spec file, and every one of them needs the
 * same three things: resolved options with overrides applied, a generated
 * document to feed in, and a reader for the augmented one. Restating them per
 * file would be five copies of the same helper drifting apart, which is exactly
 * the duplication that makes a test suite stop agreeing with itself.
 *
 * Lives under `__tests__/` deliberately: both Jest coverage configs and the
 * Stryker `mutate` list exclude that directory, so test scaffolding is neither
 * counted as covered source nor mutated.
 * @layer Fixture
 */
import { normalizeCoreOptions } from '../../core.options'
import type {
  ResolvedCoreOptions,
  ResolvedHealthOptions,
  ResolvedMetricsOptions,
  ResolvedOpenApiOptions
} from '../../core.options'

/**
 * Resolved core options with the given OpenAPI and feature overrides applied.
 *
 * @param openapi - Members to override on the resolved OpenAPI block.
 * @param features - Whole feature blocks to replace, built by {@link health}
 *   and {@link metrics}.
 * @returns The resolved snapshot to hand to the merge.
 */
export function options(
  openapi: Partial<ResolvedOpenApiOptions> = {},
  features: Partial<Pick<ResolvedCoreOptions, 'health' | 'metrics'>> = {}
): ResolvedCoreOptions {
  const base = normalizeCoreOptions()
  return { ...base, ...features, openapi: { ...base.openapi, ...openapi } }
}

/**
 * The health block with overrides applied over its documented defaults.
 *
 * @param overrides - The members to change.
 * @returns The resolved health block.
 */
export function health(overrides: Partial<ResolvedHealthOptions>): ResolvedHealthOptions {
  return { ...normalizeCoreOptions().health, ...overrides }
}

/**
 * The metrics block with overrides applied over its documented defaults.
 *
 * @param overrides - The members to change.
 * @returns The resolved metrics block.
 */
export function metrics(overrides: Partial<ResolvedMetricsOptions>): ResolvedMetricsOptions {
  return { ...normalizeCoreOptions().metrics, ...overrides }
}

/**
 * Read a nested member without assuming the specification's own types.
 *
 * @param document - An augmented document.
 * @param key - The `components` member to read.
 * @returns That member, as a record.
 */
export function components(
  document: { components: Readonly<Record<string, unknown>> },
  key: string
): Record<string, unknown> {
  return document.components[key] as Record<string, unknown>
}

/**
 * Read one operation out of an augmented document.
 *
 * @param document - An augmented document.
 * @param path - The documented path.
 * @param method - The lowercase method key. Defaults to `get`.
 * @returns The operation object.
 */
export function operation(
  document: Record<string, unknown>,
  path: string,
  method = 'get'
): Record<string, unknown> {
  const paths = document['paths'] as Record<string, Record<string, unknown>>
  return paths[path]?.[method] as Record<string, unknown>
}

/**
 * A generated document carrying the given paths.
 *
 * @param paths - The path map the peer would have produced.
 * @returns The document to augment.
 */
export function generated(paths: Record<string, unknown>): {
  openapi: string
  paths: typeof paths
} {
  return { openapi: '3.0.0', paths }
}

/** Schemes a security test can name without tripping the declared-scheme check. */
export const SCHEMES = {
  cookieAuth: { type: 'apiKey', in: 'cookie', name: 'access_token' },
  refreshCookie: { type: 'apiKey', in: 'cookie', name: 'refresh_token' }
}

/** The three routes this package registers, as the peer would document them. */
export const OWN_ROUTES = {
  '/health/live': { get: {} },
  '/health/ready': { get: {} },
  '/metrics': { get: {} }
}
