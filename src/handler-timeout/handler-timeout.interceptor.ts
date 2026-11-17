/**
 * @fileoverview `BymaxHandlerTimeoutInterceptor`: bounds how long a request's handler may run,
 * answering `504` in the error envelope when it is exceeded.
 * @layer Utility
 */
import { GatewayTimeoutException, Inject, Injectable } from '@nestjs/common'
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { finalize, NEVER, throwError, timeout } from 'rxjs'
import type { Observable } from 'rxjs'

import type { ResolvedCoreOptions } from '../core.options'
import { BYMAX_CORE_OPTIONS } from '../core.tokens'
import { bindHandlerSignal, NO_HANDLER_TIMEOUT_KEY } from './handler-timeout.decorators'

/** The metadata key Nest's `@Sse()` sets on a route handler. */
const SSE_METADATA = '__sse__'

/** The parts of a request and a response this interceptor reads, on Express and on Fastify. */
interface RawResponse {
  readonly headersSent: boolean
  readonly writableEnded: boolean
  once(event: 'close', listener: () => void): unknown
  off(event: 'close', listener: () => void): unknown
  destroy(): unknown
}

/** Whether `path` is `prefix` or lies under it, at a segment boundary. */
function isUnder(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`)
}

/** Bounds a request's handler; see {@link HandlerTimeoutOptions}. */
@Injectable()
export class BymaxHandlerTimeoutInterceptor implements NestInterceptor {
  constructor(
    @Inject(BYMAX_CORE_OPTIONS) private readonly options: ResolvedCoreOptions,
    @Inject(Reflector) private readonly reflector: Reflector
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const { enabled, timeoutMs } = this.options.handlerTimeout
    if (!enabled || context.getType() !== 'http' || this.isExempt(context)) {
      return next.handle()
    }
    const http = context.switchToHttp()
    const response = http.getResponse<RawResponse & { raw?: RawResponse }>()
    const raw = response.raw ?? response
    const controller = new AbortController()
    bindHandlerSignal(http.getRequest<object>(), controller.signal)
    const onClose = (): void => {
      if (!raw.writableEnded) controller.abort(new Error('The client disconnected'))
    }
    raw.once('close', onClose)
    return next.handle().pipe(
      timeout({ first: timeoutMs, with: () => this.expire(controller, raw) }),
      finalize(() => raw.off('close', onClose))
    )
  }

  /** Abort the handler's signal, then answer 504, or cut the connection if the headers are out. */
  private expire(controller: AbortController, raw: RawResponse): Observable<never> {
    controller.abort(new GatewayTimeoutException('Handler timed out'))
    if (raw.headersSent) {
      raw.destroy()
      return NEVER
    }
    return throwError(() => new GatewayTimeoutException('The request took too long to answer'))
  }

  /** Whether the route is outside the bound: an SSE stream, a marked route, or an excluded path. */
  private isExempt(context: ExecutionContext): boolean {
    const handler = context.getHandler()
    if (this.reflector.get<boolean | undefined>(SSE_METADATA, handler) === true) return true
    if (
      this.reflector.getAllAndOverride<boolean | undefined>(NO_HANDLER_TIMEOUT_KEY, [
        handler,
        context.getClass()
      ]) === true
    )
      return true
    const request = context.switchToHttp().getRequest<{ originalUrl?: string; url?: string }>()
    const path = (request.originalUrl ?? request.url ?? '').split('?')[0] ?? ''
    return this.options.handlerTimeout.excludePaths.some((prefix) => isUnder(path, prefix))
  }
}
