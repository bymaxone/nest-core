/**
 * @fileoverview Pure document augmentation: given a generated OpenAPI document
 * and the resolved options, produce the document that will actually be served.
 *
 * Everything here is data in, data out, with no import of the optional peer, so
 * the merge rules are unit-testable without `@nestjs/swagger` installed and the
 * bootstrap helper is left with nothing but wiring. That constraint is also why
 * none of this is expressed as decorators on the controllers: a decorator runs
 * when its class is defined, which would load the peer in every application
 * that imports this package, including the ones that never enable the feature.
 *
 * The merge is additive and never destructive: a contributed entry is written
 * only when the document has no entry under that name. A consumer who
 * deliberately documents a schema called `BymaxErrorEnvelope`, or decorates an
 * operation with its own security requirement, means it — and silently
 * replacing their definition with this package's would be the kind of surprise
 * a documentation tool must never spring.
 *
 * Beyond merging components, this module makes the document describe *this*
 * deployment: a feature the consumer turned off has its routes removed, since
 * the runtime answers 404 for them, and the routes this package registers
 * itself carry the security they actually require, which this package knows
 * without being told.
 * @layer Service
 */
import type {
  OpenApiOperationKey,
  OpenApiSecurityRequirement,
  ResolvedCoreOptions,
  ResolvedOpenApiOptions
} from '../core.options'
// Imported from the leaf module rather than from `core.options`, which
// re-exports them: this is a separate bundle, and reaching into the resolver
// for two strings inlines the whole of it here. See `route-defaults.ts`.
import { DEFAULT_HEALTH_PATH, DEFAULT_METRICS_PATH } from '../route-defaults'
import { CORE_PARAMETERS, CORE_SCHEMAS } from './openapi.schemas'
import type { OpenApiObjectMap } from './openapi.schemas'

/**
 * The only structural requirements this module places on a document: it may
 * carry `components` and `paths`, whose types it deliberately does not assume.
 * Staying this loose is what lets the augmentation run against the peer's own
 * `OpenAPIObject` without importing it and without a laundering cast — the
 * peer's interface satisfies this shape, and so does a plain test fixture.
 */
export interface OpenApiDocumentLike {
  /** The document's component registry, when it has one. */
  readonly components?: unknown
  /** The document's path map, when it has one. */
  readonly paths?: unknown
  /** The document-level security requirement, when the consumer declared one. */
  readonly security?: unknown
}

/** A document that has been through {@link augmentDocument}. */
export type AugmentedDocument<T> = T & { components: Readonly<Record<string, unknown>> }

/**
 * The method keys a path item can carry an operation under, lowercase as the
 * specification writes them and as the peer emits them. Everything else in a
 * path item — `parameters`, `summary`, `$ref` — is not an operation and must be
 * left alone.
 */
const OPERATION_METHODS: readonly string[] = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options',
  'trace'
]

/** The security scheme this package contributes for a protected scrape endpoint. */
const METRICS_SCHEME_NAME = 'BymaxMetricsAuth'

/** Component name of the envelope every error path in this package returns. */
const ERROR_ENVELOPE_SCHEMA = 'BymaxErrorEnvelope'

/** Component name of the health payload the health endpoints return. */
const HEALTH_RESPONSE_SCHEMA = 'BymaxHealthResponse'

/**
 * Narrow a document member to a record. A document produced by the peer always
 * has object-valued `components`, but this function is total anyway: an absent
 * or malformed member yields an empty record, so the merge below can never
 * throw on a shape it did not expect.
 *
 * @param value - The member to narrow.
 * @returns The value as a record, or an empty record when it is not one.
 */
function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {}
  }
  return value as Readonly<Record<string, unknown>>
}

/**
 * Merge `additions` into `existing`, keeping every entry `existing` already
 * defines.
 *
 * @param existing - The entries already present in the document.
 * @param additions - The entries this package contributes.
 * @returns A new record holding both, with `existing` winning every collision.
 */
function mergeAbsent(
  existing: Readonly<Record<string, unknown>>,
  additions: OpenApiObjectMap
): Readonly<Record<string, unknown>> {
  return { ...additions, ...existing }
}

