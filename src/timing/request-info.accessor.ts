/**
 * @fileoverview Neutral request-info accessor for request timing. Reads the
 * HTTP method and the route template from the current execution context
 * without assuming Express or Fastify, so `RequestTimingSample.route` always
 * carries a bounded-cardinality label instead of the raw URL.
 * @layer Utility
 */
import type { ExecutionContext } from '@nestjs/common'

/** HTTP method and route template extracted from the current request. */
export interface RequestInfo {
  /** HTTP method, for example `"GET"`. Empty when the adapter reports none. */
  method: string
  /**
   * Route template, for example `"/invoices/:id"`, or the URL path (query
   * string stripped) when no template is registered for the request.
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

/** Structural shape shared by both frameworks for method and raw URL. */
interface RawRequestShape {
  method?: string
  url?: string
  originalUrl?: string
}

/** The combined structural shape read off the request object. */
type RequestShape = ExpressRouteShape & FastifyRouteShape & RawRequestShape

/**
 * Strip the query string from a raw URL, keeping only the path segment.
 *
 * @param rawUrl - The request URL, with or without a query string.
 * @returns The path segment alone.
 */
function stripQueryString(rawUrl: string): string {
  const queryIndex = rawUrl.indexOf('?')
  return queryIndex === -1 ? rawUrl : rawUrl.slice(0, queryIndex)
}

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
 * Extract the neutral method and route template for the current HTTP request.
 *
 * The route template, not the raw URL, is the contract this package carries
 * downstream to metric sinks: `"/invoices/:id"` is one bounded label
 * regardless of how many distinct invoice ids are requested, while the raw URL
 * would mint one label per id and blow up cardinality. Express exposes the
 * template through `req.route.path` (composed with `req.baseUrl` for mounted
 * routers); Fastify exposes it through `req.routeOptions.url`. When neither is
 * present, for example a request that never matched a route, the URL path
 * (query string stripped) is used as a documented fallback so a timing sample
 * is still produced.
 *
 * @param context - The execution context of the current request.
 * @returns The HTTP method and route template.
 */
export function extractRequestInfo(context: ExecutionContext): RequestInfo {
  const request = context.switchToHttp().getRequest<RequestShape>()
  const template = readExpressTemplate(request) ?? readFastifyTemplate(request)
  const rawUrl = request.originalUrl ?? request.url ?? ''
  return { method: request.method ?? '', route: template ?? stripQueryString(rawUrl) }
}
