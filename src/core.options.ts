/**
 * @fileoverview Public configuration surface for `BymaxCoreModule` plus the
 * resolution pipeline that merges consumer options over the documented defaults
 * and deep-freezes the result. Every feature reads its effective configuration
 * from the resolved snapshot, never from the raw consumer input.
 * @layer Config
 */
import {
  BODY_DEPTH_KEYS,
  ENVELOPE_KEYS,
  HEALTH_KEYS,
  METRICS_KEYS,
  OPTION_KEYS,
  TELEMETRY_KEYS,
  TIMING_KEYS
} from './core.options.keys'
import { assertMetricsProtected } from './core.options.metrics-guard'
import { resolveOpenApi } from './core.options.openapi'
import { resolveHandlerTimeout } from './handler-timeout/handler-timeout.options'
import type {
  HandlerTimeoutOptions,
  ResolvedHandlerTimeoutOptions
} from './handler-timeout/handler-timeout.options'
import {
  booleanOption,
  checkedBlock,
  refusal,
  routeOption,
  stringOption
} from './option-validation'
import { MAX_TIMER_DELAY_MS, positiveSafeInteger } from './positive-integer'
import { DEFAULT_HEALTH_PATH, DEFAULT_METRICS_PATH } from './route-defaults'
import { resolveShutdown } from './shutdown/shutdown.options'
import type { ResolvedShutdownOptions, ShutdownOptions } from './shutdown/shutdown.options'

export { DEFAULT_HEALTH_PATH, DEFAULT_METRICS_PATH } from './route-defaults'

/** Error-envelope exception-filter configuration. */
export interface EnvelopeOptions {
  /** Register the global exception filter. Default: `true`. */
  enabled?: boolean
  /**
   * Include the original message and stack of unknown errors in the envelope
   * details, and keep the `details` of a 5xx `HttpException`, which are
   * otherwise withheld from the body. Never enable in production. Default: `false`.
   */
  exposeInternals?: boolean
  /**
   * How long, in milliseconds, repeats of the same server failure are withheld from the
   * unexpected-error sink after the first one is reported. Positive integer up to 2147483647.
   * Default: `60000`.
   *
   * A `5xx` `HttpException` is reported to the sink once per status and code, and the repeats inside
   * this window are counted and reported once when it ends. A dependency that is down fails every
   * request, and a report per request would be a log storm of its own.
   */
  serverErrorWindowMs?: number
}

/** Request-timing middleware configuration. */
export interface TimingOptions {
  /** Register the request-timing middleware (`BymaxTimingMiddleware`). Default: `true`. */
  enabled?: boolean
  /** Samples above this threshold are flagged as slow. Positive integer. No default (unset). */
  slowRequestThresholdMs?: number
}

/** Request-body nesting limit, applied before the application's own validation runs. */
export interface BodyDepthOptions {
  /**
   * Refuse a parsed request body nested deeper than {@link BodyDepthOptions.maxDepth} with a
   * `400` through the error envelope. Default: `false`.
   *
   * Off by default because turning it on rejects bodies that are accepted today. Enable it:
   * a body of a few thousand nested arrays is only a few kilobytes, and a recursive validator
   * or transformer overflows the stack on it, so the request is answered `500`, with no
   * credential needed. The check runs before routing, on the body the parser already produced, so it covers the Express adapter and a body parsed by
   * Nest's own parsers; it does not cover Fastify.
   */
  enabled?: boolean
  /**
   * The deepest nesting a body may have: `[[1]]` is depth 2, a flat object or array is depth 1,
   * and a scalar is depth 0. Must be a positive safe integer. Default: `32`.
   */
  maxDepth?: number
}

