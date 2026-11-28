/**
 * @fileoverview The two decorators of the handler timeout: one that exempts a route from it, and
 * one that hands a handler the signal aborted when its request ends early.
 * @layer Utility
 */
import { createParamDecorator, SetMetadata } from '@nestjs/common'
import type { CustomDecorator, ExecutionContext } from '@nestjs/common'

import { DEADLINE_SIGNAL } from '../request-deadline-signal'

/**
 * The metadata key {@link NoHandlerTimeout} sets and the interceptor reads. A string, never a symbol:
 * this package ships an ESM and a CJS build, and an application that loads both would otherwise hold
 * two different symbols, so a decorator from one build would be silently ignored by the interceptor
 * of the other.
 */
export const NO_HANDLER_TIMEOUT_KEY = 'bymax:no-handler-timeout'

/** The signal of the handler running for each request, held by the request object itself. */
const signals = new WeakMap<object, AbortSignal>()

/** Record the signal of the handler about to run for `request`. */
export function bindHandlerSignal(request: object, signal: AbortSignal): void {
  signals.set(request, signal)
}

/** The signal recorded for `request`, if the handler timeout applies to it. */
export function handlerSignalOf(request: object): AbortSignal | undefined {
  const deadline = Object.hasOwn(request, DEADLINE_SIGNAL)
    ? (request as Record<symbol, AbortSignal>)[DEADLINE_SIGNAL]
    : undefined
  const handler = signals.get(request)
  return deadline !== undefined && handler !== undefined
    ? AbortSignal.any([deadline, handler])
    : (deadline ?? handler)
}

/**
 * Exempt a controller or a route from the handler timeout: an upload, a long poll, a report. An
 * `@Sse()` route needs no marker; it is never bounded. It does not lift the `requestDeadline` of
 * `applyHttpFloors`: list such a route in its `excludePaths`.
 *
 * @returns The decorator, for a class or a method.
 */
export function NoHandlerTimeout(): CustomDecorator {
  return SetMetadata(NO_HANDLER_TIMEOUT_KEY, true)
}

/**
 * The signal of the request's handler, aborted when the handler timeout expires and when the client
 * goes away, so a handler can stop work done for nobody by passing it to a driver or an `await`.
 * `undefined` when neither the handler timeout nor a request deadline applies to the route.
 */
export const HandlerSignal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AbortSignal | undefined => {
    return handlerSignalOf(context.switchToHttp().getRequest<object>())
  }
)
