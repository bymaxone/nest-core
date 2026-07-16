/**
 * @fileoverview Public barrel for the package root subpath. Ships the dynamic
 * module, its options surface, the DI tokens, the pluggable contracts, and the
 * error-code catalog. Internal registration helpers and no-op default classes
 * are intentionally not exported.
 * @layer public-api
 */

export { BymaxCoreModule } from './core.module'

export type {
  BymaxCoreModuleOptions,
  EnvelopeOptions,
  TimingOptions,
  HealthOptions,
  MetricsOptions,
  ResolvedCoreOptions
} from './core.options'

export {
  BYMAX_CORE_OPTIONS,
  BYMAX_CORRELATION_PROVIDER,
  BYMAX_TIMING_SINK,
  BYMAX_HEALTH_INDICATORS,
  BYMAX_METRICS_REGISTRY
} from './core.tokens'

export type { ICorrelationIdProvider } from './envelope/correlation.interfaces'

export { BymaxExceptionFilter } from './envelope/exception.filter'

export type { FilterErrorContext } from './envelope/exception.filter'

export { buildErrorEnvelope } from './envelope/error-envelope'

export type {
  ErrorEnvelope,
  ErrorDetails,
  BuildErrorEnvelopeInput
} from './envelope/error-envelope'

export type { ITimingSink, RequestTimingSample } from './timing/timing.interfaces'

export {
  BYMAX_BAD_GATEWAY,
  BYMAX_BAD_REQUEST,
  BYMAX_CLIENT_ERROR,
  BYMAX_CONFLICT,
  BYMAX_FORBIDDEN,
  BYMAX_GATEWAY_TIMEOUT,
  BYMAX_INTERNAL_ERROR,
  BYMAX_NOT_FOUND,
  BYMAX_NOT_IMPLEMENTED,
  BYMAX_PAYLOAD_TOO_LARGE,
  BYMAX_SERVICE_UNAVAILABLE,
  BYMAX_TOO_MANY_REQUESTS,
  BYMAX_UNAUTHORIZED,
  BYMAX_UNPROCESSABLE_ENTITY,
  BYMAX_UNSUPPORTED_MEDIA_TYPE,
  BYMAX_VALIDATION_FAILED,
  codeForStatus
} from './envelope/error-codes'
