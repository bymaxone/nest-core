/**
 * @fileoverview The contract a library implements to describe its own routes in
 * the consumer's OpenAPI document, and the marker that makes it discoverable.
 *
 * It exists because a library cannot describe its own operations any other way.
 * Decorating them with `@nestjs/swagger` would load that peer in every
 * application importing the library, including the ones that never build a
 * document; and a consumer-side map keyed by path cannot work either, because a
 * library that mounts through `RouterModule.register` does not know its own
 * final paths — the same route is `/auth/login` in one deployment and
 * `/api/v2/identity/login` in another, from one build. So a contributor keys its
 * fragments on **handler identity**, which survives every prefix, version and
 * mount point, and `applyBymaxOpenApi` resolves those to the operations the scan
 * actually produced.
 *
 * A contributor returns data and mutates nothing. That is deliberate and it is
 * the difference from the metrics contract, which hands over a registry: the
 * merge here has to enforce precedence — a consumer's own declaration outranks a
 * library's — and it can only do that if the library's contribution arrives as a
 * value it can decline to write. It also means this package never learns what
 * any of it means. It merges OpenAPI objects; it does not know that one of them
 * is authentication.
 * @layer Contract
 */
import { SetMetadata } from '@nestjs/common'
import type { CustomDecorator } from '@nestjs/common'

/**
 * Addresses one route handler, as `'<ControllerClassName>.<methodName>'`.
 *
 * This is the key a library writes its fragments against, and it is a contract:
 * `@nestjs/swagger` hands the same pair to the operation-id factory this package
 * installs, so a fragment can be matched to the operation the scan produced
 * without either side reconstructing a path.
 *
 * Deliberately not the operation id itself. The id is whatever the ecosystem
 * already produces — `AuthController_login` by default — and a library keying on
 * it would break the moment a consumer supplied their own naming, while a
 * consumer changing that naming would silently unmatch every fragment.
 *
 * @example 'AuthController.login'
 * @example 'PasswordResetController.resetPassword'
 */
export type OpenApiHandlerKey = `${string}.${string}`

/**
 * A single OpenAPI object, copied into the document and never interpreted.
 * Modelled as an open record for the same reason the contributed schemas are: a
 * partial local model of the specification would be a second contract to keep in
 * sync with the real one.
 */
export type OpenApiFragmentObject = Readonly<Record<string, unknown>>

/**
 * What a contributor hands over: operation fragments addressed by handler, and
 * the components those fragments reference.
 *
 * The dialect is **OpenAPI 3.0**, which is what `@nestjs/swagger` produces —
 * measured, not assumed: its `DocumentBuilder` writes `openapi: '3.0.0'` and a
 * served document reports the same. A 3.1 fragment merged into a 3.0 document
 * produces one that validates as neither, so nullability belongs in `nullable`
 * rather than in a union type.
 */
export interface OpenApiFragment {
  /**
   * Operation objects to merge, keyed by the handler that produced the
   * operation. A key addressing a handler the document does not contain fails
   * the build naming the contributor: a fragment for a renamed handler is a
   * check that stopped running, which is worse than one that fails.
   */
  readonly operations?: Readonly<Record<OpenApiHandlerKey, OpenApiFragmentObject>>
  /**
   * Entries to merge under the document's `components`, keyed by member —
   * `schemas`, `securitySchemes`, `responses`, and so on. Additive: an entry the
   * document already defines under that name is kept.
   */
  readonly components?: Readonly<Record<string, Readonly<Record<string, OpenApiFragmentObject>>>>
}

/**
 * A library that describes its own routes in the document.
 *
 * Called once, while the document is being built, and only when the OpenAPI
 * feature is enabled — so a library implementing it costs an application that
 * never builds a document nothing beyond one metadata entry.
 */
export interface IOpenApiContributor {
  /**
   * Produce this library's fragments.
   *
   * Called after the application's options have resolved, so a contributor may
   * derive its contribution from its own configuration — which is the case that
   * makes this contract necessary rather than convenient. A library whose
   * credential names or transport are configurable cannot state its security
   * statically; only it can say what its resolved options mean.
   *
   * @returns The fragments to merge. Return an empty object to contribute
   *   nothing; throwing fails the document build with the contributor named.
   */
  contributeOpenApi(): OpenApiFragment
}

/**
 * Reflect metadata key carrying the contributor marker.
 *
 * A literal string rather than a key from `DiscoveryService.createDecorator()`,
 * which mints a random key per module load: this package ships one bundle per
 * subpath, so a library decorating its class through `./openapi` would get a
 * different key than the scan running from the package root and nothing would
 * ever be discovered. The same reasoning governs the health and metrics markers.
 * Namespaced so it cannot collide with a consumer's own metadata.
 */
export const BYMAX_OPENAPI_CONTRIBUTOR_METADATA = 'bymax-one:openapi-contributor'

/**
 * Mark a provider class as an OpenAPI contributor, so `applyBymaxOpenApi` finds
 * it without the application wiring anything.
 *
 * The class must implement {@link IOpenApiContributor}; a marked provider that
 * does not fails the document build with a message naming it, rather than being
 * skipped silently.
 *
 * @returns The class decorator carrying the marker.
 * @example
 *   \@BymaxOpenApiContributor()
 *   \@Injectable()
 *   export class AuthOpenApi implements IOpenApiContributor {
 *     constructor(private readonly options: ResolvedAuthOptions) {}
 *     contributeOpenApi(): OpenApiFragment {
 *       return {
 *         components: {
 *           securitySchemes: {
 *             authCookie: { type: 'apiKey', in: 'cookie', name: this.options.cookies.accessTokenName }
 *           }
 *         },
 *         operations: {
 *           'AuthController.login': { security: [] },
 *           'AuthController.refresh': { security: [{ refreshCookie: [] }] }
 *         }
 *       }
 *     }
 *   }
 */
export function BymaxOpenApiContributor(): CustomDecorator<string> {
  return SetMetadata(BYMAX_OPENAPI_CONTRIBUTOR_METADATA, true)
}