/** Liveness and readiness endpoint configuration. */
export interface HealthOptions {
  /** Register the health controller. Default: `true`. */
  enabled?: boolean
  /** Route prefix for the health endpoints. Default: `'health'`. */
  path?: string
  /**
   * Per-indicator timeout before a check is reported as down. Positive integer up to 2147483647.
   * Default: `5000`. `handlerTimeout.timeoutMs`, when enabled, bounds the health routes too: keep it
   * above this, or the probe answers `504` before a check is reported down.
   */
  indicatorTimeoutMs?: number
  /**
   * How long a finished readiness answer is reused, in milliseconds. `0` turns the cache off.
   * Default: `1000`.
   *
   * Readiness is usually reachable without credentials, and every probe would otherwise reach
   * every dependency. Probes that arrive while one is running always share it, whatever this is set to;
   * this is only how long its answer outlives it.
   */
  readinessCacheMs?: number
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
   * Serve what an indicator returned in `details`, and the failing indicator's
   * message under `details.error`, in the readiness response. Never enable in
   * production. Default: `false`.
   *
   * Readiness is typically unauthenticated and reachable by whatever probes it,
   * and an indicator usually does not author its own failure message — it lets a
   * driver's error propagate, and driver errors carry hosts, ports and sometimes
   * credentials. With this off, the response carries each indicator's name and
   * status and nothing else, except the timeout the aggregator itself reports;
   * the message goes to the logger, where access is already controlled.
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
 * One security requirement: scheme name to the scopes it needs, empty for a
 * scheme that takes none. An operation's requirements are alternatives — any
 * one of them satisfies it — so an empty *array* of requirements means the
 * operation needs no authentication at all, which is how the specification
 * expresses a public route that overrides a document-level default.
 */
export type OpenApiSecurityRequirement = Readonly<Record<string, readonly string[]>>

/** The HTTP methods an OpenAPI path item can carry an operation under. */
export type OpenApiHttpMethod =
  'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | 'TRACE'

/**
 * Addresses one operation in the generated document, as `"<METHOD> <path>"`.
 *
 * This format is a documented contract, not an implementation detail: a sibling
 * library may ship a plain-data map of its own operations keyed this way, so a
 * consumer spreads it into {@link OpenApiOptions.operationSecurity} instead of
 * restating which of that library's routes are public. Import the type to get
 * that map checked at the library's own compile time.
 *
 * The method is uppercase, one space separates the two parts, and the path is
 * written **exactly as it appears in the generated document**: leading slash,
 * OpenAPI template braces (`/users/{id}`), no trailing slash, and including any
 * global prefix the application sets. That last part is the one that surprises:
 * `@nestjs/swagger` includes `app.setGlobalPrefix('api')` in the documented
 * paths, so the key is `'POST /api/auth/login'` in an application that sets one.
 * A library shipping such a map should therefore expose a *function* taking the
 * prefix rather than a frozen constant — the call site is the only place that
 * knows it.
 *
 * @example 'GET /users/{id}'
 * @example 'POST /api/auth/login'
 */
export type OpenApiOperationKey = `${OpenApiHttpMethod} /${string}`

/**
 * Per-operation security requirements, keyed by {@link OpenApiOperationKey}.
 * An empty array marks the operation public, overriding any document default.
 */
export type OperationSecurityMap = Readonly<
  Record<OpenApiOperationKey, readonly OpenApiSecurityRequirement[]>
>

/**
 * Names the operation a route handler produced, in the generated document.
 *
 * Matches `@nestjs/swagger`'s own factory signature so a consumer's existing one
 * can be handed over unchanged. This package installs a factory of its own to
 * learn which handler produced which operation — a contract a library keys its
 * contributed fragments against — and delegates the id string to this one when
 * it is set, so nothing an application already generates is renamed.
 *
 * @param controllerKey - The controller class name.
 * @param methodKey - The handler method name.
 * @param version - The route's version, when the application versions routes.
 * @returns The operation id to publish.
 */
export type OpenApiOperationIdFactory = (
  controllerKey: string,
  methodKey: string,
  version?: string
) => string

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
   * The requirement every operation carries unless it says otherwise, naming
   * schemes declared in {@link OpenApiOptions.securitySchemes}. Default: `[]`,
   * which documents nothing and leaves every operation as it was generated.
   *
   * Set this when most of the API is authenticated, and mark the exceptions
   * public through {@link OpenApiOptions.operationSecurity}. An operation that
   * already declares its own requirement is never overwritten.
   *
   * @example [{ cookieAuth: [] }]
   */
  security?: readonly OpenApiSecurityRequirement[]
  /**
   * Per-operation overrides of {@link OpenApiOptions.security}, keyed by
   * {@link OpenApiOperationKey}. An empty array marks that operation public.
   * Default: `{}`.
   *
   * A key matching no operation in the generated document is a configuration
   * error and fails the document build, naming the keys that do exist. Silence
   * would be worse: a route renamed out from under a stale key would quietly
   * inherit the document default and be documented as authenticated when it is
   * not, or the reverse.
   *
   * That check runs only when the document is built. With
   * {@link OpenApiOptions.enabled} false, or in a production runtime where the
   * feature is forced off, a stale key is not reported — refusing to boot a
   * service over a documentation setting it never serves would be the wrong
   * trade. The cost is that the error waits for an environment that has the
   * document switched on.
   *
   * @example
   *   {
   *     'POST /auth/login': [],
   *     'POST /auth/refresh': [{ refreshCookie: [] }]
   *   }
   */
  operationSecurity?: OperationSecurityMap
  /**
   * Name the operations in the generated document. Default: the format
   * `@nestjs/swagger` itself produces, `<ControllerKey>_<methodKey>`.
   *
   * Set it to control the ids a client generator will use. This package always
   * installs a factory of its own so it can learn which handler produced which
   * operation, and delegates to this one when it is set — so supplying it
   * changes the published ids, and leaving it unset changes nothing.
   */
  operationIdFactory?: OpenApiOperationIdFactory
  /**
   * Contribute the schemas this package owns — the error envelope, the health
   * response, and the pagination shapes — to the document's components, and
   * reference them from the operations that return them: the error envelope as
   * every operation's `default` response, and the health response on the health
   * endpoints this package registers. Default: `true`.
   *
   * The two halves are one switch because they are one decision. Referencing a
   * schema this package did not contribute would leave a dangling `$ref`, and a
   * document that resolves nowhere is worse than one that says less.
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
   * `Authorization: Bearer <token>` matching this value (the scheme is matched
   * case-insensitively; the token is compared in constant time) or it is refused
   * with `401`. When unset (the default) the endpoint is open, so a deployment that
   * exposes `/metrics` beyond a trusted network must either set this or protect the
   * route at its edge — the exposition otherwise publishes the route inventory and
   * `collectDefaultMetrics` process internals to any caller. Configuring this empty
   * or whitespace-only is rejected at boot rather than treated as unset, so a
   * mistyped secret fails loud instead of silently leaving the endpoint open.
   */
  authToken?: string
  /**
   * States that the scrape route is protected at the edge (a private network, an ingress rule, an
   * authenticating proxy), so an open endpoint in production is a decision and not an oversight.
   * Default: `false`.
   *
   * Enabling metrics in production with neither `authToken` nor this flag is refused at boot,
   * because the exposition publishes the route inventory and process internals to any caller. The
   * flag changes nothing else: it does not protect the route, it only records that something does.
   */
  edgeProtected?: boolean
  /**
   * How long a scrape waits for the metrics collection, in milliseconds. Positive integer up to
   * 2147483647. Default: `5000`.
   *
   * Concurrent scrapes share one collection. One still running after this long is left to finish,
   * because `prom-client` cannot cancel a collector, and every scrape answers `503` at once until it
   * settles. A contributor whose `collect()` never settles therefore makes `/metrics` answer `503`
   * for ever, which is visible, instead of holding every scrape open.
   *
   * `handlerTimeout.timeoutMs`, when enabled, bounds the scrape route too: keep it above this, or a
   * slow scrape answers `504` in place of this `503`.
   */
  scrapeTimeoutMs?: number
}

