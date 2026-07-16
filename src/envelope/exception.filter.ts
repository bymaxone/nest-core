/**
 * @fileoverview `BymaxExceptionFilter`, the outermost exception filter that
 * formats every error leaving an application into the stable {@link ErrorEnvelope}.
 * It reads the request path and method through the framework-agnostic
 * `HttpAdapter` accessors, so Express and Fastify behave identically, and it
 * targets HTTP execution contexts only: GraphQL and RPC contexts are rethrown
 * untouched (documented HTTP-first limitation). Codes come from the shared
 * `BYMAX_*` catalog; an `HttpException` whose response carries an explicit
 * `code` passes that domain code through verbatim, so the `BYMAX_` prefix stays
 * reserved for codes this package emits.
 * @layer Filter
 */
import { Catch, HttpException, Inject } from '@nestjs/common'
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'

import type { ResolvedCoreOptions } from '../core.options'
import { BYMAX_CORE_OPTIONS, BYMAX_CORRELATION_PROVIDER } from '../core.tokens'
import type { ICorrelationIdProvider } from './correlation.interfaces'
import { BYMAX_INTERNAL_ERROR, codeForStatus } from './error-codes'
import { buildErrorEnvelope } from './error-envelope'
import type { ErrorEnvelope } from './error-envelope'

/** HTTP status used for the production-safe collapse of any unknown error. */
const INTERNAL_ERROR_STATUS = 500

/** Fixed, end-user-safe message for a collapsed unknown error. */
const INTERNAL_ERROR_MESSAGE = 'Internal server error'

/** Neutral view of the current request, read through the HTTP adapter. */
interface RequestContext {
  /** HTTP method, read through the adapter (Express and Fastify neutral). */
  readonly method: string
  /** Request URL path, read through the adapter (Express and Fastify neutral). */
  readonly path: string
}

/**
 * Extract an explicit domain `code` from an `HttpException` response object.
 *
 * @param response - The value returned by `HttpException.getResponse()`.
 * @returns The string `code` when the response object carries one, else `undefined`.
 */
function extractExplicitCode(response: string | object): string | undefined {
  if (typeof response !== 'object' || !('code' in response)) {
    return undefined
  }
  const code: unknown = (response as { code: unknown }).code
  return typeof code === 'string' ? code : undefined
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
  if ('message' in response) {
    const message: unknown = (response as { message: unknown }).message
    if (typeof message === 'string') {
      return message
    }
  }
  return exception.message
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

  /**
   * @param options - Resolved core options; drives the `exposeInternals` switch.
   * @param correlation - Provider resolving the current request's correlation id.
   * @param adapterHost - Host of the live HTTP adapter, resolved lazily per catch.
   */
  constructor(
    @Inject(BYMAX_CORE_OPTIONS) private readonly options: ResolvedCoreOptions,
    @Inject(BYMAX_CORRELATION_PROVIDER) private readonly correlation: ICorrelationIdProvider,
    @Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost
  ) {}

  /**
   * Format the exception into the stable envelope and reply with it.
   *
   * Non-HTTP execution contexts (GraphQL, RPC) are out of scope and are
   * rethrown untouched so their own error handling applies.
   *
   * @param exception - The error that escaped the handler.
   * @param host - The arguments host for the current execution context.
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      throw exception
    }
    const { httpAdapter } = this.adapterHost
    const ctx = host.switchToHttp()
    const request = ctx.getRequest<unknown>()
    const response = ctx.getResponse<unknown>()
    const context: RequestContext = {
      method: String(httpAdapter.getRequestMethod(request)),
      path: String(httpAdapter.getRequestUrl(request))
    }
    const envelope = this.buildEnvelope(exception, context)
    httpAdapter.reply(response, envelope, envelope.statusCode)
  }

  /**
   * Select the mapping rule for the exception and build its envelope.
   *
   * @param exception - The error that escaped the handler.
   * @param context - The neutral request context.
   * @returns The formatted envelope.
   */
  private buildEnvelope(exception: unknown, context: RequestContext): ErrorEnvelope {
    if (exception instanceof HttpException) {
      return this.mapHttpException(exception, context)
    }
    return this.mapUnknown(context)
  }

  /**
   * Map an `HttpException` to the envelope: status and message from the
   * exception, code from an explicit `code` on the response object when present,
   * otherwise derived from the status via the shared catalog.
   *
   * @param exception - The HTTP exception to format.
   * @param context - The neutral request context.
   * @returns The formatted envelope.
   */
  private mapHttpException(exception: HttpException, context: RequestContext): ErrorEnvelope {
    const status = exception.getStatus()
    const response = exception.getResponse()
    const code = extractExplicitCode(response) ?? codeForStatus(status)
    return this.toEnvelope(status, code, extractHttpMessage(response, exception), context)
  }

  /**
   * Collapse an unknown (non-HTTP) error to the fixed, production-safe 500.
   *
   * @param context - The neutral request context.
   * @returns The generic internal-error envelope.
   */
  private mapUnknown(context: RequestContext): ErrorEnvelope {
    return this.toEnvelope(
      INTERNAL_ERROR_STATUS,
      BYMAX_INTERNAL_ERROR,
      INTERNAL_ERROR_MESSAGE,
      context
    )
  }

  /**
   * Assemble the envelope through the pure builder, threading the shared clock.
   *
   * @param statusCode - HTTP status for the envelope.
   * @param code - Stable machine-readable code.
   * @param message - Human-readable, end-user-safe message.
   * @param context - The neutral request context.
   * @returns The formatted envelope.
   */
  private toEnvelope(
    statusCode: number,
    code: string,
    message: string,
    context: RequestContext
  ): ErrorEnvelope {
    return buildErrorEnvelope({
      statusCode,
      code,
      message,
      path: context.path,
      now: this.now
    })
  }
}
