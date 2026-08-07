/**
 * @fileoverview `BymaxExceptionFilter`, the outermost exception filter that
 * formats every error leaving an application into the stable {@link ErrorEnvelope}.
 * It reads the request path and method through the framework-agnostic
 * `HttpAdapter` accessors, so Express and Fastify behave identically, and it
 * targets HTTP execution contexts only: GraphQL and RPC contexts are rethrown
 * untouched (documented HTTP-first limitation).
 *
 * Three mapping rules apply, in order:
 *
 * 1. `HttpException` with an explicit `code` on its response object passes that
 *    domain code through verbatim, so the `BYMAX_` prefix stays reserved for
 *    codes this package emits.
 * 2. A validation-shaped `HttpException` (response carrying a `message` array,
 *    the form produced by Nest validation pipes) becomes
 *    `BYMAX_VALIDATION_FAILED` with one structured `details` entry per violation.
 * 3. Any other `HttpException` derives its code from the status via the shared
 *    catalog; anything that is not an `HttpException` collapses to a fixed,
 *    production-safe 500 that never leaks internals unless `exposeInternals` is
 *    on (development only).
 * @layer Filter
 */
import { Catch, HttpException, Inject, Optional } from '@nestjs/common'
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'

import type { ResolvedCoreOptions } from '../core.options'
import { BYMAX_CORE_OPTIONS, BYMAX_CORRELATION_PROVIDER, BYMAX_TRACE_CONTEXT } from '../core.tokens'
import { NoopCorrelationIdProvider } from '../defaults.providers'
import type { ICorrelationIdProvider } from './correlation.interfaces'
import { BYMAX_INTERNAL_ERROR, BYMAX_VALIDATION_FAILED, codeForStatus } from './error-codes'
import { buildErrorEnvelope } from './error-envelope'
import type { ErrorDetails, ErrorEnvelope } from './error-envelope'
import type { ITraceContextProvider } from '../telemetry/trace-context'
import { NoopTraceContextProvider } from '../telemetry/trace-context'

/** HTTP status used for the production-safe collapse of any unknown error. */
const INTERNAL_ERROR_STATUS = 500

/** Fixed, end-user-safe message for a collapsed unknown error. */
const INTERNAL_ERROR_MESSAGE = 'Internal server error'

/** Fixed, end-user-safe message for a validation failure; specifics live in details. */
const VALIDATION_FAILED_MESSAGE = 'Validation failed'

/**
 * Neutral view of the current request handed to {@link BymaxExceptionFilter}
 * mappers and to the {@link BymaxExceptionFilter.onUnexpectedError} seam. It
 * exposes only the framework-agnostic surface (path, method, correlation id,
 * trace id).
 */
export interface FilterErrorContext {
  /** HTTP method, read through the adapter (Express and Fastify neutral). */
  readonly method: string
  /** Request URL path, read through the adapter (Express and Fastify neutral). */
  readonly path: string
  /** Correlation id for the current request; absent when no provider resolves one. */
  readonly correlationId?: string
  /**
   * Trace the request ran under; absent when telemetry is off or nothing was
   * recording. Present here whatever `telemetry.exposeTraceId` says: the seam
   * feeds a logging pipeline, where the id is exactly what makes an error
   * findable, and only the response body is gated by that option.
   */
  readonly traceId?: string
}

/**
 * Extract an explicit domain `code` from an `HttpException` response object.
 *
 * @param response - The value returned by `HttpException.getResponse()`.
 * @returns The string `code` when the response object carries one, else `undefined`.
 */
function extractExplicitCode(response: string | object): string | undefined {
  if (typeof response !== 'object' || response === null || !('code' in response)) {
    return undefined
  }
  const code: unknown = (response as { code: unknown }).code
  return typeof code === 'string' ? code : undefined
}

/**
 * Detect the validation shape: an `HttpException` response object whose
 * `message` is an array, the form Nest validation pipes produce.
 *
 * @param response - The value returned by `HttpException.getResponse()`.
 * @returns `true` when the response carries an array of violations.
 */
function isValidationResponse(
  response: string | object
): response is { message: readonly unknown[] } {
  return (
    typeof response === 'object' &&
    response !== null &&
    'message' in response &&
    Array.isArray((response as { message: unknown }).message)
  )
}

/**
 * Translate a violation array into structured detail entries: a plain string
 * violation becomes `{ issue }`; an already-structured object is kept verbatim.
 *
 * @param violations - The array of constraint messages or objects.
 * @returns One structured detail entry per violation.
 */
function toValidationDetails(violations: readonly unknown[]): ErrorDetails {
  return violations.map((violation) =>
    typeof violation === 'string' ? { issue: violation } : violation
  )
}

/**
 * Extract the human-readable message from an `HttpException`.
 *
 * @param response - The value returned by `HttpException.getResponse()`.
 * @param exception - The exception, used as the fallback message source.
 * @returns The string message from the response, or the exception's own message.
 */