/**
 * Consumer-facing options for `BymaxCoreModule.forRoot` / `forRootAsync`. Every
 * block is optional; omitted values fall back to the documented defaults.
 */
export interface BymaxCoreModuleOptions {
  /** Error-envelope exception filter. Default: enabled. */
  envelope?: EnvelopeOptions
  /** Request-timing middleware. Default: enabled. */
  timing?: TimingOptions
  /** Request-body nesting limit. Default: disabled. */
  bodyDepth?: BodyDepthOptions
  /** Liveness and readiness endpoints. Default: enabled. */
  health?: HealthOptions
  /** Prometheus metrics endpoint. Default: disabled. */
  metrics?: MetricsOptions
  /** Bound on how long a request's handler may run. Default: disabled. */
  handlerTimeout?: HandlerTimeoutOptions
  /** An overall bound on how long the process may take to stop. Default: none. */
  shutdown?: ShutdownOptions
  /** OpenAPI document and UI. Default: disabled, and never served in production. */
  openapi?: OpenApiOptions
  /** Trace correlation. Default: disabled. */
  telemetry?: TelemetryOptions
  /**
   * The environment this deployment is running in, for the features that must
   * never exist outside development — today, the OpenAPI document and its UI.
   *
   * **`NODE_ENV` always wins.** This is consulted only when the process
   * declares nothing: `NODE_ENV` unset, or set to whitespace. It cannot make a
   * runtime that identified itself as production serve the document, and no
   * value here overrides one there.
   *
   * Set it when your application validates its own environment variable — an
   * `APP_ENV` your config schema parses — and does not also set `NODE_ENV`.
   * Without it, that deployment is classified as production because absence was
   * the only evidence available, and the document is refused in an environment
   * that never asked for the refusal.
   *
   * Recognized non-production values are `development` and `test`, compared
   * case-insensitively and ignoring surrounding whitespace. Anything else,
   * including an unrecognized name, is production.
   *
   * @example 'development'
   */
  environment?: string
}

