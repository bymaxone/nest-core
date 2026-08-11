/**
 * @fileoverview Dependency-injection tokens for `@bymax-one/nest-core`.
 * Every token is a `Symbol`, so the container never collides with a consumer's
 * string tokens and the public contracts stay explicit at every injection site.
 *
 * Every token is minted with `Symbol.for`, never `Symbol()`. This package ships
 * one bundle per published subpath and the bundler inlines shared modules into
 * each of them, so this file exists once per bundle at runtime: a `Symbol()`
 * token would mint a *different* identity in `dist/index.cjs` than in
 * `dist/openapi/index.cjs`, and a provider registered from the package root
 * would be unreachable from a subpath that injects "the same" token. That is not
 * hypothetical — it is the 1.3.0 defect that made `applyBymaxOpenApi` throw on
 * every consumer boot. `Symbol.for` resolves through the runtime's global symbol
 * registry, so all copies converge on one identity no matter how many bundles
 * carry them. The same reasoning keeps the health marker's metadata key a
 * literal; see `health/health.marker.ts`.
 *
 * The registry keys below are therefore part of the package's public contract,
 * as binding as the export names: changing one is a breaking change even though
 * no signature moves. They are namespaced with the full npm package name because
 * the registry is process-global and shared with every other library in the
 * application — the package name is the one string guaranteed not to collide.
 *
 * The keys carry no version, which is a deliberate choice with a consequence
 * worth stating plainly. Every copy of this package loaded into one process
 * shares these identities, whatever its version. Within a major that is exactly
 * what is wanted: two resolved instances of the same major agree on the options
 * shape, so sharing one identity is what makes a duplicated install harmless
 * rather than broken. Across majors it is a hazard: a helper from one major
 * would resolve, without complaint, a snapshot registered by another whose shape
 * it does not know, and fail later on an undefined field instead of immediately
 * on an unresolvable token.
 *
 * So this belongs on the major-release checklist, not in a comment nobody reads
 * at the right moment: **a major that changes the resolved-options shape must
 * change these keys in the same commit.** Changing them is already a breaking
 * change, which is precisely why a major is the only place it can happen.
 * @layer Constants
 */

/**
 * Provide the resolved, deep-frozen {@link ResolvedCoreOptions} snapshot.
 * Consumers inject this to read the effective configuration after defaults.
 */
export const BYMAX_CORE_OPTIONS: unique symbol = Symbol.for('@bymax-one/nest-core:core-options')

/**
 * Provide the `ICorrelationIdProvider` used to stamp the current correlation id
 * onto error envelopes. Defaults to a no-op that returns `undefined`.
 */
export const BYMAX_CORRELATION_PROVIDER: unique symbol = Symbol.for(
  '@bymax-one/nest-core:correlation-provider'
)

/**
 * Provide the `ITimingSink` that receives one sample per completed request.
 * Defaults to a no-op sink.
 */
export const BYMAX_TIMING_SINK: unique symbol = Symbol.for('@bymax-one/nest-core:timing-sink')

/**
 * Provide the array of health indicators aggregated by the health endpoints.
 * Defaults to an empty array.
 */
export const BYMAX_HEALTH_INDICATORS: unique symbol = Symbol.for(
  '@bymax-one/nest-core:health-indicators'
)

/**
 * Provide the `prom-client` `Registry` backing the metrics endpoint. Bound
 * lazily and only when the metrics feature is enabled.
 */
export const BYMAX_METRICS_REGISTRY: unique symbol = Symbol.for(
  '@bymax-one/nest-core:metrics-registry'
)

/**
 * Provide the `ITraceContextProvider` that reads the active span's identifiers.
 * Bound on every path: the real reader when telemetry is enabled, a no-op that
 * resolves nothing otherwise.
 */
export const BYMAX_TRACE_CONTEXT: unique symbol = Symbol.for('@bymax-one/nest-core:trace-context')