/**
 * The operations a path item carries, as `[method, operation]` pairs.
 *
 * Read by filtering the item's own entries rather than by looking each method
 * up on it. That is one pass over what is actually there instead of eight
 * lookups, and it keeps every read of a document-supplied object off a computed
 * key — the shape that is indistinguishable, to a reader or an analyser, from
 * the prototype-pollution bug it resembles.
 *
 * @param item - A path item from the document.
 * @returns Its operation entries, in document order.
 */
function operationsOf(item: unknown): readonly (readonly [string, unknown])[] {
  return Object.entries(asRecord(item)).filter(([key]) => OPERATION_METHODS.includes(key))
}

/**
 * Merge contributed responses into the ones an operation already documents.
 *
 * The plain "existing always wins" rule does not work here, because the peer
 * emits a placeholder for every handler — a `200` carrying a description and no
 * `content` — so an operation is never actually missing its success status and
 * a contributed schema would never be written. A response with no `content`
 * describes no shape, so filling that in is additive rather than destructive;
 * one that does carry content is a real declaration and is left untouched. A
 * non-empty description the document already had survives either way, since
 * that is the part a consumer can have authored.
 *
 * @param existing - The responses the operation already documents.
 * @param additions - The responses this package contributes.
 * @returns The merged response map.
 */
function mergeResponses(
  existing: Readonly<Record<string, unknown>>,
  additions: OpenApiObjectMap
): Readonly<Record<string, unknown>> {
  // Accumulated in a `Map` rather than written onto an object under a
  // document-supplied key, which is the shape a prototype-pollution analyser
  // flags — and it would be right to: these keys come from a file this package
  // did not write. Converted once at the end.
  const merged = new Map(Object.entries(existing))
  for (const [status, contributed] of Object.entries(additions)) {
    // An absent response narrows to an empty record, which has no content and
    // no description, so it takes the contributed entry whole through the same
    // path as a placeholder — no separate branch for "not there yet".
    const current = asRecord(merged.get(status))
    if (current['content'] === undefined) {
      const described =
        current['description'] === undefined || current['description'] === ''
          ? contributed['description']
          : current['description']
      merged.set(status, { ...current, ...contributed, description: described })
    }
  }
  return Object.fromEntries(merged)
}

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
 * Build the test for "is this documented path a route this package registered".
 *
 * Equality is not enough, because `@nestjs/swagger` documents paths *including*
 * the application's global prefix: an application calling
 * `setGlobalPrefix('api')` documents this package's health probe as
 * `/api/health/live`, and a package that only recognized `/health/live` would
 * stop recognizing its own routes the moment a consumer set a prefix.
 *
 * A bare tail match is too much. `/tenants/{id}/health/live` is a consumer's own
 * route, and treating it as this package's would delete it from their document
 * when the health feature is off — losing their content to fix ours, silently,
 * which is worse than the over-listing this whole module exists to correct.
 *
 * What separates the two is that a global prefix prefixes **everything**. So a
 * tail match is accepted only when whatever precedes the suffix also precedes
 * every other path in the document: `/api/v2` qualifies, `/tenants/{id}` does
 * not, because it does not prefix `/invoices`. The one case this cannot resolve
 * is a document whose *only* path is the consumer's look-alike route, where
 * their prefix is vacuously shared; a single-route application whose sole route
 * ends in `/health/live` and which disables health is a shape worth naming here
 * rather than defending against.
 *
 * @param paths - The document's path map, before anything is removed.
 * @returns A predicate over a documented path and a registered route suffix.
 */
function createRouteMatcher(
  paths: Readonly<Record<string, unknown>>
): (documentedPath: string, suffix: string) => boolean {
  const documented = Object.keys(paths)
  return (documentedPath: string, suffix: string): boolean => {
    if (!documentedPath.endsWith(`/${suffix}`)) {
      return false
    }
    // The unprefixed case needs no branch of its own: it leaves an empty
    // prefix, and every documented path begins with a slash, so the test below
    // is vacuously true exactly when it should be.
    const prefix = documentedPath.slice(0, documentedPath.length - suffix.length - 1)
    // The prefix itself counts as being under the prefix. An application with a
    // global prefix and a controller at its root documents `/api` beside
    // `/api/health/live`, and `'/api'.startsWith('/api/')` is false — without
    // this clause that one root operation would reject the match and leave a
    // disabled feature advertised, which is the whole defect being fixed. The
    // empty-prefix case cannot reach it: no documented path is the empty string.
    return documented.every((other) => other.startsWith(`${prefix}/`) || other === prefix)
  }
}

