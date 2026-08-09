/**
 * @fileoverview Public configuration surface for `BymaxCoreModule` plus the
 * resolution pipeline that merges consumer options over the documented defaults
 * and deep-freezes the result. Every feature reads its effective configuration
 * from the resolved snapshot, never from the raw consumer input.
 * @layer Config
 */
import { isProductionRuntime } from './runtime.environment'

/** Error-envelope exception-filter configuration. */
export interface EnvelopeOptions {
  /** Register the global exception filter. Default: `true`. */
  enabled?: boolean
  /**
   * Include the original message and stack of unknown errors in the envelope
   * details. Never enable in production. Default: `false`.
   */
  exposeInternals?: boolean
}

/** Request-timing interceptor configuration. */
export interface TimingOptions {
  /** Register the timing interceptor. Default: `true`. */
  enabled?: boolean
  /** Samples above this threshold are flagged as slow. No default (unset). */
  slowRequestThresholdMs?: number
}

/** Liveness and readiness endpoint configuration. */
export interface HealthOptions {
  /** Register the health controller. Default: `true`. */
  enabled?: boolean
  /** Route prefix for the health endpoints. Default: `'health'`. */
  path?: string
  /** Per-indicator timeout before a check is reported as down. Default: `5000`. */
  indicatorTimeoutMs?: number
  /**
   * Aggregate every provider marked with `@BymaxHealthIndicator()`, anywhere in
   * the application, in addition to those registered under
   * `BYMAX_HEALTH_INDICATORS`. Default: `false`.
   *
   * Off by default because it changes which failures can take an application out
   * of rotation: a library the application merely imports gains the ability to
   * fail its readiness probe. That is exactly the point once it is on — the
   * dependency understands its own health better than the application does — but
   * it is a decision the application makes, not one it inherits.
   */
  autoDiscover?: boolean
  /**
   * Include the failing indicator's message in the readiness response under
   * `details.error`. Never enable in production. Default: `false`.
   *
   * Readiness is typically unauthenticated and reachable by whatever probes it,
   * and an indicator usually does not author its own failure message — it lets a
   * driver's error propagate, and driver errors carry hosts, ports and sometimes
   * credentials. With this off, the response names which indicator is down and
   * nothing else; the message goes to the logger, where access is already
   * controlled.
   */
  exposeIndicatorErrors?: boolean
}

/** One entry of the OpenAPI document's `servers` list. */
export interface OpenApiServerDescriptor {
  /** Absolute base URL the API is served from. */
  url: string
  /** Human-readable label for the server, shown in the UI's selector. */
  description?: string
}

/**
 * A single OpenAPI security scheme, kept as an open record rather than a closed
 * union. The specification allows several shapes (HTTP, API key, OAuth2, OpenID
 * Connect), each with its own required fields, and this package neither
 * validates nor interprets them: it copies them into the document's components
 * so the consumer's declaration reaches the UI unchanged.
 */
export type OpenApiSecurityScheme = Readonly<Record<string, unknown>>

/**
 * OpenAPI document configuration.
 *
 * The document and its UI are development-only. Enabling this in a production
 * runtime does not serve them: the resolver forces the feature off and records
 * why, and the bootstrap helper refuses to mount independently. See
 * {@link ResolvedOpenApiOptions.suppressedInProduction}.
 */
export interface OpenApiOptions {
  /**
   * Build and serve the OpenAPI document. Default: `false`. Ignored in a
   * production runtime, where the feature is always off.
   */
  enabled?: boolean
  /** Route the interactive UI is served from. Default: `'docs'`. */
  path?: string
  /** Route the raw JSON document is served from. Default: `'docs-json'`. */
  jsonPath?: string
  /** Document title. Default: `'API'`. */
  title?: string
  /** Document description. Default: `''`. */
  description?: string
  /** Document version, independent of the package version. Default: `'1.0.0'`. */
  version?: string
  /** Servers advertised by the document. Default: `[]`. */
  servers?: readonly OpenApiServerDescriptor[]
  /** Security schemes added to the document's components. Default: `{}`. */
  securitySchemes?: Readonly<Record<string, OpenApiSecurityScheme>>
  /**
   * Contribute the schemas this package owns — the error envelope, the health
   * response, and the pagination shapes — to the document's components.
   * Default: `true`.
   */
  includeCoreSchemas?: boolean
}

