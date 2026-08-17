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
 * without being told. Which paths those are is answered by `openapi.routes`,
 * so the recognition rules are stated once for every reader of them.
 * @layer Service
 */
import type {
  OpenApiOperationKey,
  OpenApiSecurityRequirement,
  ResolvedCoreOptions,
  ResolvedOpenApiOptions
} from '../core.options'
import type { OpenApiFragmentObject } from './openapi.contract'
import type { ResolvedContribution } from './openapi.contribution'
import { indexOwnRoutes, isOwnRoute } from './openapi.routes'
import type { OwnRouteIndex } from './openapi.routes'
import { CORE_PARAMETERS, CORE_SCHEMAS } from './openapi.schemas'
import type { OpenApiObjectMap } from './openapi.schemas'
import { asRecord, operationKey, operationsOf } from './openapi.shape'
import type { OpenApiDocumentLike } from './openapi.shape'

// Re-exported so the public signatures below keep naming a type from the module
// that declares them, rather than making every caller learn where it moved to.
export type { OpenApiDocumentLike }

/** A document that has been through {@link augmentDocument}. */
export type AugmentedDocument<T> = T & { components: Readonly<Record<string, unknown>> }

/** The security scheme this package contributes for a protected scrape endpoint. */
const METRICS_SCHEME_NAME = 'BymaxMetricsAuth'

/** Component name of the envelope every error path in this package returns. */
const ERROR_ENVELOPE_SCHEMA = 'BymaxErrorEnvelope'

/** Component name of the health payload the health endpoints return. */
const HEALTH_RESPONSE_SCHEMA = 'BymaxHealthResponse'

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
 * Merge contributed responses into the ones an operation already documents.
 *
 * The plain "existing always wins" rule does not work here, because the peer
 * emits a placeholder for every handler — a `200` carrying a description and no
 * `content` — so an operation is never actually missing its success status and
 * a contributed schema would never be written. A response with no `content`
 * describes no shape, so filling that in is additive rather than destructive;
 * one that does carry content — or is a bare `$ref`, which references a shape
 * declared elsewhere — is a real declaration and is left untouched. A
 * non-empty description the document already had survives either way, since
 * that is the part a consumer can have authored.
 *
 * @param existing - The responses the operation already documents.
 * @param additions - The responses this package contributes.
 * @returns The merged response map.
 */
