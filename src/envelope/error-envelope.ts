/**
 * @fileoverview The stable error-envelope contract and its pure builder. Every
 * error leaving a `@bymax-one/nest-core` application is serialized into this
 * shape, which is versioned with the package: adding an optional field is a
 * minor release, changing or removing a field is a major release. The builder
 * omits absent optional fields entirely so they never surface as `undefined`
 * keys in the serialized JSON.
 * @layer DTO
 */

/**
 * Structured error context attached to an envelope. Validation failures use the
 * array form (one entry per violation); the development-only internals dump uses
 * the object form. The contract keeps it deliberately open: array or object.
 */
export type ErrorDetails = readonly unknown[] | Readonly<Record<string, unknown>>

/**
 * The exact shape of every error response. Field presence is part of the
 * contract:
 *
 * - `statusCode`, `code`, `message`, `timestamp`, and `path` are always present.
 * - `details` is present only when structured context exists (validation issues
 *   or, in development, the collapsed internal error).
 * - `correlationId` is present only when a correlation provider resolves an id.
 * - `traceId` is present only when telemetry is enabled, a span was recording,
 *   and `telemetry.exposeTraceId` opted into publishing it.
 */
export interface ErrorEnvelope {
  /** HTTP status code of the response. Always present. */
  readonly statusCode: number
  /** Stable machine-readable code from the `BYMAX_*` catalog or a passed-through domain code. Always present. */
  readonly code: string
  /** Human-readable message, safe to show end users. Always present. */
  readonly message: string
  /** Structured context, such as validation issues. Present only when it exists. */
  readonly details?: ErrorDetails
  /** Correlation id for the current request. Present only when a provider resolves one. */
  readonly correlationId?: string
  /** Trace this request ran under. Present only when publishing it was opted into. */
  readonly traceId?: string
  /** ISO 8601 instant the error was formatted. Always present. */
  readonly timestamp: string
  /** Request URL path. Always present. */
  readonly path: string
}

/**
 * Primitive inputs the builder assembles into an {@link ErrorEnvelope}. The
 * clock is injected as `now` so callers (and tests) control the timestamp
 * without patching global time.
 */
export interface BuildErrorEnvelopeInput {
  /** HTTP status code of the response. */
  readonly statusCode: number
  /** Stable machine-readable code. */
  readonly code: string
  /** Human-readable, end-user-safe message. */
  readonly message: string
  /** Structured context. Omit when there is none; never pass `undefined`. */
  readonly details?: ErrorDetails
  /** Correlation id. Omit when none is bound; never pass `undefined`. */
  readonly correlationId?: string
  /** Trace id. Omit when absent or not opted into; never pass `undefined`. */
  readonly traceId?: string
  /** Request URL path. */
  readonly path: string
  /** Injectable clock; called once to stamp the ISO 8601 timestamp. */
  readonly now: () => Date
}

/**
 * Assemble an {@link ErrorEnvelope} from primitive inputs.
 *
 * Pure: the only side effect is calling `now()` once for the timestamp. Absent
 * optional fields (`details`, `correlationId`) are omitted from the returned
 * object rather than set to `undefined`, so `JSON.stringify` never emits them.
 *
 * @param input - The envelope fields plus the injectable clock.
 * @returns A fully-formed envelope with no `undefined`-valued keys.
 */
export function buildErrorEnvelope(input: BuildErrorEnvelopeInput): ErrorEnvelope {
  const base: ErrorEnvelope = {
    statusCode: input.statusCode,
    code: input.code,
    message: input.message,
    timestamp: input.now().toISOString(),
    path: input.path
  }
  return {
    ...base,
    ...(input.details !== undefined ? { details: input.details } : {}),
    ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
    ...(input.traceId !== undefined ? { traceId: input.traceId } : {})
  }
}