function extractHttpMessage(response: string | object, exception: HttpException): string {
  if (typeof response === 'string') {
    return response
  }
  if (typeof response === 'object' && response !== null && 'message' in response) {
    const message: unknown = (response as { message: unknown }).message
    if (typeof message === 'string') {
      return message
    }
  }
  return exception.message
}

/**
 * Build the development-only internals dump for a collapsed unknown error. The
 * original message is always captured; the stack is captured when present.
 *
 * @param exception - The original thrown value.
 * @returns The `{ message, stack? }` object surfaced only when `exposeInternals` is on.
 */
function buildInternalDetails(exception: unknown): ErrorDetails {
  if (exception instanceof Error) {
    return exception.stack !== undefined
      ? { message: exception.message, stack: exception.stack }
      : { message: exception.message }
  }
  return { message: String(exception) }
}

/**
 * Global exception filter emitting the stable error envelope. Registered as the
 * outermost `APP_FILTER` when the envelope feature is enabled, so it formats
 * every error that escapes a handler, including those thrown by other filters.
 */
@Catch()
export class BymaxExceptionFilter implements ExceptionFilter {
  /** Clock used to stamp the envelope timestamp; overridable in tests via fake timers. */
  private readonly now: () => Date = (): Date => new Date()

  /** The resolved correlation provider, or the no-op fallback when none is bound. */
  private readonly correlation: ICorrelationIdProvider

  /** The resolved trace-context provider, or the no-op fallback when none is bound. */
  private readonly traceContext: ITraceContextProvider

  /**
   * @param options - Resolved core options; drives the `exposeInternals` switch.
   * @param correlation - Provider resolving the current request's correlation id.
   *   Injected with `@Optional()`: `BymaxCoreModule` binds no local default for
   *   this token, so a consumer's own `BYMAX_CORRELATION_PROVIDER` binding
   *   (from their own, globally-visible module) is not shadowed by one; when
   *   nothing is bound, this falls back to a no-op that omits `correlationId`.
   * @param adapterHost - Host of the live HTTP adapter, resolved lazily per catch.
   */
  constructor(
    @Inject(BYMAX_CORE_OPTIONS) private readonly options: ResolvedCoreOptions,
    @Optional() @Inject(BYMAX_CORRELATION_PROVIDER) correlation: ICorrelationIdProvider | undefined,
    @Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost,
    @Optional() @Inject(BYMAX_TRACE_CONTEXT) traceContext?: ITraceContextProvider
  ) {
    this.correlation = correlation ?? new NoopCorrelationIdProvider()
    this.traceContext = traceContext ?? new NoopTraceContextProvider()
  }