function mergeResponses(
  existing: Readonly<Record<string, unknown>>,
  additions: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
  // Accumulated in a `Map` rather than written onto an object under a
  // document-supplied key, which is the shape a prototype-pollution analyser
  // flags — and it would be right to: these keys come from a file this package
  // did not write. Converted once at the end.
  const merged = new Map(Object.entries(existing))
  for (const [status, value] of Object.entries(additions)) {
    // Narrowed here rather than in the signature: the additions may come from a
    // contributor, whose values this package does not model.
    const contributed = asRecord(value)
    // An absent response narrows to an empty record, which has no content and
    // no description, so it takes the contributed entry whole through the same
    // path as a placeholder — no separate branch for "not there yet".
    const current = asRecord(merged.get(status))
    // `$ref` counts as declaring a shape even though it carries no `content`: a
    // response can legally be nothing but a reference, and filling one in would
    // both discard the reference and leave a `$ref` beside sibling keys, which
    // is not a valid response object.
    if (current['content'] === undefined && current['$ref'] === undefined) {
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
 * Drop the paths belonging to a feature the consumer turned off.
 *
 * The runtime answers those routes with a 404 envelope — on the asynchronous
 * registration path the controller is mounted unconditionally and guards each
 * request, because route metadata is fixed before the options resolve — so a
 * document that still listed them would describe a route this deployment does
 * not serve. The decision is read from the same resolved snapshot the guard
 * reads, which is what keeps the two from drifting.
 *
 * What leaves is the **operation**, not the path item. The controllers this
 * package registers own the `GET` alone, so an application that mounted another
 * method on the same path keeps it — and keeps whatever else the item carries,
 * such as a shared `parameters` list. The path itself is dropped only once
 * nothing is left to document under it, since an item with no operations
 * describes nothing.
 *
 * @param paths - The document's path map.
 * @param options - The resolved options.
 * @param routes - The recognizer for this package's own routes.
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

  const kept = Object.entries(paths).map(([path, item]) => {
    if (!disabled(path)) {
      return [path, item] as const
    }
    const remaining = Object.fromEntries(
      Object.entries(asRecord(item)).filter(([key]) => key !== 'get')
    )
    return [path, operationsOf(remaining).length === 0 ? undefined : remaining] as const
  })

  return Object.fromEntries(kept.filter(([, item]) => item !== undefined))
}

/**
 * Whether an operation that states nothing inherits a credential requirement
 * from the served document.
 *
 * Read from the document that will actually be served, not from the configured
 * option alone. `augmentDocument` preserves a default the generated document
 * already carried and writes the configured one only when there is none — so a
 * consumer whose document arrives with its own default has an empty
 * `openapi.security` and an inheriting document at the same time. Consulting
 * the option by itself misses exactly that consumer, and leaves this package's
 * own open routes inheriting a credential they do not check.
 *
 * Only a non-empty array counts. An explicit `[]` requires nothing, so an own
 * route has nothing to override; a malformed member is not a requirement this
 * package will claim to understand the shape of.
 *
 * @param document - The generated document, before augmentation.
 * @param openapi - The resolved OpenAPI options.
 * @returns Whether a bare operation ends up requiring a credential.
 */
function inheritsRequirement(
  document: OpenApiDocumentLike,
  openapi: ResolvedOpenApiOptions
): boolean {
  if (document.security === undefined) {
    return openapi.security.length > 0
  }
  return Array.isArray(document.security) && document.security.length > 0
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
 * @param method - The operation's lowercase method key.
 * @param options - The resolved options.
 * @param routes - The recognizer for this package's own routes.
 * @param inherits - Whether a bare operation inherits a credential requirement
 *   from the served document. See {@link inheritsRequirement}.
 * @returns The requirement to write, or `undefined` to leave the operation be.
 */
function ownRouteSecurity(
  path: string,
  method: string,
  options: ResolvedCoreOptions,
  routes: OwnRouteIndex,
  inherits: boolean
): readonly OpenApiSecurityRequirement[] | undefined {
  // The controllers this package registers expose GET and nothing else, so a
  // consumer who adds another method under the same path owns that operation
  // and must not inherit a policy stated for ours.
  if (method !== 'get') {
    return undefined
  }
  if (options.metrics.authToken !== undefined && routes.isMetrics(path)) {
    return [{ [METRICS_SCHEME_NAME]: [] }]
  }
  // Both remaining own routes are public, and both must say so rather than
  // inherit. The scrape endpoint reaches here only when no token is configured,
  // which is the documented "protected at the edge" arrangement: the process
  // itself answers anyone. Letting it inherit a document default would describe
  // an open endpoint as requiring a credential — and that is the worse
  // direction of the two. Documenting a guarded route as open fails loudly, at
  // the first generated client that omits the credential and gets a 401.
  // Documenting an open route as guarded fails nowhere: the wrong answer goes
  // to whoever opened the document to ask what is exposed.
  if (inherits && (routes.isHealth(path) || routes.isMetrics(path))) {
    return []
  }
  return undefined
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
function coreResponses(
  path: string,
  options: ResolvedCoreOptions,
  routes: OwnRouteIndex
): OpenApiObjectMap {
  const responses: Record<string, Readonly<Record<string, unknown>>> = {}
  // Only while the filter that produces the envelope is actually installed.
  // With it off, errors are shaped by Nest or by the consumer's own handler,
  // and documenting this package's envelope would describe a body the
  // deployment never sends.
  if (options.envelope.enabled) {
    responses['default'] = {
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
 * The fragments contributed for one operation, in contributor order.
 *
 * @param operationId - The id the scan assigned to this operation.
 * @param contributions - Every contribution collected for this document.
 * @returns The fragments addressing it, earliest contributor first.
 */
function fragmentsFor(
  operationId: unknown,
  contributions: readonly ResolvedContribution[]
): readonly OpenApiFragmentObject[] {
  // Read through `Object.entries` rather than by indexing with a value the
  // document supplied: the read is safe, but a computed member access is the
  // shape an analyser cannot tell apart from the bug it resembles. Comparing by
  // equality also removes the need to guard the type first — an operation with
  // no id matches no fragment, because no fragment is keyed to `undefined`.
  return contributions.flatMap((contribution) =>
    Object.entries(contribution.operations)
      .filter(([id]) => id === operationId)
      .map(([, fragment]) => fragment)
  )
}

/**
 * Merge a library's fragment into the operation it addresses.
 *
 * The precedence is the one this module already applies everywhere: the
 * document wins. A library describes what a consumer did not, and a consumer
 * who decorated their handler outranks the library that shipped it — so a
 * member the operation already carries is never replaced. Responses go through
 * the same shape-aware rule as this package's own, so a library can fill in the
 * peer's placeholder without overwriting a real declaration.
 *
 * @param operation - The operation so far.
 * @param fragment - What a contributor supplied for it.
 * @returns The operation with the fragment merged beneath it.
 */
function mergeFragment(
  operation: Readonly<Record<string, unknown>>,
  fragment: OpenApiFragmentObject
): Readonly<Record<string, unknown>> {
  // The fragment goes underneath: spreading it first and the operation second
  // is the whole precedence rule, expressed as one order rather than as a
  // per-member conditional — and it keeps every write off a computed key.
  const { responses, ...members } = fragment
  const merged: Record<string, unknown> = { ...members, ...operation }
  if (responses !== undefined) {
    merged['responses'] = mergeResponses(asRecord(operation['responses']), asRecord(responses))
  }
  return merged
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
  routes: OwnRouteIndex,
  contributions: readonly ResolvedContribution[],
  inherits: boolean
): Readonly<Record<string, unknown>> {
  // Whether the *generated* operation declared its own requirement — read
  // before any fragment lands, because a library filling the member in must not
  // be mistaken for the consumer having decorated their handler.
  const declaredByDocument = operation['security'] !== undefined

  let result: Record<string, unknown> = { ...operation }
  for (const fragment of fragmentsFor(result['operationId'], contributions)) {
    result = { ...mergeFragment(result, fragment) }
  }

  // Three sources, in the order the lanes were agreed: the document itself
  // outranks everyone, then the consumer's override, then the library that
  // shipped the route, and this package's own policy only where nobody spoke.
  // The override has to be applied *after* the fragments and still beat them —
  // reading "already set" as "leave it alone" would let a dependency overrule
  // the deployment, which inverts the whole precedence.
  if (!declaredByDocument) {
    const override =
      options.openapi.operationSecurity[operationKey(method, path) as OpenApiOperationKey]
    const describedByLibrary = result['security'] !== undefined
    const security =
      override ??
      (describedByLibrary ? undefined : ownRouteSecurity(path, method, options, routes, inherits))
    if (security !== undefined) {
      result['security'] = security
    }
  }

  if (options.openapi.includeCoreSchemas) {
    result['responses'] = mergeResponses(
      asRecord(result['responses']),
      coreResponses(path, options, routes)
    )
  }

  return result
}

/** One operation the consumer owns, addressed and read. */
interface ConsumerOperation {
  /** The `"<METHOD> <path>"` key addressing it. */
  readonly key: string
  /** The operation object itself. */
  readonly operation: Readonly<Record<string, unknown>>
}

/**
 * Every operation in the document except the ones this package registered.
 *
 * The exclusion runs on both sides of {@link unsecuredOperations}: this
 * package's own routes must neither be reported nor be the evidence that
 * somebody described a security posture. A health probe carrying no requirement
 * is the correct description of a route an orchestrator polls without a
 * credential, and the scrape endpoint carries one exactly when a token is
 * configured — neither says anything about what the consumer's routes were
 * meant to require.
 *
 * @param paths - The served document's path map.
 * @param routes - The recognizer for this package's own routes.
 * @returns The consumer's operations, in document order.
 */
function consumerOperations(
  paths: Readonly<Record<string, unknown>>,
  routes: OwnRouteIndex
): readonly ConsumerOperation[] {
  return Object.entries(paths).flatMap(([path, item]) =>
    operationsOf(item)
      .filter(([method]) => !isOwnRoute(path, method, routes))
      .map(([method, operation]) => ({
        key: operationKey(method, path),
        operation: asRecord(operation)
      }))
  )
}

/**
 * The consumer's operations that the served document says require nothing at
 * all — no requirement of their own, none contributed, no override, and no
 * document-level default to inherit.
 *
 * That combination has exactly one meaning to a client generator: send no
 * credentials. It is almost never what a backend with guards intends, and
 * nothing else in this module can catch it — {@link assertSchemesDeclared} is
 * satisfied precisely because there are no requirements left to dangle, and the
 * runtime still answers `401`, so a status-code probe finds nothing either. The
 * one edit that produces it is deleting a document-level `security` default
 * alongside the per-operation entries a library has taken over describing.
 *
 * Two conditions keep this quiet where the silence is correct. A document-level
 * member answers for every operation that states nothing, so its presence ends
 * the question — including the explicit empty array, which is a consumer
 * declaring the whole API public rather than omitting to say anything. And an
 * application where *no* operation states a requirement never described a
 * posture at all: that is a genuinely public API, and a warning it earns on
 * every boot forever is the one that teaches people to skip warnings. What is
 * reported is therefore always an operation left bare beside operations that
 * are not.
 *
 * The known gap follows from that second condition, and it is the honest limit
 * of the check: a document with nothing explicit anywhere is indistinguishable
 * from an API that is public on purpose, so a consumer who deletes *every*
 * requirement at once is not warned. Deleting the document default while a
 * library still describes its own routes — the case this exists for — is.
 *
 * Reported rather than thrown, and computed here rather than logged here: an
 * all-public API is a legitimate configuration, and this module stays data in,
 * data out so the rule is testable without a Nest application.
 *
 * @param document - The document that will be served, after augmentation.
 * @param options - The resolved core options.
 * @param pathPrefixes - Every prefix this package's own routes can appear
 *   under, as {@link augmentDocument} takes them.
 * @returns The operation keys, in document order, or none when the document
 *   carries a default, describes no requirement anywhere, or leaves nothing
 *   bare.
 */
export function unsecuredOperations(
  document: OpenApiDocumentLike,
  options: ResolvedCoreOptions,
  pathPrefixes: readonly string[] = ['']
): readonly string[] {
  if (document.security !== undefined) {
    return []
  }

  const routes = indexOwnRoutes(options, pathPrefixes)
  const candidates = consumerOperations(asRecord(document.paths), routes)
  if (!candidates.some(({ operation }) => operation['security'] !== undefined)) {
    return []
  }
  return candidates
    .filter(({ operation }) => operation['security'] === undefined)
    .map(({ key }) => key)
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
 * Reject a foreign definition of the scheme this package contributes.
 *
 * `BymaxMetricsAuth` is this package's name, and the scrape operation is
 * documented as requiring it. If something else defines that name — a consumer
 * option, or a scheme the peer generated from a decorator — the merge rules
 * make one of them win silently, and the losing case is the dangerous one: the
 * operation would keep pointing at a scheme that is no longer the bearer token
 * the runtime actually checks, telling a client to authenticate a way that does
 * not work. Naming the collision is the only honest outcome, and the name is
 * distinctive enough that a collision is a mistake rather than a coincidence.
 *
 * @param openapi - The resolved OpenAPI options.
 * @param components - The components the generated document already carries.
 * @param contributes - Whether this package will contribute the scheme at all.
 * @throws Error When the reserved name is already defined by someone else.
 */
function assertScrapeSchemeIsOurs(
  openapi: ResolvedOpenApiOptions,
  components: Readonly<Record<string, unknown>>,
  contributes: boolean
): void {
  if (!contributes) {
    return
  }
  // Membership read through `Object.keys` rather than by indexing with the
  // constant: the reads are safe, but a computed member access is the shape an
  // analyser cannot tell apart from the prototype-pollution bug it resembles.
  const declaredByConsumer = Object.keys(openapi.securitySchemes).includes(METRICS_SCHEME_NAME)
  const declaredByDocument = Object.keys(asRecord(components['securitySchemes'])).includes(
    METRICS_SCHEME_NAME
  )
  if (!declaredByConsumer && !declaredByDocument) {
    return
  }

  throw new Error(
    `[BymaxCoreModule] the security scheme "${METRICS_SCHEME_NAME}" is reserved: this package ` +
      'contributes it to document the bearer token the scrape endpoint checks, and it is already ' +
      `defined ${declaredByConsumer ? 'in openapi.securitySchemes' : 'by the generated document'}. ` +
      'Rename yours, or unset metrics.authToken if the endpoint is not protected.'
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
  routes: OwnRouteIndex,
  contributions: readonly ResolvedContribution[],
  inherits: boolean
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(paths).map(([path, item]) => {
      const augmented = operationsOf(item).map(([method, operation]) => [
        method,
        augmentOperation(
          asRecord(operation),
          path,
          method,
          options,
          routes,
          contributions,
          inherits
        )
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
 * @param pathPrefixes - Every prefix the application serves this package's own
 *   routes under: its global prefix combined with each URI version segment. The
 *   peer documents paths as the application serves them, so this package cannot
 *   recognize its own routes without them — and must not guess them from the
 *   document, which would mistake a consumer's shared controller prefix for the
 *   application's.
 * @param contributions - What the libraries in this application contributed,
 *   already resolved to the operation ids the document uses.
 * @returns The augmented document.
 * @throws Error When `openapi.operationSecurity` addresses an operation the
 *   document does not contain, or when a security requirement names a scheme
 *   the document does not define.
 */
export function augmentDocument<T extends OpenApiDocumentLike>(
  document: T,
  options: ResolvedCoreOptions,
  pathPrefixes: readonly string[] = [''],
  contributions: readonly ResolvedContribution[] = []
): AugmentedDocument<T> {
  const { openapi } = options
  const components = asRecord(document.components)
  // Accumulated in a `Map`, converted once at the end. Component member names
  // reach this from contributors, and writing one onto an object is not merely
  // the shape an analyser flags: `Object.assign` invokes the target's
  // `__proto__` setter, so a member by that name would replace the prototype
  // instead of becoming an own component — and inherited entries would then
  // take part in the scheme validation below. A `Map` key cannot do that.
  const merged = new Map(Object.entries(components))

  if (openapi.includeCoreSchemas) {
    merged.set('schemas', mergeAbsent(asRecord(components['schemas']), CORE_SCHEMAS))
    merged.set('parameters', mergeAbsent(asRecord(components['parameters']), CORE_PARAMETERS))
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
  assertScrapeSchemeIsOurs(openapi, components, options.metrics.authToken !== undefined)

  // The consumer's schemes and this package's own land *before* the libraries',
  // because the precedence is document over consumer over library and
  // `mergeAbsent` gives the existing side the win. Folding the libraries in
  // first would have let a dependency's scheme outrank the deployment's — and
  // let one claim the reserved scrape name behind the check just above.
  const declaredSchemes = mergeAbsent(asRecord(components['securitySchemes']), {
    ...openapi.securitySchemes,
    ...scrapeScheme
  })
  if (Object.keys(declaredSchemes).length > 0) {
    merged.set('securitySchemes', declaredSchemes)
  }

  // Contributed components land beneath everything above: the document, this
  // package's catalogue and the consumer's own configuration all keep winning.
  for (const contribution of contributions) {
    for (const [member, entries] of Object.entries(contribution.components)) {
      merged.set(member, mergeAbsent(asRecord(merged.get(member)), entries))
    }
  }

  // Validated against everything the served document will define, libraries
  // included: rejecting a consumer for naming a scheme their own library
  // supplies would fail on the arrangement this lane exists to enable.
  assertSchemesDeclared(openapi, asRecord(merged.get('securitySchemes')))

  const routes = indexOwnRoutes(options, pathPrefixes)
  const served = withoutDisabledRoutes(asRecord(document.paths), options, routes)
  assertOverridesMatch(served, openapi)

  // Spread-in fragments rather than assignment into a loose record: a document
  // without `paths` keeps not having one, and a consumer's own document-level
  // requirement is never replaced — both without the cast that writing through
  // an index signature would have needed.
  const paths =
    document.paths === undefined
      ? {}
      : {
          paths: augmentPaths(
            served,
            options,
            routes,
            contributions,
            inheritsRequirement(document, openapi)
          )
        }
  const security =
    openapi.security.length > 0 && document.security === undefined
      ? { security: openapi.security }
      : {}

  return { ...document, components: Object.fromEntries(merged), ...paths, ...security }
}
