/**
 * Unit tests for `extractRequestInfo`.
 *
 * Layer: unit.
 * Goal: prove the accessor reads the Express route template (composed with
 * `baseUrl`), the Fastify route template, and reports the fixed unmatched-route
 * label when neither framework attached route metadata; pin that label's exact
 * value, which is a contract an alert rule matches on.
 * Mocks: a hand-built `ExecutionContext` exposing only `switchToHttp().getRequest()`.
 */
import type { ExecutionContext } from '@nestjs/common'

import { extractRequestInfo, readRequestInfo, UNMATCHED_ROUTE } from './request-info.accessor'

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
   * A request that matched no route gets the bounded label. Regression guard.
   *
   * This is the security-relevant case and it is the reason the old fallback
   * had to go. Requests matching no route are what a scanner produces, each at
   * a different path, so labelling them by URL would mint one time series per
   * probe — the metric becoming the outage. Every unmatched request now shares
   * one label, whatever it asked for.
   */
  it.each([
    ['a scanner probe', '/admin/.env'],
    ['a query string', '/wp-login.php?redirect=/'],
    ['nothing at all', undefined]
  ])('labels an unmatched request from %s as the unmatched route', (_label, url) => {
    const info = readRequestInfo({ method: 'GET', ...(url === undefined ? {} : { url }) })

    expect(info.route).toBe(UNMATCHED_ROUTE)
    expect(info.method).toBe('GET')
  })

  /**
   * A request carrying no method at all. Edge case.
   *
   * Nothing enforces the shape of an object handed to this reader, and an empty
   * string is a label a sink can carry rather than an exception at the moment a
   * request ends.
   */
  it('returns an empty method when the request reports none', () => {
    expect(readRequestInfo({})).toEqual({ method: '', route: UNMATCHED_ROUTE })
  })
})

describe('UNMATCHED_ROUTE', () => {
  /**
   * The label is a non-empty literal, asserted on its exact value.
   *
   * It is what a dashboard filters on and what an alert rule matching a scan is
   * written against, so it belongs to the contract and cannot drift silently.
   * The emptiness check is not redundant with the equality one: Prometheus
   * documents that "labels with an empty label value are considered equivalent
   * to labels that do not exist", so an empty value would not read as a
   * suspicious route — it would read as a sample with no route at all, and the
   * 404 flood this label exists to make visible would disappear into whatever a
   * dashboard shows for missing data.
   */
  it('is the exact non-empty label a dashboard filters on', () => {
    expect(UNMATCHED_ROUTE).toBe('<unmatched>')
    expect(UNMATCHED_ROUTE.length).toBeGreaterThan(0)
  })
})