/** Trace-correlation configuration. */
export interface TelemetryOptions {
  /**
   * Read the active OpenTelemetry span and carry its identifiers into the
   * request-timing sample and, when {@link TelemetryOptions.exposeTraceId} is
   * set, the error envelope. Default: `false`.
   *
   * This package never creates a span, configures an SDK, or installs an
   * exporter: it reads what the instrumentation already running produces.
   */
  enabled?: boolean
  /**
   * Include `traceId` in the error-envelope body served to the client.
   * Default: `false`.
   *
   * A trace id is not a secret, but it is internal: published in a response it
   * tells a caller that a tracing backend exists and gives them an identifier
   * that correlates their request with everything else in that trace. Support
   * teams often want exactly that; the default is off so it is a decision rather
   * than a side effect. With this off, the identifiers still reach the timing
   * sample and, through it, the logs.
   */
  exposeTraceId?: boolean
}

/** Prometheus metrics endpoint configuration. */
export interface MetricsOptions {
  /** Register the metrics controller. Default: `false`. */
  enabled?: boolean
  /** Route for the metrics endpoint. Default: `'metrics'`. */
  path?: string
  /** Static labels added to every metric. Default: `{}`. */
  defaultLabels?: Record<string, string>
  /** Collect `prom-client` default process metrics. Default: `true`. */
  collectDefaultMetrics?: boolean
  /**
   * A bearer token the scrape endpoint requires. When set, a request must carry
   * `Authorization: Bearer <token>` matching this value (compared in constant
   * time) or it is refused with `401`. When unset (the default) the endpoint is
   * open, so a deployment that exposes `/metrics` beyond a trusted network must
   * either set this or protect the route at its edge — the exposition otherwise
   * publishes the route inventory and `collectDefaultMetrics` process internals
   * to any caller.
   */
  authToken?: string
}

/**
 * Consumer-facing options for `BymaxCoreModule.forRoot` / `forRootAsync`. Every
 * block is optional; omitted values fall back to the documented defaults.
 */
export interface BymaxCoreModuleOptions {
  /** Error-envelope exception filter. Default: enabled. */
  envelope?: EnvelopeOptions
  /** Request timing interceptor. Default: enabled. */
  timing?: TimingOptions
  /** Liveness and readiness endpoints. Default: enabled. */
  health?: HealthOptions
  /** Prometheus metrics endpoint. Default: disabled. */
  metrics?: MetricsOptions
  /** OpenAPI document and UI. Default: disabled, and never served in production. */
  openapi?: OpenApiOptions
  /** Trace correlation. Default: disabled. */
  telemetry?: TelemetryOptions
}

/** Fully-resolved envelope options. */
export interface ResolvedEnvelopeOptions {
  enabled: boolean
  exposeInternals: boolean
}

/** Fully-resolved timing options. `slowRequestThresholdMs` stays absent when unset. */
export interface ResolvedTimingOptions {
  enabled: boolean
  slowRequestThresholdMs?: number
}

/** Fully-resolved health options. */
export interface ResolvedHealthOptions {
  enabled: boolean
  path: string
  indicatorTimeoutMs: number
  exposeIndicatorErrors: boolean
  autoDiscover: boolean
}

/** Fully-resolved telemetry options. */
export interface ResolvedTelemetryOptions {
  enabled: boolean
  exposeTraceId: boolean
}

/** Fully-resolved metrics options. `authToken` stays absent when unset. */
export interface ResolvedMetricsOptions {
  enabled: boolean
  path: string
  collectDefaultMetrics: boolean
  defaultLabels: Record<string, string>
  authToken?: string
}

