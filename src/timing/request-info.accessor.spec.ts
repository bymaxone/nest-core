/**
 * Unit tests for `extractRequestInfo`.
 *
 * Layer: unit.
 * Goal: prove the accessor reads the Express route template (composed with
 * `baseUrl`), the Fastify route template, and falls back to the query-stripped
 * URL path when neither framework attached route metadata.
 * Mocks: a hand-built `ExecutionContext` exposing only `switchToHttp().getRequest()`.
 */
import type { ExecutionContext } from '@nestjs/common'

import { extractRequestInfo } from './request-info.accessor'

/** Build a minimal `ExecutionContext` exposing the given request object. */
function contextFor(request: object): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: (): unknown => request
    })
  } as unknown as ExecutionContext
}

describe('extractRequestInfo', () => {
  /**
   * Express route mounted on a sub-router.
   *
   * `baseUrl` must be composed in front of `route.path` so the reported
   * template reflects the full mount path, not just the router-local segment.
   */
  it('composes baseUrl with route.path for a mounted Express router', () => {
    const info = extractRequestInfo(
      contextFor({ method: 'GET', baseUrl: '/api', route: { path: '/invoices/:id' } })
    )

    expect(info).toEqual({ method: 'GET', route: '/api/invoices/:id' })
  })

  /**
   * Express route with no mounted router.
   *
   * Without `baseUrl`, the template is `route.path` alone: the `?? ''` guard
   * must not inject a stray prefix.
   */
  it('uses route.path alone when Express has no baseUrl', () => {
    const info = extractRequestInfo(contextFor({ method: 'POST', route: { path: '/invoices' } }))

    expect(info).toEqual({ method: 'POST', route: '/invoices' })
  })

  /**
   * Fastify route template.
   *
   * Fastify reports its template through `routeOptions.url`; the accessor
   * must read it when no Express `route` object is present.
   */
  it('reads the Fastify route template from routeOptions.url', () => {
    const info = extractRequestInfo(
      contextFor({ method: 'GET', routeOptions: { url: '/invoices/:id' } })
    )

    expect(info).toEqual({ method: 'GET', route: '/invoices/:id' })
  })

  /**
   * No-template fallback with a query string.
   *
   * A request that never matched a route (for example, one rejected before
   * routing) carries no template at all; the accessor falls back to the URL
   * path with the query string stripped.
   */
  it('falls back to the query-stripped originalUrl when no template exists', () => {
    const info = extractRequestInfo(
      contextFor({ method: 'GET', originalUrl: '/unknown/path?x=1&y=2' })
    )

    expect(info).toEqual({ method: 'GET', route: '/unknown/path' })
  })

  /**
   * No-template fallback using `url` when `originalUrl` is absent.
   *
   * Some adapters only expose `url`; the fallback chain must still resolve to
   * a usable path, and a URL without a query string must pass through as-is.
   */
  it('falls back to url when originalUrl is absent and there is no query string', () => {
    const info = extractRequestInfo(contextFor({ method: 'DELETE', url: '/plain/path' }))

    expect(info).toEqual({ method: 'DELETE', route: '/plain/path' })
  })

  /**
   * Fully bare request.
   *
   * When method, originalUrl, and url are all absent, the accessor must still
   * return a defined shape (empty strings) instead of throwing.
   */
  it('returns empty strings when the request carries no method or URL at all', () => {
    const info = extractRequestInfo(contextFor({}))

    expect(info).toEqual({ method: '', route: '' })
  })
})