/** Decides whether a documented path is one of this package's own routes. */
type RouteMatcher = ReturnType<typeof createRouteMatcher>

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
interface OwnRouteIndex {
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
 * @param paths - The document's path map, before anything is removed.
 * @param options - The resolved options.
 * @returns The recognizer for this document.
 */
function indexOwnRoutes(
  paths: Readonly<Record<string, unknown>>,
  options: ResolvedCoreOptions
): OwnRouteIndex {
  const matches: RouteMatcher = createRouteMatcher(paths)
  const health = healthRoutes(options)
  const metrics = metricsRoutes(options)
  return {
    isHealth: (path) => health.some((suffix) => matches(path, suffix)),
    isMetrics: (path) => metrics.some((suffix) => matches(path, suffix))
  }
}

/**
 * Drop the paths belonging to a feature the consumer turned off.
 *
 * The runtime answers those routes with a 404 envelope — on the asynchronous
 * registration path the controller is mounted unconditionally and guards each
 * request, because route metadata is fixed before the options resolve — so a
 * document that still listed them would describe a route this deployment does
 * not serve. The decision is read from the same resolved snapshot the guard
 * reads, which is what keeps the two from drifting.
 *
 * @param paths - The document's path map.
 * @param options - The resolved options.
 * @returns The path map without the disabled features' routes.
 */
function withoutDisabledRoutes(
  paths: Readonly<Record<string, unknown>>,
  options: ResolvedCoreOptions,
  routes: OwnRouteIndex
): Readonly<Record<string, unknown>> {
  const disabled = (path: string): boolean =>
    (!options.health.enabled && routes.isHealth(path)) ||
    (!options.metrics.enabled && routes.isMetrics(path))

  return Object.fromEntries(Object.entries(paths).filter(([path]) => !disabled(path)))
}

/**
 * The requirement this package documents for its own routes, or `undefined`
 * when it has nothing to say about them.
 *
 * The health probes are public: they exist to be polled by an orchestrator that
 * holds no credential. They are only marked so when the document carries a
 * default requirement, since an explicit "requires nothing" is noise in a
 * document where nothing requires anything.
 *
 * The scrape endpoint is the opposite case, and this package knows the answer
 * exactly: it is protected when, and only when, `metrics.authToken` is set.
 * That is worth documenting whether or not a default exists.
 *
 * @param path - The documented path.
 * @param options - The resolved options.
 * @returns The requirement to write, or `undefined` to leave the operation be.
 */
function ownRouteSecurity(
  path: string,
  options: ResolvedCoreOptions,
  routes: OwnRouteIndex
): readonly OpenApiSecurityRequirement[] | undefined {
  if (options.metrics.authToken !== undefined && routes.isMetrics(path)) {
    return [{ [METRICS_SCHEME_NAME]: [] }]
  }
  if (options.openapi.security.length > 0 && routes.isHealth(path)) {
    return []
  }
  return undefined
}

/**
 * Build the `"<METHOD> <path>"` key addressing one operation.
 *
 * @param method - The lowercase method key from the path item.
 * @param path - The documented path.
 * @returns The operation key.
 */
function operationKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`
}

/**
 * The responses this package contributes to one operation.
 *
 * Every error path in this package answers with the envelope, so it is attached
 * as the `default` response rather than guessed per status code: this package
 * knows what an error looks like, and does not know which statuses a consumer's
 * handler can produce. The health endpoints are the exception it *does* know,
 * being its own.
 *
 * @param path - The documented path.
 * @param options - The resolved options.
 * @returns The responses to merge, keyed by status.
 */
function coreResponses(path: string, routes: OwnRouteIndex): OpenApiObjectMap {
  const responses: Record<string, Readonly<Record<string, unknown>>> = {
    default: {
      description: 'Error envelope returned by every failing request.',
      content: {
        'application/json': { schema: { $ref: `#/components/schemas/${ERROR_ENVELOPE_SCHEMA}` } }
      }
    }
  }
  if (routes.isHealth(path)) {
    responses['200'] = {
      description: 'Aggregated health report.',
      content: {
        'application/json': { schema: { $ref: `#/components/schemas/${HEALTH_RESPONSE_SCHEMA}` } }
      }
    }
  }
  return responses
}