/** Fully-resolved OpenAPI options. */
export interface ResolvedOpenApiOptions {
  /**
   * Whether the document is actually served. This is the consumer's request
   * intersected with the runtime: it is always `false` in production, whatever
   * the consumer asked for.
   */
  enabled: boolean
  /**
   * `true` when the consumer asked for the document and the production guard
   * refused it. Carried in the snapshot so the bootstrap helper can tell "the
   * operator never wanted this" apart from "the operator wanted this and we
   * declined", and warn only in the second case.
   */
  suppressedInProduction: boolean
  path: string
  jsonPath: string
  title: string
  description: string
  version: string
  servers: readonly OpenApiServerDescriptor[]
  securitySchemes: Readonly<Record<string, OpenApiSecurityScheme>>
  includeCoreSchemas: boolean
}

/**
 * The effective, defaults-applied configuration exposed under
 * `BYMAX_CORE_OPTIONS`. Fields with a documented default are always present;
 * the only optional field is `timing.slowRequestThresholdMs`, which has no
 * default and is absent unless the consumer sets it.
 */
export interface ResolvedCoreOptions {
  envelope: ResolvedEnvelopeOptions
  timing: ResolvedTimingOptions
  health: ResolvedHealthOptions
  metrics: ResolvedMetricsOptions
  openapi: ResolvedOpenApiOptions
  telemetry: ResolvedTelemetryOptions
}

/**
 * Default health route prefix. Exported so the health controller factory can
 * fall back to the same default the options resolver applies, without
 * duplicating the literal.
 */
export const DEFAULT_HEALTH_PATH = 'health'

/** Default per-indicator timeout in milliseconds. */
const DEFAULT_INDICATOR_TIMEOUT_MS = 5000

/**
 * Default metrics route. Exported so the async registration path can register
 * the metrics controller at the same default the options resolver applies,
 * without duplicating the literal.
 */
export const DEFAULT_METRICS_PATH = 'metrics'

/** Default route for the interactive OpenAPI UI. */
const DEFAULT_OPENAPI_PATH = 'docs'

/** Default route for the raw OpenAPI JSON document. */
const DEFAULT_OPENAPI_JSON_PATH = 'docs-json'

/** Default OpenAPI document title. */
const DEFAULT_OPENAPI_TITLE = 'API'

/** Default OpenAPI document version, independent of the package version. */
const DEFAULT_OPENAPI_VERSION = '1.0.0'

/**
 * Recursively freeze an object graph so no consumer can mutate the resolved
 * configuration after the module is built.
 *
 * @param value - The value to freeze in place.
 * @returns The same value, now frozen along with every nested object.
 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) {
      deepFreeze(child)
    }
  }
  return value
}

/**
 * Resolve envelope options against their defaults.
 *
 * @param raw - The consumer envelope block, if any.
 * @returns The fully-populated envelope options.
 */
function resolveEnvelope(raw?: EnvelopeOptions): ResolvedEnvelopeOptions {
  return {
    enabled: raw?.enabled ?? true,
    exposeInternals: raw?.exposeInternals ?? false
  }
}

/**
 * Resolve timing options against their defaults. `slowRequestThresholdMs` is
 * only present when the consumer supplied it, honoring exact optional typing.
 *
 * @param raw - The consumer timing block, if any.
 * @returns The fully-populated timing options.
 */
function resolveTiming(raw?: TimingOptions): ResolvedTimingOptions {
  const enabled = raw?.enabled ?? true
  const threshold = raw?.slowRequestThresholdMs
  return threshold === undefined ? { enabled } : { enabled, slowRequestThresholdMs: threshold }
}

/**
 * Resolve health options against their defaults.
 *
 * @param raw - The consumer health block, if any.
 * @returns The fully-populated health options.
 */
function resolveHealth(raw?: HealthOptions): ResolvedHealthOptions {
  return {
    enabled: raw?.enabled ?? true,
    path: raw?.path ?? DEFAULT_HEALTH_PATH,
    exposeIndicatorErrors: raw?.exposeIndicatorErrors ?? false,
    indicatorTimeoutMs: raw?.indicatorTimeoutMs ?? DEFAULT_INDICATOR_TIMEOUT_MS,
    autoDiscover: raw?.autoDiscover ?? false
  }
}

/**
 * Resolve metrics options against their defaults. `defaultLabels` is cloned so
 * freezing the resolved snapshot never freezes a consumer-owned object.
 *
 * @param raw - The consumer metrics block, if any.
 * @returns The fully-populated metrics options.
 */
