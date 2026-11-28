/**
 * @fileoverview The `components` of the served OpenAPI document: this package's catalogue, the
 * consumer's security schemes, the scrape scheme and what the libraries contributed, in that order of
 * precedence, refused when a requirement names a scheme none of them defines.
 *
 * Data in, data out, with no import of the optional peer.
 * @layer Service
 */
import { bootError } from '../boot-error'
import type { ResolvedCoreOptions, ResolvedOpenApiOptions } from '../core.options'
import { mergeContributedComponents, placeComponentEntries } from './openapi.components'
import type { DiscardedComponent } from './openapi.components'
import type { ResolvedContribution } from './openapi.contribution'
import { CORE_PARAMETERS, CORE_SCHEMAS } from './openapi.schemas'
import type { OpenApiObjectMap } from './openapi.schemas'
import { asRecord, own } from './openapi.shape'

/** The security scheme this package contributes for a protected scrape endpoint. */
export const METRICS_SCHEME_NAME = 'BymaxMetricsAuth'

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
  const defined = new Set(declared)
  const missing = named.filter((name) => !defined.has(name))
  if (missing.length === 0) {
    return
  }

  throw bootError(
    `[BymaxCoreModule] openapi security names ${missing.length} scheme(s) that the document does ` +
      'not define. Declare them in openapi.securitySchemes, or drop the requirement; schemes ' +
      'lists the ones named and declaredSchemes the ones the document defines.',
    { schemes: missing, declaredSchemes: declared }
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
  const declaredByDocument = Object.keys(asRecord(own(components, 'securitySchemes'))).includes(
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
 * Build the component members of the document to serve.
 *
 * @param components - The components the generated document already carries; not mutated.
 * @param options - The resolved core options.
 * @param contributions - What the libraries in this application contributed.
 * @returns The members to serve, and every contributed entry the document already declared.
 * @throws Error When a requirement names a scheme that is not defined, or the reserved scrape
 * scheme is already defined by someone else.
 */
export function assembleComponents(
  components: Readonly<Record<string, unknown>>,
  options: ResolvedCoreOptions,
  contributions: readonly ResolvedContribution[]
): {
  readonly merged: ReadonlyMap<string, unknown>
  readonly discarded: readonly DiscardedComponent[]
} {
  const { openapi } = options
  // Accumulated in a `Map`, converted once at the end. Component member names
  // reach this from contributors, and writing one onto an object is not merely
  // the shape an analyser flags: `Object.assign` invokes the target's
  // `__proto__` setter, so a member by that name would replace the prototype
  // instead of becoming an own component — and inherited entries would then
  // take part in the scheme validation below. A `Map` key cannot do that.
  const merged = new Map(Object.entries(components))

  // The catalogue is placed by the rule contributors are, and before them: a
  // placeholder under a catalogue name is filled by the package's own
  // definition, so a library offering the same name later meets a declaration
  // rather than a vacancy. A document that declared the name keeps it, and that
  // is not reported — the catalogue is not a contributor.
  if (openapi.includeCoreSchemas) {
    const keep = (): void => undefined
    // One literal names each member for the read, the rule and the write, so
    // the three cannot disagree about which member they mean.
    const catalogue = [
      ['schemas', CORE_SCHEMAS],
      ['parameters', CORE_PARAMETERS]
    ] as const
    for (const [member, entries] of catalogue) {
      merged.set(member, placeComponentEntries(merged.get(member), member, entries, keep))
    }
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
  const declaredSchemes = mergeAbsent(asRecord(own(components, 'securitySchemes')), {
    ...openapi.securitySchemes,
    ...scrapeScheme
  })
  if (Object.keys(declaredSchemes).length > 0) {
    merged.set('securitySchemes', declaredSchemes)
  }

  const discarded = mergeContributedComponents(merged, contributions)

  // Validated against everything the served document will define, libraries
  // included: rejecting a consumer for naming a scheme their own library
  // supplies would fail on the arrangement this lane exists to enable.
  assertSchemesDeclared(openapi, asRecord(merged.get('securitySchemes')))

  // Validated against everything the served document will define, libraries
  // included: rejecting a consumer for naming a scheme their own library
  // supplies would fail on the arrangement this lane exists to enable.
  assertSchemesDeclared(openapi, asRecord(merged.get('securitySchemes')))

  return { merged, discarded }
}