/**
 * Apply the security requirements and contributed responses to one operation.
 *
 * @param operation - The generated operation.
 * @param path - The path it sits under.
 * @param method - Its lowercase method key.
 * @param options - The resolved options.
 * @returns The operation to serve.
 */
function augmentOperation(
  operation: Readonly<Record<string, unknown>>,
  path: string,
  method: string,
  options: ResolvedCoreOptions,
  routes: OwnRouteIndex
): Readonly<Record<string, unknown>> {
  const result: Record<string, unknown> = { ...operation }

  if (result['security'] === undefined) {
    const override =
      options.openapi.operationSecurity[operationKey(method, path) as OpenApiOperationKey]
    const security = override ?? ownRouteSecurity(path, options, routes)
    if (security !== undefined) {
      result['security'] = security
    }
  }

  if (options.openapi.includeCoreSchemas) {
    result['responses'] = mergeResponses(asRecord(result['responses']), coreResponses(path, routes))
  }

  return result
}

/**
 * Reject a requirement naming a security scheme the document does not define.
 *
 * A requirement is a reference, and a reference to nothing produces a document
 * whose security is unresolvable: a client generator reads
 * `security: [{ cookieAuth: [] }]`, looks `cookieAuth` up in
 * `components.securitySchemes`, finds nothing, and either fails or emits an
 * unauthenticated client. Configuring the requirement and forgetting the scheme
 * is one edit apart, so this is a mistake worth catching rather than one worth
 * assuming away — and it is the same mistake, in the same feature, as a key
 * addressing no operation, so it fails the same loud way.
 *
 * @param openapi - The resolved OpenAPI options.
 * @param schemes - The security schemes the served document will define.
 * @throws Error When a requirement names a scheme that is not defined.
 */
function assertSchemesDeclared(
  openapi: ResolvedOpenApiOptions,
  schemes: Readonly<Record<string, unknown>>
): void {
  const required = [...openapi.security, ...Object.values(openapi.operationSecurity).flat()]
  const named = [...new Set(required.flatMap((requirement) => Object.keys(requirement)))]
  const declared = Object.keys(schemes)
  const missing = named.filter((name) => !declared.includes(name))
  if (missing.length === 0) {
    return
  }

  throw new Error(
    `[BymaxCoreModule] openapi security names ${missing.length} scheme(s) that the document does ` +
      `not define: ${missing.join(', ')}. Declare them in openapi.securitySchemes, or drop the ` +
      `requirement. The document defines: ${declared.length === 0 ? '(none)' : declared.join(', ')}.`
  )
}

/**
 * Every operation key the document actually contains, in document order.
 *
 * @param paths - The document's path map.
 * @returns The keys, as {@link operationKey} builds them.
 */
function documentedOperationKeys(paths: Readonly<Record<string, unknown>>): readonly string[] {
  return Object.entries(paths).flatMap(([path, item]) =>
    operationsOf(item).map(([method]) => operationKey(method, path))
  )
}

/**
 * Reject a per-operation override that addresses no operation.
 *
 * A key that matches nothing is always a mistake — a typo, a renamed route, or
 * a path written without the application's global prefix — and the cost of
 * staying quiet about it is a route documented as authenticated when it is not,
 * or the reverse. Failing is safe here in a way it rarely is: the document is
 * built only when the feature is enabled, which the production guard makes
 * impossible in a production runtime, so this can only ever stop a developer.
 *
 * @param paths - The document's path map, after disabled routes are dropped.
 * @param openapi - The resolved OpenAPI options.
 * @throws Error When a configured key addresses no documented operation.
 */
