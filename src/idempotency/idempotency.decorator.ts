/**
 * @fileoverview `@Idempotent`: marks a route as idempotent, validates its options at boot and documents the
 * `Idempotency-Key` header and its refusals for OpenAPI.
 * @layer Utility
 */
import { SetMetadata, UseInterceptors } from '@nestjs/common'

import { IdempotencyInterceptor } from './idempotency.interceptor'
import { resolveIdempotentOptions } from './idempotency.options'
import type { IdempotentOptions, ResolvedIdempotentOptions } from './idempotency.options'
import { assertSupportedHandler, IDEMPOTENT_OPTIONS } from './idempotency.support'

/** `@nestjs/swagger`'s metadata keys, written directly so the optional peer is never imported. */
const API_PARAMETERS = 'swagger/apiParameters'
const API_RESPONSE = 'swagger/apiResponse'

/** What each refusal means, for the document. */
const RESPONSES: ReadonlyArray<readonly [number, string]> = [
  [400, 'The Idempotency-Key header is invalid or, on a required route, missing'],
  [409, 'A request with this key is in progress, or its answer cannot be replayed'],
  [422, 'The Idempotency-Key was used by a different request'],
  [503, 'The idempotency store is unavailable']
]

/** Record the header and the refusals on the handler, leaving what the route already documents. */
function document(handler: object, options: ResolvedIdempotentOptions): void {
  const parameters = (Reflect.getMetadata(API_PARAMETERS, handler) ?? []) as unknown[]
  Reflect.defineMetadata(
    API_PARAMETERS,
    [
      ...parameters,
      {
        name: 'Idempotency-Key',
        in: 'header',
        required: options.required,
        schema: { type: 'string', minLength: 1, maxLength: 255 }
      }
    ],
    handler
  )
  const known = (Reflect.getMetadata(API_RESPONSE, handler) ?? {}) as Record<number, unknown>
  const added = Object.fromEntries(
    RESPONSES.filter(([status]) => !Object.hasOwn(known, status)).map(([status, description]) => [
      status,
      { description }
    ])
  )
  Reflect.defineMetadata(API_RESPONSE, { ...known, ...added }, handler)
}

/**
 * Make a route idempotent: a repeat of a request with the same `Idempotency-Key` header replays the first
 * answer instead of running the handler again.
 *
 * The module that declares the controller must provide `BYMAX_IDEMPOTENCY_STORE`. Write it above `@Sse`
 * and `@Render`: decorators apply bottom-up, and the boot check reads the metadata they set.
 *
 * @param options - A `scope` (or `unscoped: true`) and the optional lease, TTL and size bounds.
 * @returns A method decorator.
 * @throws Error At boot, on invalid options or a handler that writes its own response, streams, renders
 *   a view, or reads a multipart or raw body.
 */
export function Idempotent(options: IdempotentOptions): MethodDecorator {
  const resolved = resolveIdempotentOptions(options)
  return (target, key, descriptor) => {
    const handler = descriptor.value as object
    assertSupportedHandler(target.constructor, key, handler)
    SetMetadata(IDEMPOTENT_OPTIONS, resolved)(target, key, descriptor)
    UseInterceptors(IdempotencyInterceptor)(target, key, descriptor)
    document(handler, resolved)
  }
}
