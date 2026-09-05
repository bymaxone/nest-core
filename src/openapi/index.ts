/**
 * @fileoverview Public barrel for the `./openapi` subpath. Ships the bootstrap
 * helper and its result type, plus the contract a library implements to describe
 * its own routes in a consumer's document. The schema catalogue, the merge
 * rules, and the peer loader stay private, and keeping them so is what lets them
 * change without a major release.
 *
 * The contract sits here rather than on a subpath of its own, which is the
 * shape `./health` and `./metrics` take. Splitting it out later is an additive
 * change — a new subpath re-exported from this one — while merging two back into
 * one is not, so the reversible arrangement comes first. Revisit it when a
 * library that only contributes fragments finds this bundle's weight material.
 *
 * This subpath is separate from the package root so an application that never
 * documents its API never pays for the code that does.
 * @layer public-api
 */

export { applyBymaxOpenApi } from './openapi.bootstrap'

export type { OpenApiMountOutcome, OpenApiSkipReason } from './openapi.bootstrap'

// The merge module is private, and this one type is not: `OpenApiMountOutcome`
// carries it, so leaving it unexported would let a consumer read the list and
// not name its element — no function could take one, and no variable could be
// declared to hold one. Exporting the shape of a reported outcome does not
// export the rules that produced it.
export type { DiscardedComponent } from './openapi.document'

export {
  BymaxOpenApiContributor,
  BYMAX_OPENAPI_CONTRACT_VERSION,
  BYMAX_OPENAPI_CONTRIBUTOR_METADATA
} from './openapi.contract'

export type {
  IOpenApiContributor,
  OpenApiFragment,
  OpenApiFragmentObject,
  OpenApiHandlerKey
} from './openapi.contract'