/** Fully-resolved envelope options. */
export interface ResolvedEnvelopeOptions {
  enabled: boolean
  exposeInternals: boolean
  serverErrorWindowMs: number
}

/** Fully-resolved timing options. `slowRequestThresholdMs` stays absent when unset. */
export interface ResolvedTimingOptions {
  enabled: boolean
  slowRequestThresholdMs?: number
}

/** Fully-resolved body-depth options. */
export interface ResolvedBodyDepthOptions {
  enabled: boolean
  maxDepth: number
}

/** Fully-resolved health options. */
export interface ResolvedHealthOptions {
  enabled: boolean
  path: string
  indicatorTimeoutMs: number
  readinessCacheMs: number
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
  scrapeTimeoutMs: number
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
  security: readonly OpenApiSecurityRequirement[]
  operationSecurity: OperationSecurityMap
  operationIdFactory?: OpenApiOperationIdFactory
  includeCoreSchemas: boolean
}

/**
 * The effective, defaults-applied configuration exposed under
 * `BYMAX_CORE_OPTIONS`. Fields with a documented default are always present.
 * Two fields have no default and are absent unless the consumer supplies them:
 * `timing.slowRequestThresholdMs`, and `environment`.
 */
export interface ResolvedCoreOptions {
  envelope: ResolvedEnvelopeOptions
  timing: ResolvedTimingOptions
  bodyDepth: ResolvedBodyDepthOptions
  health: ResolvedHealthOptions
  metrics: ResolvedMetricsOptions
  handlerTimeout: ResolvedHandlerTimeoutOptions
  shutdown: ResolvedShutdownOptions
  openapi: ResolvedOpenApiOptions
  telemetry: ResolvedTelemetryOptions
  /**
   * The environment the application declared, carried through so the bootstrap
   * helper classifies the runtime from the same two inputs the resolver did.
   * Absent when the application declared none.
   */
  environment?: string
}

/** Default per-indicator timeout in milliseconds. */
const DEFAULT_INDICATOR_TIMEOUT_MS = 5000

/** The default {@link MetricsOptions.scrapeTimeoutMs}. */
const DEFAULT_SCRAPE_TIMEOUT_MS = 5000

/** The default {@link EnvelopeOptions.serverErrorWindowMs}. */
const DEFAULT_SERVER_ERROR_WINDOW_MS = 60_000

/** The default {@link HealthOptions.readinessCacheMs}. */
const DEFAULT_READINESS_CACHE_MS = 1000

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
function resolveEnvelope(given: unknown): ResolvedEnvelopeOptions {
  const raw = checkedBlock<EnvelopeOptions>('envelope', given, ENVELOPE_KEYS)
  return {
    enabled: booleanOption('envelope.enabled', raw?.enabled, true),
    exposeInternals: booleanOption('envelope.exposeInternals', raw?.exposeInternals, false),
    serverErrorWindowMs: positiveSafeInteger(
      'envelope.serverErrorWindowMs',
      raw?.serverErrorWindowMs ?? DEFAULT_SERVER_ERROR_WINDOW_MS,
      MAX_TIMER_DELAY_MS
    )
  }
}

/**
 * Resolve timing options against their defaults. `slowRequestThresholdMs` is
 * only present when the consumer supplied it, honoring exact optional typing.
 *
 * @param raw - The consumer timing block, if any.
 * @returns The fully-populated timing options.
 */