function assertOverridesMatch(
  paths: Readonly<Record<string, unknown>>,
  openapi: ResolvedOpenApiOptions
): void {
  const configured = Object.keys(openapi.operationSecurity)
  const documented = documentedOperationKeys(paths)
  const unmatched = configured.filter((key) => !documented.includes(key))
  if (unmatched.length === 0) {
    return
  }

  throw new Error(
    `[BymaxCoreModule] openapi.operationSecurity addresses ${unmatched.length} operation(s) that ` +
      `the document does not contain: ${unmatched.join(', ')}. Keys are "<METHOD> <path>" with the ` +
      'path exactly as documented, including any global prefix. The document contains: ' +
      `${documented.length === 0 ? '(none)' : documented.join(', ')}.`
  )
}

/**
 * Rebuild the path map with every operation augmented.
 *
 * @param paths - The document's path map.
 * @param options - The resolved options.
 * @returns The path map to serve.
 */
function augmentPaths(
  paths: Readonly<Record<string, unknown>>,
  options: ResolvedCoreOptions,
  routes: OwnRouteIndex
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(paths).map(([path, item]) => {
      const augmented = operationsOf(item).map(([method, operation]) => [
        method,
        augmentOperation(asRecord(operation), path, method, options, routes)
      ])
      // Spread after the original so the augmented operations replace theirs,
      // while every non-operation member of the path item survives untouched.
      return [path, { ...asRecord(item), ...Object.fromEntries(augmented) }]
    })
  )
}

/**
 * Produce the document to serve: the generated one, plus the schemas and
 * parameters this package owns, the consumer's declared security schemes, the
 * security requirements each operation actually carries, and the responses this
 * package can describe — with the routes of any disabled feature removed.
 *
 * Neither the input document nor the resolved options are mutated; the returned
 * document shares every untouched member with the original.
 *
 * @param document - The document generated from the application's controllers.
 * @param options - The resolved core options, in full: the document describes a
 *   deployment, and which features that deployment serves is not an OpenAPI
 *   setting.
 * @returns The augmented document.
 * @throws Error When `openapi.operationSecurity` addresses an operation the
 *   document does not contain, or when a security requirement names a scheme
 *   the document does not define.
 */
export function augmentDocument<T extends OpenApiDocumentLike>(
  document: T,
  options: ResolvedCoreOptions
): AugmentedDocument<T> {
  const { openapi } = options
  const components = asRecord(document.components)
  const merged: Record<string, unknown> = { ...components }

  if (openapi.includeCoreSchemas) {
    merged['schemas'] = mergeAbsent(asRecord(components['schemas']), CORE_SCHEMAS)
    merged['parameters'] = mergeAbsent(asRecord(components['parameters']), CORE_PARAMETERS)
  }

  // Contributed only when the scrape endpoint is actually protected, so the
  // document never advertises a credential the deployment does not check.
  const scrapeScheme =
    options.metrics.authToken === undefined
      ? {}
      : {
          [METRICS_SCHEME_NAME]: {
            type: 'http',
            scheme: 'bearer',
            description: 'Bearer token required by the metrics scrape endpoint.'
          }
        }
  // Everything the served document will define, including whatever the document
  // already carried — that is what a requirement can legitimately reference, so
  // it is what the requirements are checked against.
  const schemes = mergeAbsent(asRecord(components['securitySchemes']), {
    ...openapi.securitySchemes,
    ...scrapeScheme
  })
  if (Object.keys(schemes).length > 0) {
    merged['securitySchemes'] = schemes
  }
  assertSchemesDeclared(openapi, schemes)

  const routes = indexOwnRoutes(asRecord(document.paths), options)
  const served = withoutDisabledRoutes(asRecord(document.paths), options, routes)
  assertOverridesMatch(served, openapi)

  // Spread-in fragments rather than assignment into a loose record: a document
  // without `paths` keeps not having one, and a consumer's own document-level
  // requirement is never replaced — both without the cast that writing through
  // an index signature would have needed.
  const paths = document.paths === undefined ? {} : { paths: augmentPaths(served, options, routes) }
  const security =
    openapi.security.length > 0 && document.security === undefined
      ? { security: openapi.security }
      : {}

  return { ...document, components: merged, ...paths, ...security }
}
