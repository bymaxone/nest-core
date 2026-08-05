/**
 * @fileoverview Pure document augmentation: given a generated OpenAPI document
 * and the resolved options, produce the document that will actually be served.
 *
 * Everything here is data in, data out, with no import of the optional peer, so
 * the merge rules are unit-testable without `@nestjs/swagger` installed and the
 * bootstrap helper is left with nothing but wiring.
 *
 * The merge is additive and never destructive: a contributed entry is written
 * only when the document has no entry under that name. A consumer who
 * deliberately documents a schema called `BymaxErrorEnvelope` means it, and
 * silently replacing their definition with this package's would be the kind of
 * surprise a documentation tool must never spring.
 * @layer Service
 */
import type { ResolvedOpenApiOptions } from '../core.options'
import { CORE_PARAMETERS, CORE_SCHEMAS } from './openapi.schemas'
import type { OpenApiObjectMap } from './openapi.schemas'

/**
 * The only structural requirement this module places on a document: it may
 * carry a `components` member, whose type it deliberately does not assume.
 * Staying this loose is what lets the augmentation run against the peer's own
 * `OpenAPIObject` without importing it and without a laundering cast — the
 * peer's interface satisfies this shape, and so does a plain test fixture.
 */
export interface OpenApiDocumentLike {
  /** The document's component registry, when it has one. */
  readonly components?: unknown
}

/** A document that has been through {@link augmentDocument}. */
export type AugmentedDocument<T> = T & { components: Readonly<Record<string, unknown>> }

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
 * Produce the document to serve: the generated one, plus the schemas and
 * parameters this package owns and the consumer's declared security schemes.
 *
 * Neither the input document nor the resolved options are mutated; the returned
 * document shares every untouched member with the original.
 *
 * @param document - The document generated from the application's controllers.
 * @param options - The resolved OpenAPI options.
 * @returns The augmented document.
 */
export function augmentDocument<T extends OpenApiDocumentLike>(
  document: T,
  options: ResolvedOpenApiOptions
): AugmentedDocument<T> {
  const components = asRecord(document.components)
  const merged: Record<string, unknown> = { ...components }

  if (options.includeCoreSchemas) {
    merged['schemas'] = mergeAbsent(asRecord(components['schemas']), CORE_SCHEMAS)
    merged['parameters'] = mergeAbsent(asRecord(components['parameters']), CORE_PARAMETERS)
  }

  const securitySchemeNames = Object.keys(options.securitySchemes)
  if (securitySchemeNames.length > 0) {
    merged['securitySchemes'] = mergeAbsent(
      asRecord(components['securitySchemes']),
      options.securitySchemes
    )
  }

  return { ...document, components: merged }
}