function resolveTiming(given: unknown): ResolvedTimingOptions {
  const raw = checkedBlock<TimingOptions>('timing', given, TIMING_KEYS)
  const enabled = booleanOption('timing.enabled', raw?.enabled, true)
  const threshold = raw?.slowRequestThresholdMs ?? undefined
  return threshold === undefined
    ? { enabled }
    : {
        enabled,
        slowRequestThresholdMs: positiveSafeInteger('timing.slowRequestThresholdMs', threshold)
      }
}

/** The default {@link BodyDepthOptions.maxDepth}. */
export const DEFAULT_MAX_BODY_DEPTH = 32

/**
 * Resolve body-depth options against their defaults, failing at boot on a limit that could
 * never admit a body or never refuse one.
 *
 * @param raw - The consumer bodyDepth block, if any.
 * @returns The fully-populated body-depth options.
 * @throws Error When `maxDepth` is not a positive safe integer.
 */
function resolveBodyDepth(given: unknown): ResolvedBodyDepthOptions {
  const raw = checkedBlock<BodyDepthOptions>('bodyDepth', given, BODY_DEPTH_KEYS)
  const maxDepth = positiveSafeInteger(
    'bodyDepth.maxDepth',
    raw?.maxDepth ?? DEFAULT_MAX_BODY_DEPTH
  )
  return { enabled: booleanOption('bodyDepth.enabled', raw?.enabled, false), maxDepth }
}

/**
 * Resolve health options against their defaults.
 *
 * @param raw - The consumer health block, if any.
 * @returns The fully-populated health options.
 */
function resolveHealth(given: unknown): ResolvedHealthOptions {
  const raw = checkedBlock<HealthOptions>('health', given, HEALTH_KEYS)
  const readinessCacheMs = raw?.readinessCacheMs ?? DEFAULT_READINESS_CACHE_MS
  if (!(
    typeof readinessCacheMs === 'number' &&
    Number.isSafeInteger(readinessCacheMs) &&
    readinessCacheMs >= 0
  )) {
    throw refusal('health.readinessCacheMs', 'a non-negative safe integer', readinessCacheMs)
  }
  return {
    readinessCacheMs,
    enabled: booleanOption('health.enabled', raw?.enabled, true),
    path: routeOption('health.path', raw?.path, DEFAULT_HEALTH_PATH),
    exposeIndicatorErrors: booleanOption(
      'health.exposeIndicatorErrors',
      raw?.exposeIndicatorErrors,
      false
    ),
    indicatorTimeoutMs: positiveSafeInteger(
      'health.indicatorTimeoutMs',
      raw?.indicatorTimeoutMs ?? DEFAULT_INDICATOR_TIMEOUT_MS,
      MAX_TIMER_DELAY_MS
    ),
    autoDiscover: booleanOption('health.autoDiscover', raw?.autoDiscover, false)
  }
}

/**
 * Normalize the scrape bearer token, failing closed on a misconfiguration.
 *
 * An absent token (`undefined`) is the documented open default. An explicitly
 * configured token that is empty or only whitespace is rejected rather than silently
 * treated as unset: a deployment that set `authToken` believing it had armed
 * authentication would otherwise publish its metrics to every caller. Security
 * configuration fails loud, at boot, not open. A non-empty token is kept verbatim —
 * it is an opaque secret, never trimmed.
 *
 * @param given - The consumer-supplied `authToken`, if any; `null` reads as unset.
 * @returns The bearer to enforce, or `undefined` when authentication is not configured.
 * @throws Error When a token is configured but empty or whitespace-only.
 */
function resolveMetricsAuthToken(given: unknown): string | undefined {
  const raw = stringOption('metrics.authToken', given, undefined)
  if (raw === undefined) {
    return undefined
  }
  if (raw.trim() === '') {
    throw new Error(
      '[BymaxCoreModule] "metrics.authToken" was configured empty or whitespace-only. Leave it ' +
        'unset to expose an open /metrics endpoint (protected at the edge), or set a non-empty ' +
        'bearer token to require credentialed scrapes.'
    )
  }
  return raw
}