  /**
   * Format the exception into the stable envelope and reply with it.
   *
   * Non-HTTP execution contexts (GraphQL, RPC) are out of scope and are
   * rethrown untouched so their own error handling applies.
   *
   * @param exception - The error that escaped the handler.
   * @param host - The arguments host for the current execution context.
   */
  /**
   * Resolve one optional annotation for the envelope, treating any failure as
   * "absent".
   *
   * Both annotations this filter attaches — the correlation id and the trace id
   * — come from providers it does not own: one is supplied by the consumer, the
   * other reads a third-party API. Their contracts say they do not throw, but
   * this filter is the last thing standing between an error and the client, and
   * a guarantee that depends on someone else's good behavior is not one. A
   * failed lookup costs an optional field; an unguarded one would cost the whole
   * response.
   *
   * The failure is deliberately silent, and the same reasoning applies as for
   * the {@link BymaxExceptionFilter.onUnexpectedError} seam a few lines below:
   * this runs while an error is already being formatted, so reporting a
   * telemetry failure here would replace the failure the caller actually needs
   * to see.
   *
   * @param read - The lookup to attempt.
   * @returns The resolved value, or `undefined` when absent or on failure.
   */
  private readAnnotation(read: () => string | undefined): string | undefined {
    try {
      return read()
    } catch {
      return undefined
    }
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      throw exception
    }
    const { httpAdapter } = this.adapterHost
    const ctx = host.switchToHttp()
    const request = ctx.getRequest<unknown>()
    const response = ctx.getResponse<unknown>()
    const correlationId = this.readAnnotation(() => this.correlation.getCorrelationId())
    const traceId = this.readAnnotation(() => this.traceContext.getTraceContext()?.traceId)
    const context: FilterErrorContext = {
      method: String(httpAdapter.getRequestMethod(request)),
      path: String(httpAdapter.getRequestUrl(request)),
      ...(correlationId !== undefined ? { correlationId } : {}),
      ...(traceId !== undefined ? { traceId } : {})
    }
    const envelope = this.buildEnvelope(exception, context)
    httpAdapter.reply(response, envelope, envelope.statusCode)
  }

  /**
   * Select the mapping rule for the exception and build its envelope. An
   * unknown error is handed to the observability seam before it collapses, so
   * an integration can record the original error with the request context.
   *
   * @param exception - The error that escaped the handler.
   * @param context - The neutral request context.
   * @returns The formatted envelope.
   */
  private buildEnvelope(exception: unknown, context: FilterErrorContext): ErrorEnvelope {
    if (exception instanceof HttpException) {
      return this.mapHttpException(exception, context)
    }
    try {
      this.onUnexpectedError(exception, context)
    } catch {
      // The observability hook must never break error formatting; a throwing
      // override is swallowed so the envelope is still delivered.
    }
    return this.mapUnknown(exception, context)
  }

  /**
   * Map an `HttpException` to the envelope. Explicit domain codes pass through;
   * the validation shape becomes `BYMAX_VALIDATION_FAILED` with structured
   * details; everything else derives its code from the status.
   *
   * @param exception - The HTTP exception to format.
   * @param context - The neutral request context.
   * @returns The formatted envelope.
   */
  private mapHttpException(exception: HttpException, context: FilterErrorContext): ErrorEnvelope {
    const status = exception.getStatus()
    const response = exception.getResponse()
    const explicitCode = extractExplicitCode(response)
    if (explicitCode !== undefined) {
      return this.toEnvelope(status, explicitCode, extractHttpMessage(response, exception), context)
    }
    if (isValidationResponse(response)) {
      return this.toEnvelope(
        status,
        BYMAX_VALIDATION_FAILED,
        VALIDATION_FAILED_MESSAGE,
        context,
        toValidationDetails(response.message)
      )
    }
    return this.toEnvelope(
      status,
      codeForStatus(status),
      extractHttpMessage(response, exception),
      context
    )
  }

  /**
   * Collapse an unknown error to the fixed, production-safe 500. The original
   * error is never serialized unless `exposeInternals` is on, in which case its
   * message and stack are attached to `details` (development only).
   *
   * @param exception - The original thrown value.
   * @param context - The neutral request context.
   * @returns The generic internal-error envelope.
   */
  private mapUnknown(exception: unknown, context: FilterErrorContext): ErrorEnvelope {
    const details = this.options.envelope.exposeInternals
      ? buildInternalDetails(exception)
      : undefined
    return this.toEnvelope(
      INTERNAL_ERROR_STATUS,
      BYMAX_INTERNAL_ERROR,
      INTERNAL_ERROR_MESSAGE,
      context,
      details
    )
  }

  /**
   * Assemble the envelope through the pure builder, threading the shared clock
   * and omitting absent optional details.
   *
   * @param statusCode - HTTP status for the envelope.
   * @param code - Stable machine-readable code.
   * @param message - Human-readable, end-user-safe message.
   * @param context - The neutral request context.
   * @param details - Optional structured context; omitted when absent.
   * @returns The formatted envelope.
   */
  private toEnvelope(
    statusCode: number,
    code: string,
    message: string,
    context: FilterErrorContext,
    details?: ErrorDetails
  ): ErrorEnvelope {
    return buildErrorEnvelope({
      statusCode,
      code,
      message,
      path: context.path,
      now: this.now,
      ...(details !== undefined ? { details } : {}),
      // Stryker disable next-line ConditionalExpression: equivalent — the always-spread form hands the builder `correlationId: undefined`, and `buildErrorEnvelope` re-guards `input.correlationId !== undefined` and omits an undefined value, so the emitted envelope is byte-for-byte identical whether or not a correlation id is present.
      ...(context.correlationId !== undefined ? { correlationId: context.correlationId } : {}),
      // Gated separately from the context above: the trace id reaches the
      // observability seam either way, and the response body only when the
      // operator opted into publishing it.
      // Stryker disable next-line ConditionalExpression: equivalent — same as the correlation id above. The always-spread form hands the builder `traceId: undefined`, which `buildErrorEnvelope` re-guards and omits. The call-site guard exists because `exactOptionalPropertyTypes` rejects an explicit `undefined` for an optional field, not because it changes the output.
      ...(this.options.telemetry.exposeTraceId && context.traceId !== undefined
        ? { traceId: context.traceId }
        : {})
    })
  }

  /**
   * Observability seam invoked for every unexpected (non-`HttpException`) error
   * before it collapses to the generic 500. The base implementation is a no-op:
   * this library owns no logger. An integration (for example
   * `@bymax-one/nest-logger`) subclasses the filter and overrides this to record
   * the original error with the current request context and correlation id.
   * Overrides must never throw and must never write to the response.
   *
   * @param _error - The original thrown value.
   * @param _context - The neutral request context.
   */
  protected onUnexpectedError(_error: unknown, _context: FilterErrorContext): void {
    // Intentionally empty: the base filter emits no logs. Subclasses override
    // this to forward the original error to a correlation-aware logging pipeline.
  }
}
