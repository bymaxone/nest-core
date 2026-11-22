/**
 * @fileoverview The key under which the request deadline of `applyHttpFloors` leaves its signal on the
 * request, for `@HandlerSignal()` to read.
 * @layer Utility
 */

/**
 * A registered symbol, never a `Symbol()`: this package ships several bundles, each with its own copy of
 * every module, and the floors (which write the signal) and the decorator (which reads it) live in
 * different ones.
 */
export const DEADLINE_SIGNAL: unique symbol = Symbol.for(
  '@bymax-one/nest-core:request-deadline-signal'
) as never
