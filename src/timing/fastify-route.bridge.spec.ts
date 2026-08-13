/**
 * Unit tests for `bridgeFastifyRouteMetadata`.
 *
 * Layer: unit.
 * Goal: prove the hook is registered only on Fastify, that it carries the
 * resolved route metadata onto the raw request the middleware actually
 * receives, that it always continues the lifecycle, and that a hostile or
 * incomplete adapter makes it do nothing rather than throw during bootstrap.
 * Mocks: hand-built adapter and instance stubs, because what is under test is
 * the decision to register and what the hook writes — the real Fastify
 * integration is asserted end to end in `test/e2e/fastify.e2e-spec.ts`.
 */
import { bridgeFastifyRouteMetadata } from './fastify-route.bridge'
import type { HttpAdapterShape } from './fastify-route.bridge'

/** A captured `onRequest` hook plus the instance it was registered on. */
interface FakeInstance {
  addHook: jest.Mock
  hook(): (request: unknown, reply: unknown, done: () => void) => void
}

/** Build an instance stub that records the hook it is handed. */
function fakeInstance(): FakeInstance {
  const addHook = jest.fn()
  return {
    addHook,
    hook: () => addHook.mock.calls[0]?.[1] as never
  }
}

/** Build an adapter stub reporting the given type and instance. */
function fakeAdapter(type: string | undefined, instance: unknown): HttpAdapterShape {
  return {
    ...(type === undefined ? {} : { getType: (): string => type }),
    getInstance: (): unknown => instance
  }
}

describe('bridgeFastifyRouteMetadata', () => {
  /**
   * Only Fastify gets the hook.
   *
   * Express already exposes `req.route` on the object middleware receives, so
   * there is nothing to carry; an unknown adapter must not be poked at, and an
   * absent one — a module compiled without an application — must not throw.
   * The return value is what selects the route pattern in `configure`, so a
   * wrong answer here silently mis-mounts the recorder as well.
   */
  it.each([
    ['express', 'express'],
    ['an unknown adapter', 'ws'],
    ['an adapter reporting no type', undefined]
  ])('registers nothing on %s', (_case, type) => {
    const instance = fakeInstance()

    expect(bridgeFastifyRouteMetadata(fakeAdapter(type, instance))).toBe(false)
    expect(instance.addHook).not.toHaveBeenCalled()
  })

  /**
   * No adapter at all is not an error.
   *
   * `HttpAdapterHost` is injected optionally, so this receives `undefined`
   * whenever the module is built without an application around it.
   */
  it('registers nothing when there is no adapter', () => {
    expect(bridgeFastifyRouteMetadata(undefined)).toBe(false)
  })

  /**
   * A Fastify adapter whose instance cannot take hooks degrades quietly.
   *
   * The check is duck-typed because this package takes no dependency on
   * `fastify`, so it must tolerate an instance that does not look like one
   * rather than throwing during bootstrap — a crash at startup would be a worse
   * outcome than the missing route labels this bridge exists to restore.
   */
  it.each([
    ['a plain object', {}],
    ['null', null],
    ['undefined', undefined],
    ['a primitive', 'fastify'],
    ['a function without the hook', (): void => undefined]
  ])('registers nothing when the instance is %s', (_case, instance) => {
    expect(bridgeFastifyRouteMetadata(fakeAdapter('fastify', instance))).toBe(false)
  })

  /**
   * A callable instance carrying the hook is accepted.
   *
   * Frameworks do expose callable instances — Express's `app` is a function —
   * so narrowing on `typeof === 'object'` would reject one and silently leave
   * the bridge off, which is the failure mode this whole file exists to remove.
   * The check asks only whether the hook is there.
   */
  it('accepts a callable instance that can take hooks', () => {
    const addHook = jest.fn()
    const callable = Object.assign((): void => undefined, { addHook })

    expect(bridgeFastifyRouteMetadata(fakeAdapter('fastify', callable))).toBe(true)
    expect(addHook).toHaveBeenCalledTimes(1)
  })

  /**
   * On Fastify the hook is registered, on the lifecycle event that has the
   * route already resolved.
   *
   * `onRequest` and not a later event: Fastify matches the route before its
   * `onRequest` hooks run, so the template is available there even for a
   * request a guard rejects afterwards.
   */
  it('registers an onRequest hook on Fastify', () => {
    const instance = fakeInstance()

    expect(bridgeFastifyRouteMetadata(fakeAdapter('fastify', instance))).toBe(true)
    expect(instance.addHook).toHaveBeenCalledTimes(1)
    expect(instance.addHook.mock.calls[0]?.[0]).toBe('onRequest')
  })

  /**
   * The hook copies the resolved metadata onto the raw request.
   *
   * The raw request is what middie hands the middleware, and the reference is
   * assigned rather than a trimmed copy so anything else reading it is not
   * given a half-populated object.
   */
  it('puts the route metadata on the raw request', () => {
    const instance = fakeInstance()
    bridgeFastifyRouteMetadata(fakeAdapter('fastify', instance))
    const routeOptions = { url: '/items/:id' }
    const raw: Record<string, unknown> = {}
    const done = jest.fn()

    instance.hook()({ routeOptions, raw }, {}, done)

    expect(raw['routeOptions']).toBe(routeOptions)
    expect(done).toHaveBeenCalledTimes(1)
  })

  /**
   * Nothing to carry means nothing is written, and the request still proceeds.
   *
   * An unmatched request has no `routeOptions`, and that is the ordinary case
   * this whole feature exists to observe — the recorder turns its absence into
   * the bounded `<unmatched>` label. Writing `undefined` onto the raw request
   * instead would put a key there that reads as present.
   */
  it.each([
    ['nothing matched', { raw: {} as Record<string, unknown> }],
    ['there is no raw request', { routeOptions: { url: '/x' } }]
  ])('writes nothing when %s, and still calls done', (_case, request) => {
    const instance = fakeInstance()
    bridgeFastifyRouteMetadata(fakeAdapter('fastify', instance))
    const done = jest.fn()

    instance.hook()(request, {}, done)

    expect(Object.hasOwn((request as { raw?: object }).raw ?? {}, 'routeOptions')).toBe(false)
    expect(done).toHaveBeenCalledTimes(1)
  })
})
