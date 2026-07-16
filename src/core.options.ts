/**
 * @fileoverview Public configuration surface for `BymaxCoreModule` plus the
 * resolution pipeline that merges consumer options over the documented defaults
 * and deep-freezes the result. Every feature reads its effective configuration
 * from the resolved snapshot, never from the raw consumer input.
 * @layer Config
 */

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
}

/** Fully-resolved metrics options. */
export interface ResolvedMetricsOptions {
  enabled: boolean
  path: string
  collectDefaultMetrics: boolean
  defaultLabels: Record<string, string>
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
}

/** Default health route prefix. */
const DEFAULT_HEALTH_PATH = 'health'

/** Default per-indicator timeout in milliseconds. */
const DEFAULT_INDICATOR_TIMEOUT_MS = 5000

/** Default metrics route. */
const DEFAULT_METRICS_PATH = 'metrics'

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
    indicatorTimeoutMs: raw?.indicatorTimeoutMs ?? DEFAULT_INDICATOR_TIMEOUT_MS
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
    defaultLabels: { ...(raw?.defaultLabels ?? {}) }
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
    metrics: resolveMetrics(raw?.metrics)
  })
}

/** The deep-frozen resolution of an empty options input: every documented default. */
export const DEFAULT_CORE_OPTIONS: ResolvedCoreOptions = normalizeCoreOptions()
