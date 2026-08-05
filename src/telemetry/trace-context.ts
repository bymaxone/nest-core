/**
 * @fileoverview Reading the active trace, and nothing else.
 *
 * When a tracer is running, every log line, error response and timing sample of
 * a request can carry the same identifiers, which is what turns three separate
 * signals into one story. This package reads those identifiers; it never starts
 * a span, never configures an SDK, and never installs an exporter. That belongs
 * to whatever instrumentation the operator already runs, and duplicating it here
 * would produce two spans per request.
 *
 * `@opentelemetry/api` is an optional peer, but unlike the other two it is read
 * on every request, so it cannot be imported lazily at the point of use. It is
 * loaded once while the module resolves and then held: the dynamic import runs
 * during bootstrap, and only when the feature is enabled.
 * @layer Provider
 */
import type * as Otel from '@opentelemetry/api'

import type { ResolvedCoreOptions } from '../core.options'
import { isMissingModuleError, missingPeerMessage } from '../optional-peer'

/** Guidance shown when the feature is enabled but the optional peer is absent. */
const MISSING_PEER_MESSAGE = missingPeerMessage('telemetry.enabled', '@opentelemetry/api')

/** The identifiers of the span a request is currently running under. */
export interface TraceContext {
  /** The trace this request belongs to, as a 32-character hex string. */
  readonly traceId: string
  /** The span currently active, as a 16-character hex string. */
  readonly spanId: string
}

/**
 * Resolves the current request's trace identifiers.
 *
 * Bound under `BYMAX_TRACE_CONTEXT`. Implementations must be cheap and must
 * never throw: they run on the error path and on the timing path, where a
 * failure would replace a real error with a telemetry one.
 */
export interface ITraceContextProvider {
  /**
   * Resolve the identifiers of the currently active span.
   *
   * @returns The active trace context, or `undefined` when nothing is traced.
   */
  getTraceContext(): TraceContext | undefined
}

/**
 * The provider used when the feature is off. Resolves nothing, so every consumer
 * simply omits the fields — the same shape as before the feature existed.
 */
export class NoopTraceContextProvider implements ITraceContextProvider {
  /**
   * Resolve no trace context.
   *
   * @returns Always `undefined`.
   */
  getTraceContext(): TraceContext | undefined {
    return undefined
  }
}

/**
 * The subset of `@opentelemetry/api` this package reads. Declared structurally,
 * and only over a type-only namespace import, so the lazily loaded module is
 * fully typed without a top-level runtime import that would defeat the
 * optional-peer contract.
 */
export interface OtelApiSurface {
  /**
   * The trace API, narrowed to the one call this package makes and the one
   * member it reads off the result. Narrow on purpose: it documents the whole
   * dependency, and it lets a test express an active span as a plain object
   * instead of implementing the peer's full `Span` interface.
   */
  readonly trace: {
    /**
     * The span currently active in the context.
     *
     * @returns The active span, or `undefined` when nothing is recording.
     */
    getActiveSpan(): { spanContext(): Otel.SpanContext } | undefined
  }
  /** Rejects the all-zero context the API returns when nothing is recording. */
  readonly isSpanContextValid: typeof Otel.isSpanContextValid
}

/**
 * Load `@opentelemetry/api` lazily through a dynamic import. A module-not-found
 * failure is rethrown as a descriptive boot error naming the package and the
 * install command, so enabling the feature without the peer fails fast instead
 * of surfacing on the first traced request.
 *
 * @returns The loaded `@opentelemetry/api` module.
 * @throws Error When `@opentelemetry/api` is not installed.
 */
export async function loadOtelApi(): Promise<OtelApiSurface> {
  try {
    return await import('@opentelemetry/api')
  } catch (cause) {
    if (isMissingModuleError(cause)) {
      throw new Error(MISSING_PEER_MESSAGE, { cause })
    }
    throw cause
  }
}

/**
 * Reads the active span through the loaded API.
 *
 * An invalid span context — the all-zero one the API returns when nothing is
 * recording — resolves to `undefined` rather than to a string of zeros, so
 * consumers can treat "no trace" as an absent field instead of filtering a
 * sentinel value.
 */
export class OtelTraceContextProvider implements ITraceContextProvider {
  /**
   * @param api - The loaded OpenTelemetry API surface.
   */
  constructor(private readonly api: OtelApiSurface) {}

  /**
   * Resolve the identifiers of the currently active span.
   *
   * @returns The active trace context, or `undefined` when no valid span is
   *   recording.
   */
  getTraceContext(): TraceContext | undefined {
    const span = this.api.trace.getActiveSpan()
    if (span === undefined) {
      return undefined
    }
    const spanContext = span.spanContext()
    if (!this.api.isSpanContextValid(spanContext)) {
      return undefined
    }
    return { traceId: spanContext.traceId, spanId: spanContext.spanId }
  }
}

/**
 * Resolve the provider bound under `BYMAX_TRACE_CONTEXT`: the real reader when
 * the feature is enabled, the no-op otherwise. The optional peer is loaded only
 * on the first branch, so a disabled application never resolves it.
 *
 * @param options - The resolved core options.
 * @returns The provider to bind.
 * @throws Error When the feature is enabled but the optional peer is absent.
 */
export async function resolveTraceContextProvider(
  options: ResolvedCoreOptions
): Promise<ITraceContextProvider> {
  if (!options.telemetry.enabled) {
    return new NoopTraceContextProvider()
  }
  return new OtelTraceContextProvider(await loadOtelApi())
}
