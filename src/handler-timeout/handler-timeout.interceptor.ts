/**
 * @fileoverview `BymaxHandlerTimeoutInterceptor`: bounds how long a request's handler may run,
 * answering `504` in the error envelope when it is exceeded.
 * @layer Utility
 */
import { GatewayTimeoutException, Inject, Injectable, Logger } from '@nestjs/common'
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Observable, Subscription } from 'rxjs'
import type { Observer, Subscriber } from 'rxjs'

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
  private readonly logger = new Logger(BymaxHandlerTimeoutInterceptor.name)

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
    return new Observable<unknown>((subscriber) =>
      this.run(subscriber, next, { raw, request: http.getRequest<object>(), timeoutMs })
    )
  }

  /**
   * Run the handler under the bound for one subscriber: answer 504 at the bound, release the handler
   * when the client goes away, and return the teardown.
   */
  private run(
    subscriber: Subscriber<unknown>,
    next: CallHandler,
    { raw, request, timeoutMs }: { raw: RawResponse; request: object; timeoutMs: number }
  ): () => void {
    const controller = new AbortController()
    bindHandlerSignal(request, controller.signal)
    const source = new Subscription()
    let expired = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const release = (): void => {
      clearTimeout(timer)
      raw.off('close', onClose)
      source.unsubscribe()
    }
    // A client that went away is owed no answer, and its handler is owed no more time.
    const onClose = (): void => {
      if (raw.writableEnded) return
      controller.abort(new Error('The client disconnected'))
      release()
    }
    raw.once('close', onClose)
    // The whole duration is bounded, not the time to a first value: an Observable that emits and
    // never completes leaves the request unanswered too.
    timer = setTimeout(() => {
      expired = true
      controller.abort(new GatewayTimeoutException('Handler timed out'))
      if (raw.headersSent) raw.destroy()
      else subscriber.error(new GatewayTimeoutException('The request took too long to answer'))
      // Held for one more bound, so an error the handler throws meanwhile is logged and not lost. The
      // hold is unreferenced: a process that closes its application must not wait for it to exit.
      timer = setTimeout(release, timeoutMs)
      timer.unref()
    }, timeoutMs)
    source.add(next.handle().subscribe(this.forwarding(subscriber, () => expired, release)))
    return () => {
      if (!expired) release()
    }
  }

  /**
   * The observer of the handler: it passes the handler's outcome on until the bound has answered,
   * and logs an error that comes after it.
   */
  private forwarding(
    subscriber: Subscriber<unknown>,
    expired: () => boolean,
    release: () => void
  ): Partial<Observer<unknown>> {
    return {
      next: (value): void => {
        if (!expired()) subscriber.next(value)
      },
      error: (error: unknown): void => {
        release()
        if (!expired()) subscriber.error(error)
        else
          this.logger.error({
            event: 'CORE_HANDLER_LATE_ERROR',
            message: this.afterTheBound(error)
          })
      },
      complete: (): void => {
        release()
        if (!expired()) subscriber.complete()
      }
    }
  }

  /** The line logged for an error the handler threw after the request was answered `504`. */
  private afterTheBound(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error)
    return `A handler threw after its request was answered 504: ${message}`
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
    const path = (request.originalUrl ?? request.url)?.split('?', 1)[0]
    return (
      path !== undefined &&
      this.options.handlerTimeout.excludePaths.some((prefix) => isUnder(path, prefix))
    )
  }
}
