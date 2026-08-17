/**
 * @fileoverview Reading a document whose types this package deliberately does
 * not assume.
 *
 * Everything here answers the same question in a different shape: what is
 * actually in a document written by `@nestjs/swagger`, by a consumer, or by a
 * test fixture — without importing the peer's `OpenAPIObject` and without a
 * laundering cast. Each reader is total: a malformed or absent member yields an
 * empty result rather than throwing, so no caller has to guard a shape it did
 * not produce.
 *
 * Shared rather than private to the merge because the merge is no longer the
 * only reader: the unsecured-operation report walks the same document, and two
 * copies of "how do you safely read a path item" would be two places for the
 * prototype-pollution discipline below to drift.
 * @layer Utility
 */

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

/**
 * The method keys a path item can carry an operation under, lowercase as the
 * specification writes them and as the peer emits them. Everything else in a
 * path item — `parameters`, `summary`, `$ref` — is not an operation and must be
 * left alone.
 */
export const OPERATION_METHODS: readonly string[] = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options',
  'trace'
]

/**
 * Narrow a document member to a record. A document produced by the peer always
 * has object-valued `components`, but this function is total anyway: an absent
 * or malformed member yields an empty record, so the merge below can never
 * throw on a shape it did not expect.
 *
 * @param value - The member to narrow.
 * @returns The value as a record, or an empty record when it is not one.
 */
export function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {}
  }
  return value as Readonly<Record<string, unknown>>
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
export function operationsOf(item: unknown): readonly (readonly [string, unknown])[] {
  return Object.entries(asRecord(item)).filter(([key]) => OPERATION_METHODS.includes(key))
}

/**
 * Build the `"<METHOD> <path>"` key addressing one operation.
 *
 * @param method - The lowercase method key from the path item.
 * @param path - The documented path.
 * @returns The operation key.
 */
export function operationKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`
}
