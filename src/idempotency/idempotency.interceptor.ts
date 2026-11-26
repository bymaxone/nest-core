/**
 * @fileoverview `IdempotencyInterceptor`: makes a route that carries `@Idempotent` run once per
 * `Idempotency-Key` and replay its first answer afterwards.
 * @layer Utility
 */
import { HttpException, Inject, Injectable, Logger } from '@nestjs/common'
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
import { asOwner, insideOwner } from './idempotency.nesting'
import type { IdempotencyRequest, ResolvedIdempotentOptions } from './idempotency.options'
import { setReplyHeader, storable, streamed } from './idempotency.response'
import type { ReplyLike } from './idempotency.response'
import { BYMAX_IDEMPOTENCY_STORE } from './idempotency.store'
import type { IdempotencyStoredResponse, IIdempotencyStore } from './idempotency.store'
import { IDEMPOTENT_OPTIONS } from './idempotency.support'
import { rawOf, substitute, tap } from './idempotency.wire'
import type { Wire } from './idempotency.wire'

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
    const request = context.switchToHttp().getRequest<RequestLike>()
    const handler = context.getHandler()
    // A second registration on the route: the instance around this one holds the claim.
    if (insideOwner(request, handler)) return next.handle()
    const owned = asOwner(request, handler, next)
    return from(this.admit(context, owned, options)).pipe(mergeMap((answer) => answer))
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
      this.warn(
        { event: 'CORE_IDEMPOTENCY_SCOPE_FAILED', message: 'The scope function threw' },
        cause
      )
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
        {
          event: 'CORE_IDEMPOTENCY_STORE_FAILED',
          message: 'The store failed; the handler runs unprotected'
        },
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
    const stored = record.response
    if (stored.body === undefined) {
      throw refusal(409, BYMAX_IDEMPOTENCY_NOT_REPLAYABLE, 'The first answer cannot be replayed')
    }
    setReplyHeader(call.reply, 'Idempotent-Replayed', 'true')
    substitute(rawOf(call.reply), stored.status, stored.headers, stored.body)
    return of(undefined)
  }

  /** Run the handler under the claim; the answer the client is sent decides whether it is kept or given back. */
  private run(call: Call, token: string): Observable<unknown> {
    return new Observable<unknown>((subscriber) => {
      let value: unknown
      const subscription = call.next.handle().subscribe({
        next: (item) => {
          value = item
        },
        error: (error: unknown) => {
          this.watch(call, token, undefined, true)
          subscriber.error(error)
        },
        complete: () => {
          this.watch(call, token, value, false)
          subscriber.next(value)
          subscriber.complete()
        }
      })
      // The claim is not given back here: a promise handler still runs; the lease ends it.
      return () => subscription.unsubscribe()
    })
  }

  /**
   * Settle the claim with what the client is sent next. An answer already sent while the handler ran, such
   * as a request deadline's, is kept without a body when the handler then succeeded, because the handler
   * ran to its end; when it failed the claim is given back.
   */
  private watch(call: Call, token: string, value: unknown, failed: boolean): void {
    const raw = rawOf(call.reply)
    if (raw.headersSent) {
      const sent = { status: raw.statusCode, headers: {} }
      void (failed ? this.drop(call, token) : this.keep(call, token, sent))
      return
    }
    tap(raw, call.options.maxBodyBytes, streamed(value), (answer) =>
      this.settle(call, token, answer)
    )
  }

  /** Keep the answer that was sent, or give the claim back when it is not one to keep. */
  private async settle(call: Call, token: string, answer: Wire): Promise<void> {
    const stored = storable(answer, call.options.storeClientErrors)
    if (stored === undefined) {
      await this.drop(call, token)
      return
    }
    // Only a record the store accepted answers a repeat with 409, which is what the line reports.
    if ((await this.keep(call, token, stored)) && answer.overBound) {
      writeLog(this.logger, 'warn', {
        event: 'CORE_IDEMPOTENCY_BODY_TOO_LARGE',
        message: 'The answer is over maxBodyBytes and is not kept for replay'
      })
    }
  }

  /** Write the answer; a failure is logged and leaves the claim to its lease. */
  private async keep(
    call: Call,
    token: string,
    stored: IdempotencyStoredResponse
  ): Promise<boolean> {
    try {
      return await this.store.complete(call.key, token, stored, call.options.ttlSeconds)
    } catch (cause) {
      this.warn(
        { event: 'CORE_IDEMPOTENCY_COMPLETE_FAILED', message: 'The answer could not be stored' },
        cause
      )
      return false
    }
  }

  /** Give the claim back so the request can be retried; a failure is logged. */
  private async drop(call: Call, token: string): Promise<void> {
    try {
      await this.store.release(call.key, token)
    } catch (cause) {
      this.warn(
        { event: 'CORE_IDEMPOTENCY_RELEASE_FAILED', message: 'The claim could not be released' },
        cause
      )
    }
  }

  /** One log line; never the key, the header or the body. */
  private warn(entry: { event: string; message: string }, cause: unknown): void {
    writeLog(this.logger, 'warn', { ...entry, err: asHostError(cause) })
  }
}

/** The text before and after the first `?`. */
function splitOnce(url: string): [string, string] {
  const at = url.indexOf('?')
  return at < 0 ? [url, ''] : [url.slice(0, at), url.slice(at + 1)]
}
