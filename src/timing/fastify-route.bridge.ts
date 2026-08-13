/**
 * @fileoverview Carrying Fastify's resolved route template to the timing
 * middleware, which otherwise cannot see it.
 *
 * Nest runs middleware on Fastify through `@fastify/middie`, and middie invokes
 * it with the **raw** `IncomingMessage` rather than Fastify's request wrapper —
 * `runMiddie` calls `run(req.raw, reply.raw, next)`. It copies a fixed set of
 * conveniences onto that raw object first (`id`, `hostname`, `protocol`, `ip`,
 * `ips`, `log`, `query`, `body`) and `routeOptions` is not among them. So a
 * middleware on Fastify sees neither Express's `req.route` nor Fastify's
 * `req.routeOptions`, and every request — matched or not — would be labelled
 * `<unmatched>`.
 *
 * That is worse than having no route label: it destroys the per-route breakdown
 * *and* hides the scan signal the label exists for, because a flood of unmatched
 * probes becomes indistinguishable from ordinary traffic once everything shares
 * one label. The interceptor this middleware replaced did not have the problem,
 * since it read the request through `ExecutionContext`, which hands back the
 * wrapper.
 *
 * The bridge is one `onRequest` hook that puts the wrapper's `routeOptions` on
 * the raw request. Fastify matches the route before its `onRequest` hooks run,
 * so the template is already resolved there — including for a request a guard
 * later rejects. Hook order against middie's own does not matter: the recorder
 * reads the template when the connection closes, long after every `onRequest`
 * hook has run.
 *
 * Writing onto the raw request is the same move middie makes for its own
 * conveniences, and the real `routeOptions` reference is assigned rather than a
 * trimmed copy, so nothing else reading it is handed a half-populated object.
 * @layer Provider
 */

/** The part of a Fastify request this bridge reads. */
interface FastifyRequestShape {
  /** The route metadata Fastify resolved, absent when nothing matched. */
  routeOptions?: unknown
  /** The underlying Node request, which is what middleware actually receives. */
  raw?: Record<string, unknown>
}

/** The part of a Fastify instance this bridge touches. */
interface FastifyInstanceShape {
  /** Registers the lifecycle hook that carries the template across. */
  addHook(
    event: 'onRequest',
    handler: (request: FastifyRequestShape, reply: unknown, done: () => void) => void
  ): unknown
}

/** The part of the HTTP adapter this bridge needs to identify and reach Fastify. */
export interface HttpAdapterShape {
  /** `'express'`, `'fastify'`, or whatever a custom adapter reports. */
  getType?: () => string
  /** The underlying framework instance. */
  getInstance?: () => unknown
}

/**
 * Register the route-template bridge when the application runs on Fastify.
 *
 * A no-op on every other adapter, including when no adapter is resolvable yet:
 * Express already exposes `req.route` on the object middleware receives, so
 * there is nothing to carry, and an unknown adapter must not be poked at.
 *
 * @param adapter - The HTTP adapter, or `undefined` when none is bound.
 * @returns `true` when the hook was registered, `false` when nothing was needed.
 */
export function bridgeFastifyRouteMetadata(adapter: HttpAdapterShape | undefined): boolean {
  if (adapter?.getType?.() !== 'fastify') {
    return false
  }
  const instance = adapter.getInstance?.()
  if (!isFastifyInstance(instance)) {
    return false
  }
  instance.addHook('onRequest', (request, _reply, done) => {
    if (request.raw !== undefined && request.routeOptions !== undefined) {
      request.raw['routeOptions'] = request.routeOptions
    }
    done()
  })
  return true
}

/**
 * Narrow an unknown framework instance to the one method this bridge calls.
 *
 * Duck-typed rather than an `instanceof` check: this package takes no
 * dependency on `fastify`, and an adapter reporting `'fastify'` while exposing
 * no `addHook` should degrade to doing nothing rather than throwing during
 * bootstrap.
 *
 * @param instance - The framework instance the adapter returned.
 * @returns Whether the hook can be registered on it.
 */
function isFastifyInstance(instance: unknown): instance is FastifyInstanceShape {
  // One condition, not a `typeof === 'object'` guard in front of it: optional
  // chaining already absorbs `null` and `undefined`, and reading a property off
  // a primitive yields `undefined` rather than throwing. An object test would
  // also reject a *callable* instance, which is how some frameworks expose
  // theirs — Express's `app` is a function — and rejecting one would silently
  // disable the bridge instead of failing loudly.
  return typeof (instance as FastifyInstanceShape | undefined)?.addHook === 'function'
}
