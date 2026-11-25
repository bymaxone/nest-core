/**
 * @fileoverview `IdempotencyInterceptor`: makes a route that carries `@Idempotent` run once per
 * `Idempotency-Key` and replay its first answer afterwards.
 * @layer Utility
 */
import { HttpException, Inject, Injectable, Logger, RequestMethod } from '@nestjs/common'
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { from, mergeMap, Observable, of } from 'rxjs'

import { asHostError } from '../host-error'
import { writeLog } from '../write-log'
import {
  BYMAX_IDEMPOTENCY_IN_PROGRESS,
  BYMAX_IDEMPOTENCY_KEY_INVALID,
  BYMAX_IDEMPOTENCY_KEY_REQUIRED,
  BYMAX_IDEMPOTENCY_KEY_REUSED,
  BYMAX_IDEMPOTENCY_NOT_REPLAYABLE,
  BYMAX_IDEMPOTENCY_STORE_UNAVAILABLE
} from './idempotency.codes'
import { digest, fingerprint, validKey } from './idempotency.key'
import type { IdempotencyRequest, ResolvedIdempotentOptions } from './idempotency.options'
import { captureClientError, captureResult, replay, setReplyHeader } from './idempotency.response'
import type { ReplyLike } from './idempotency.response'
import { BYMAX_IDEMPOTENCY_STORE } from './idempotency.store'
import type { IdempotencyStoredResponse, IIdempotencyStore } from './idempotency.store'
import { IDEMPOTENT_OPTIONS } from './idempotency.support'

/** Nest's metadata keys, read as strings. */
const HTTP_CODE = '__httpCode__'
const METHOD = 'method'

/** What a client is told to wait, in seconds, while the first request is in progress. */
const RETRY_AFTER_SECONDS = 1

/** The parts of a request this interceptor reads, on Express and on Fastify. */
interface RequestLike extends IdempotencyRequest {
  readonly method?: string
  readonly originalUrl?: string
  readonly url?: string
  readonly body?: unknown
}

/** One request being intercepted. */
interface Call {
  readonly key: string
  readonly print: string
  readonly options: ResolvedIdempotentOptions
  readonly status: number
  readonly reply: ReplyLike
  readonly next: CallHandler
}

/** An error the envelope filter turns into `status` with `code` and `message`. */
function refusal(status: number, code: string, message: string): HttpException {
  return new HttpException({ code, message }, status)
}

