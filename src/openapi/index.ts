/**
 * @fileoverview Public barrel for the `./openapi` subpath. Ships the bootstrap
 * helper and its result type, and nothing else: the schema catalogue, the merge
 * rules, and the peer loader are implementation details, and keeping them
 * private is what lets them change without a major release.
 *
 * This subpath is separate from the package root so an application that never
 * documents its API never pays for the code that does.
 * @layer public-api
 */

export { applyBymaxOpenApi } from './openapi.bootstrap'

export type { OpenApiMountOutcome, OpenApiSkipReason } from './openapi.bootstrap'
