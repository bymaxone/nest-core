/**
 * @fileoverview Neutral request-info accessor for request timing. Reads the
 * HTTP method and the route template off a request without assuming Express or
 * Fastify, so `RequestTimingSample.route` always carries a bounded-cardinality
 * label instead of the raw URL.
 *
 * The bound is a security property, not a tidiness one. Requests that match no
 * route are exactly the ones a scanner produces, each at a different path, so a
 * label taken from the URL would mint one time series per probe — turning the
 * scrape endpoint into the most expensive route in the service and the metric
 * into the outage. Every unmatched request therefore shares one label.
 *
 * Dropping the raw-URL fallback bought a **second** guarantee that is worth
 * stating because it was a side effect rather than the intent, and anyone
 * weighing the fallback again would otherwise only re-weigh the cardinality
 * argument. The recorder is middleware mounted at `'/'`, and Express gives
 * mounted middleware a `req.url` relative to its mount point: under
 * `setGlobalPrefix('api')` a request to `/api` arrives as `/`, so a path read
 * there reports somewhere the caller never asked for. Nothing in this file
 * reads `req.url` any more — the only `.url` left is Fastify's
 * `routeOptions.url`, which is a template, not a path — so that class of bug
 * has nowhere to land. Reintroducing a path-derived label brings both problems
 * back, not just the cardinality one. If a raw path is ever genuinely needed,
 * the correct read is `req.originalUrl ?? req.url`: `originalUrl` is Express's
 * and carries the mount prefix, and the `??` covers an adapter that supplies
 * only `url`, where no mount trimmed it in the first place.
 * @layer Utility
 */
import type { ExecutionContext } from '@nestjs/common'

/**
 * The route label carried by every request that matched no route.
 *
 * A single constant rather than the request's own path, and exported rather
 * than inlined: it is the value an alert rule matches on to see a scan, so it
 * belongs to the contract and must not drift from what this package writes.
 * Reading `route="<unmatched>"` in a dashboard says what happened; an empty
 * label — which Prometheus treats as equivalent to no label at all — reads as
 * missing data and gets scrolled past, which for a signal whose purpose is to
 * be noticed is the same as not emitting it.
 */
export const UNMATCHED_ROUTE = '<unmatched>'

/** HTTP method and route template extracted from the current request. */
export interface RequestInfo {
  /** HTTP method, for example `"GET"`. Empty when the adapter reports none. */
  method: string
  /**
   * Route template, for example `"/invoices/:id"`, or {@link UNMATCHED_ROUTE}
   * when the request matched no route at all.
   */
  route: string
}

/** Structural shape of an Express request's route metadata. */
interface ExpressRouteShape {
  route?: { path?: string }
  baseUrl?: string
}

/** Structural shape of a Fastify request's route metadata. */
interface FastifyRouteShape {
  routeOptions?: { url?: string }
}

/** Structural shape shared by both frameworks for the method. */
interface RawRequestShape {
  method?: string
}

/** The combined structural shape read off the request object. */
type RequestShape = ExpressRouteShape & FastifyRouteShape & RawRequestShape

/**
 * Read the Express route template: `req.baseUrl` (when the router is mounted
 * on a sub-path) composed with `req.route.path`.
 *
 * @param request - The request object, read structurally.
 * @returns The composed template, or `undefined` when Express attached no
 *   route metadata (for example, a request that never matched a route).
 */
function readExpressTemplate(request: ExpressRouteShape): string | undefined {
  const path = request.route?.path
  return path === undefined ? undefined : `${request.baseUrl ?? ''}${path}`
}

/**
 * Read the Fastify route template from `req.routeOptions.url`.
 *
 * @param request - The request object, read structurally.
 * @returns The template, or `undefined` when Fastify attached no route metadata.
 */
function readFastifyTemplate(request: FastifyRouteShape): string | undefined {
  return request.routeOptions?.url
}

/**
 * Extract the neutral method and route template from a request object.
 *
 * The route template, not the raw URL, is the contract this package carries
 * downstream to metric sinks: `"/invoices/:id"` is one bounded label regardless
 * of how many distinct invoice ids are requested. Express exposes the template
 * through `req.route.path` (composed with `req.baseUrl` for mounted routers);
 * Fastify exposes it through `req.routeOptions.url`. Both are already resolved
 * by the time a guard rejects a request, because the router matches before
 * guards run.
 *
 * When neither is present the request matched no route, and the label becomes
 * {@link UNMATCHED_ROUTE} rather than the path — see this file's header for why
 * that substitution would be the more expensive bug.
 *
 * @param request - The framework request object, read structurally.
 * @returns The HTTP method and route template.
 */
export function readRequestInfo(request: RequestShape): RequestInfo {
  const template = readExpressTemplate(request) ?? readFastifyTemplate(request)
  return { method: request.method ?? '', route: template ?? UNMATCHED_ROUTE }
}

/**
 * Extract the neutral method and route template for the current HTTP request.
 *
 * @param context - The execution context of the current request.
 * @returns The HTTP method and route template.
 */
export function extractRequestInfo(context: ExecutionContext): RequestInfo {
  return readRequestInfo(context.switchToHttp().getRequest<RequestShape>())
}

export type { RequestShape }