/** Makes a route idempotent; see {@link Idempotent}. */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name)

  constructor(
    @Inject(BYMAX_IDEMPOTENCY_STORE) private readonly store: IIdempotencyStore,
    @Inject(Reflector) private readonly reflector: Reflector
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.get<ResolvedIdempotentOptions | undefined>(
      IDEMPOTENT_OPTIONS,
      context.getHandler()
    )
    if (options === undefined || context.getType() !== 'http') return next.handle()
    return from(this.admit(context, next, options)).pipe(mergeMap((answer) => answer))
  }

  /** Decide what the request does: run unprotected, refuse, replay, or run and keep the answer. */
  private async admit(
    context: ExecutionContext,
    next: CallHandler,
    options: ResolvedIdempotentOptions
  ): Promise<Observable<unknown>> {
    const http = context.switchToHttp()
    const request = http.getRequest<RequestLike>()
    const header = request.headers?.['idempotency-key']
    if (header === undefined) {
      if (options.required) {
        throw refusal(400, BYMAX_IDEMPOTENCY_KEY_REQUIRED, 'The Idempotency-Key header is required')
      }
      return next.handle()
    }
    if (validKey(header) === undefined) {
      throw refusal(400, BYMAX_IDEMPOTENCY_KEY_INVALID, 'The Idempotency-Key header is invalid')
    }
    const call: Call = {
      key: this.keyOf(request, header as string, options),
      print: this.printOf(request),
      options,
      status: this.statusOf(context),
      reply: http.getResponse<ReplyLike>(),
      next
    }
    return this.begin(call)
  }

  /** The hashed storage key: the scope, or the unscoped marker, and the header. */
  private keyOf(request: RequestLike, header: string, options: ResolvedIdempotentOptions): string {
    if (options.scope === undefined) return digest(['unscoped', header])
    let scope: unknown
    try {
      scope = options.scope(request)
    } catch (cause) {
      this.warn('CORE_IDEMPOTENCY_SCOPE_FAILED', 'The scope function threw', cause)
    }
    if (typeof scope !== 'string' || scope === '') {
      throw refusal(
        503,
        BYMAX_IDEMPOTENCY_STORE_UNAVAILABLE,
        'The idempotency scope is unavailable'
      )
    }
    return digest(['scoped', scope, header])
  }

  /** The request's fingerprint, refusing a body that cannot be represented whole. */
  private printOf(request: RequestLike): string {
    const [path, query] = splitOnce(request.originalUrl ?? request.url ?? '')
    try {
      return fingerprint({ method: request.method ?? '', path, query, body: request.body })
    } catch {
      throw refusal(400, BYMAX_IDEMPOTENCY_KEY_INVALID, 'The request body cannot be fingerprinted')
    }
  }

  /** The status Nest sends for a handler that returns: its `@HttpCode`, else 201 for POST, else 200. */
  private statusOf(context: ExecutionContext): number {
    const handler = context.getHandler()
    const declared = this.reflector.get<number | undefined>(HTTP_CODE, handler)
    if (declared !== undefined) return declared
    return this.reflector.get<number | undefined>(METHOD, handler) === RequestMethod.POST
      ? 201
      : 200
  }

  /** Claim the key, or answer from what holds it. */
  private async begin(call: Call): Promise<Observable<unknown>> {
    const { options, key, print } = call
    let result: Awaited<ReturnType<IIdempotencyStore['begin']>>
    try {
      result = await this.store.begin(key, print, options.leaseSeconds)
    } catch (cause) {
      if (options.required || options.onStoreError === 'fail-closed') {
        throw refusal(
          503,
          BYMAX_IDEMPOTENCY_STORE_UNAVAILABLE,
          'The idempotency store is unavailable'
        )
      }
      this.warn(
        'CORE_IDEMPOTENCY_STORE_FAILED',
        'The store failed; the handler runs unprotected',
        cause
      )
      return call.next.handle()
    }
    if (result.claimed) return this.run(call, result.token)
    return this.held(call, result.record)
  }

  /** What a key that is already held answers. */
  private held(
    call: Call,
    record: { fingerprint: string; state: string; response?: IdempotencyStoredResponse }
  ): Observable<unknown> {
    if (record.fingerprint !== call.print) {
      throw refusal(
        422,
        BYMAX_IDEMPOTENCY_KEY_REUSED,
        'The Idempotency-Key was used by a different request'
      )
    }
    if (record.state !== 'completed' || record.response === undefined) {
      setReplyHeader(call.reply, 'Retry-After', String(RETRY_AFTER_SECONDS))
      throw refusal(409, BYMAX_IDEMPOTENCY_IN_PROGRESS, 'A request with this key is in progress')
    }
    const { body } = record.response
    if (body === undefined) {
      throw refusal(
        409,
        BYMAX_IDEMPOTENCY_NOT_REPLAYABLE,
        'The first answer was too large to replay'
      )
    }
    return of(replay(record.response, body, call.reply))
  }

  /** Run the handler under the claim; keep its answer, or drop the claim when it has none to keep. */
  private run(call: Call, token: string): Observable<unknown> {
    return new Observable<unknown>((subscriber) => {
      let settled = false
      let value: unknown
      const subscription = call.next.handle().subscribe({
        next: (item) => {
          value = item
        },
        error: (error: unknown) => {
          settled = true
          void this.fail(call, token, error).then(() => subscriber.error(error))
        },
        complete: () => {
          settled = true
          const stored = captureResult(call.status, value, call.reply, call.options.maxBodyBytes)
          void this.keep(call, token, stored).then(() => {
            subscriber.next(value)
            subscriber.complete()
          })
        }
      })
      return () => {
        subscription.unsubscribe()
        if (settled) return
        settled = true
        void this.drop(call, token)
      }
    })
  }

  /** After a handler error: keep a replayable client error, drop the claim for anything else. */
  private async fail(call: Call, token: string, error: unknown): Promise<void> {
    const stored = call.options.storeClientErrors
      ? captureClientError(error, call.options.maxBodyBytes)
      : undefined
    if (stored === undefined) await this.drop(call, token)
    else await this.keep(call, token, stored)
  }

  /** Write the answer; a failure is logged and leaves the claim to its lease. */
  private async keep(call: Call, token: string, stored: IdempotencyStoredResponse): Promise<void> {
    try {
      await this.store.complete(call.key, token, stored, call.options.ttlSeconds)
    } catch (cause) {
      this.warn('CORE_IDEMPOTENCY_COMPLETE_FAILED', 'The answer could not be stored', cause)
    }
  }

  /** Give the claim back so the request can be retried; a failure is logged. */
  private async drop(call: Call, token: string): Promise<void> {
    try {
      await this.store.release(call.key, token)
    } catch (cause) {
      this.warn('CORE_IDEMPOTENCY_RELEASE_FAILED', 'The claim could not be released', cause)
    }
  }

  /** One log line; never the key, the header or the body. */
  private warn(event: string, message: string, cause: unknown): void {
    writeLog(this.logger, 'warn', { event, message, err: asHostError(cause) })
  }
}

/** The text before and after the first `?`. */
function splitOnce(url: string): [string, string] {
  const at = url.indexOf('?')
  return at < 0 ? [url, ''] : [url.slice(0, at), url.slice(at + 1)]
}
