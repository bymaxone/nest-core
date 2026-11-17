/**
 * @fileoverview The options each block of `BymaxCoreModule` documents, as tables the compiler checks
 * against the interfaces: a block refuses any key that is not listed, so a table that lacked an
 * option would refuse it.
 * @layer Configuration
 */
import type {
  BodyDepthOptions,
  BymaxCoreModuleOptions,
  EnvelopeOptions,
  HealthOptions,
  MetricsOptions,
  TelemetryOptions,
  TimingOptions
} from './core.options'

/**
 * Each table is a `Record` over its interface's own keys, so the compiler rejects one that lacks an
 * option or lists an option the interface does not have: a new option cannot be added unlisted.
 */
export const ENVELOPE_KEYS = {
  enabled: 0,
  exposeInternals: 0,
  serverErrorWindowMs: 0
} satisfies Record<keyof EnvelopeOptions, 0>
export const TIMING_KEYS = { enabled: 0, slowRequestThresholdMs: 0 } satisfies Record<
  keyof TimingOptions,
  0
>
export const BODY_DEPTH_KEYS = { enabled: 0, maxDepth: 0 } satisfies Record<
  keyof BodyDepthOptions,
  0
>
export const HEALTH_KEYS = {
  enabled: 0,
  path: 0,
  indicatorTimeoutMs: 0,
  readinessCacheMs: 0,
  autoDiscover: 0,
  exposeIndicatorErrors: 0
} satisfies Record<keyof HealthOptions, 0>
export const METRICS_KEYS = {
  enabled: 0,
  path: 0,
  defaultLabels: 0,
  collectDefaultMetrics: 0,
  authToken: 0,
  edgeProtected: 0,
  scrapeTimeoutMs: 0
} satisfies Record<keyof MetricsOptions, 0>
export const TELEMETRY_KEYS = { enabled: 0, exposeTraceId: 0 } satisfies Record<
  keyof TelemetryOptions,
  0
>
export const OPTION_KEYS = {
  envelope: 0,
  timing: 0,
  bodyDepth: 0,
  health: 0,
  metrics: 0,
  handlerTimeout: 0,
  shutdown: 0,
  openapi: 0,
  telemetry: 0,
  environment: 0
} satisfies Record<keyof BymaxCoreModuleOptions, 0>