function resolveMetrics(raw?: MetricsOptions): ResolvedMetricsOptions {
  return {
    enabled: raw?.enabled ?? false,
    path: raw?.path ?? DEFAULT_METRICS_PATH,
    collectDefaultMetrics: raw?.collectDefaultMetrics ?? true,
    defaultLabels: { ...(raw?.defaultLabels ?? {}) },
    // An empty string is treated as unset: it would otherwise arm the check
    // against a bearer nobody can present, silently sealing the endpoint shut.
    ...(raw?.authToken !== undefined && raw.authToken !== '' ? { authToken: raw.authToken } : {})
  }
}

/**
 * Copy the consumer's server list into objects this module owns. Cloning is
 * what keeps the deep-freeze below from freezing a consumer-owned object, and
 * the field-by-field rebuild (rather than a spread) is what keeps an absent
 * `description` absent instead of present-and-`undefined`.
 *
 * @param raw - The consumer's server list, if any.
 * @returns An independently-owned copy, empty when none was supplied.
 */
function cloneServers(
  raw?: readonly OpenApiServerDescriptor[]
): readonly OpenApiServerDescriptor[] {
  return (raw ?? []).map((server) =>
    server.description === undefined
      ? { url: server.url }
      : { url: server.url, description: server.description }
  )
}

/**
 * Resolve OpenAPI options against their defaults, then intersect the consumer's
 * request with the runtime: in production the feature is off no matter what was
 * asked for, and the refusal is recorded rather than silently applied. This is
 * the first of the two independent production guards; the second lives in the
 * bootstrap helper, which never trusts this one.
 *
 * @param raw - The consumer OpenAPI block, if any.
 * @returns The fully-populated OpenAPI options.
 */
function resolveOpenApi(raw?: OpenApiOptions): ResolvedOpenApiOptions {
  const requested = raw?.enabled ?? false
  const production = isProductionRuntime()
  return {
    enabled: requested && !production,
    suppressedInProduction: requested && production,
    path: raw?.path ?? DEFAULT_OPENAPI_PATH,
    jsonPath: raw?.jsonPath ?? DEFAULT_OPENAPI_JSON_PATH,
    title: raw?.title ?? DEFAULT_OPENAPI_TITLE,
    description: raw?.description ?? '',
    version: raw?.version ?? DEFAULT_OPENAPI_VERSION,
    servers: cloneServers(raw?.servers),
    // Structured-cloned rather than shallow-copied: the values are
    // consumer-owned nested objects, and the deep-freeze below would otherwise
    // reach into them.
    securitySchemes: structuredClone(raw?.securitySchemes ?? {}),
    includeCoreSchemas: raw?.includeCoreSchemas ?? true
  }
}

/**
 * Resolve telemetry options against their defaults.
 *
 * @param raw - The consumer telemetry block, if any.
 * @returns The fully-populated telemetry options.
 */
function resolveTelemetry(raw?: TelemetryOptions): ResolvedTelemetryOptions {
  return {
    enabled: raw?.enabled ?? false,
    exposeTraceId: raw?.exposeTraceId ?? false
  }
}

/**
 * Merge consumer options over the documented defaults and deep-freeze the
 * result. Each feature block is resolved independently, so a partial input
 * never drops a sibling feature's defaults.
 *
 * @param raw - The consumer options, or `undefined` for all defaults.
 * @returns A fully-populated, deep-frozen options snapshot.
 */
export function normalizeCoreOptions(raw?: BymaxCoreModuleOptions): ResolvedCoreOptions {
  return deepFreeze({
    envelope: resolveEnvelope(raw?.envelope),
    timing: resolveTiming(raw?.timing),
    health: resolveHealth(raw?.health),
    metrics: resolveMetrics(raw?.metrics),
    openapi: resolveOpenApi(raw?.openapi),
    telemetry: resolveTelemetry(raw?.telemetry)
  })
}

/** The deep-frozen resolution of an empty options input: every documented default. */
export const DEFAULT_CORE_OPTIONS: ResolvedCoreOptions = normalizeCoreOptions()
