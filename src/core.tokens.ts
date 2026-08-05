/**
 * @fileoverview Dependency-injection tokens for `@bymax-one/nest-core`.
 * Every token is a `Symbol`, so the container never collides with a consumer's
 * string tokens and the public contracts stay explicit at every injection site.
 * @layer Constants
 */

/**
 * Provide the resolved, deep-frozen {@link ResolvedCoreOptions} snapshot.
 * Consumers inject this to read the effective configuration after defaults.
 */
export const BYMAX_CORE_OPTIONS: unique symbol = Symbol('BYMAX_CORE_OPTIONS')

/**
 * Provide the `ICorrelationIdProvider` used to stamp the current correlation id
 * onto error envelopes. Defaults to a no-op that returns `undefined`.
 */
export const BYMAX_CORRELATION_PROVIDER: unique symbol = Symbol('BYMAX_CORRELATION_PROVIDER')

/**
 * Provide the `ITimingSink` that receives one sample per completed request.
 * Defaults to a no-op sink.
 */
export const BYMAX_TIMING_SINK: unique symbol = Symbol('BYMAX_TIMING_SINK')

/**
 * Provide the array of health indicators aggregated by the health endpoints.
 * Defaults to an empty array.
 */
export const BYMAX_HEALTH_INDICATORS: unique symbol = Symbol('BYMAX_HEALTH_INDICATORS')

/**
 * Provide the `prom-client` `Registry` backing the metrics endpoint. Bound
 * lazily and only when the metrics feature is enabled.
 */
export const BYMAX_METRICS_REGISTRY: unique symbol = Symbol('BYMAX_METRICS_REGISTRY')

/**
 * Provide the `ITraceContextProvider` that reads the active span's identifiers.
 * Bound on every path: the real reader when telemetry is enabled, a no-op that
 * resolves nothing otherwise.
 */
export const BYMAX_TRACE_CONTEXT: unique symbol = Symbol('BYMAX_TRACE_CONTEXT')