/**
 * Resolve metrics options against their defaults. `defaultLabels` is cloned so
 * freezing the resolved snapshot never freezes a consumer-owned object.
 *
 * @param raw - The consumer metrics block, if any.
 * @param declaredEnvironment - The environment the application declared, used only where
 *   `NODE_ENV` declares nothing.
 * @returns The fully-populated metrics options.
 * @throws Error When `authToken` is configured empty or whitespace-only, or metrics are enabled in
 *   production with neither a token nor `edgeProtected`.
 */
function resolveMetrics(given: unknown, declaredEnvironment?: string): ResolvedMetricsOptions {
  const raw = checkedBlock<MetricsOptions>('metrics', given, METRICS_KEYS)
  const enabled = booleanOption('metrics.enabled', raw?.enabled, false)
  const edgeProtected = booleanOption('metrics.edgeProtected', raw?.edgeProtected, false)
  const authToken = resolveMetricsAuthToken(raw?.authToken)
  assertMetricsProtected({ enabled, edgeProtected }, authToken, declaredEnvironment)
  return {
    enabled,
    path: routeOption('metrics.path', raw?.path, DEFAULT_METRICS_PATH),
    collectDefaultMetrics: booleanOption(
      'metrics.collectDefaultMetrics',
      raw?.collectDefaultMetrics,
      true
    ),
    defaultLabels: resolveDefaultLabels(raw?.defaultLabels),
    scrapeTimeoutMs: positiveSafeInteger(
      'metrics.scrapeTimeoutMs',
      raw?.scrapeTimeoutMs ?? DEFAULT_SCRAPE_TIMEOUT_MS,
      MAX_TIMER_DELAY_MS
    ),
    ...(authToken !== undefined ? { authToken } : {})
  }
}

/** What Prometheus accepts as a label name. */
const LABEL_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/

/**
 * The static labels as an object this module owns, so freezing the snapshot never freezes the
 * consumer's.
 *
 * @throws Error When the labels are not an object, a name is not a Prometheus label name, or a value
 *   is not a string.
 */
function resolveDefaultLabels(given: unknown): Record<string, string> {
  if (given === undefined || given === null) return {}
  if (typeof given !== 'object' || Array.isArray(given)) {
    throw refusal('metrics.defaultLabels', 'an object', given)
  }
  return Object.fromEntries(
    Object.entries(given).map(([name, value]) => {
      if (!LABEL_NAME.test(name)) {
        throw new Error('metrics.defaultLabels has an invalid label name')
      }
      if (typeof value !== 'string')
        throw refusal(`metrics.defaultLabels.${name}`, 'a string', value)
      return [name, value]
    })
  ) as Record<string, string>
}

/**
 * Resolve telemetry options against their defaults.
 *
 * @param raw - The consumer telemetry block, if any.
 * @returns The fully-populated telemetry options.
 */
function resolveTelemetry(given: unknown): ResolvedTelemetryOptions {
  const raw = checkedBlock<TelemetryOptions>('telemetry', given, TELEMETRY_KEYS)
  return {
    enabled: booleanOption('telemetry.enabled', raw?.enabled, false),
    exposeTraceId: booleanOption('telemetry.exposeTraceId', raw?.exposeTraceId, false)
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
export function normalizeCoreOptions(given?: BymaxCoreModuleOptions): ResolvedCoreOptions {
  const raw = checkedBlock<BymaxCoreModuleOptions>('options', given, OPTION_KEYS)
  const environment = stringOption('environment', raw?.environment, undefined)
  return deepFreeze({
    envelope: resolveEnvelope(raw?.envelope),
    timing: resolveTiming(raw?.timing),
    bodyDepth: resolveBodyDepth(raw?.bodyDepth),
    health: resolveHealth(raw?.health),
    metrics: resolveMetrics(raw?.metrics, environment),
    handlerTimeout: resolveHandlerTimeout(raw?.handlerTimeout),
    shutdown: resolveShutdown(raw?.shutdown),
    openapi: resolveOpenApi(raw?.openapi, environment),
    telemetry: resolveTelemetry(raw?.telemetry),
    // Spread rather than assigned so an application that declared nothing has
    // no `environment` member at all, matching every other optional member on
    // this snapshot under `exactOptionalPropertyTypes`.
    ...(environment === undefined ? {} : { environment })
  })
}

/** The deep-frozen resolution of an empty options input: every documented default. */
export const DEFAULT_CORE_OPTIONS: ResolvedCoreOptions = normalizeCoreOptions()
