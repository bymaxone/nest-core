/**
 * Unit tests for document augmentation.
 *
 * Layer: unit.
 * Goal: prove the served document describes *this* deployment's routes — a
 * disabled feature's routes are gone, and the recognition that decides which
 * they are survives a global prefix, a custom path and a consumer route that
 * merely ends like one of this package's own.
 * Mocks: none; the optional peer is not involved, which is the point of keeping
 * this module pure.
 */
import { augmentDocument } from './openapi.document'
import {
  generated,
  health,
  metrics,
  operation,
  options,
  OWN_ROUTES
} from './__tests__/document.fixtures'

describe('augmentDocument — disabled features', () => {
  /**
   * A disabled feature's routes leave the document.
   *
   * On the asynchronous registration path the controller is mounted whatever
   * the options say, because route metadata is fixed before they resolve, and
   * the handler answers 404. A document still listing the route would describe
   * something this deployment does not serve.
   */
  it('drops the health routes when health is disabled', () => {
    const result = augmentDocument(
      generated({ ...OWN_ROUTES, '/invoices': { get: {} } }),
      options({}, { health: health({ enabled: false }) })
    )

    expect(result.paths).not.toHaveProperty('/health/live')
    expect(result.paths).not.toHaveProperty('/health/ready')
    expect(result.paths).toHaveProperty('/invoices')
  })

  /**
   * The scrape endpoint follows the same rule.
   *
   * Metrics default to off, so this is the state most consumers are in, and it
   * is the case the consumer audit actually reported.
   */
  it('drops the metrics route when metrics are disabled', () => {
    const result = augmentDocument(generated({ ...OWN_ROUTES }), options())

    expect(result.paths).not.toHaveProperty('/metrics')
  })

  /**
   * An enabled feature keeps its routes.
   *
   * The filter must key off the resolved snapshot rather than remove this
   * package's routes unconditionally.
   */
  it('keeps the routes of an enabled feature', () => {
    const result = augmentDocument(
      generated({ ...OWN_ROUTES }),
      options({}, { metrics: metrics({ enabled: true }) })
    )

    expect(result.paths).toHaveProperty('/metrics')
    expect(result.paths).toHaveProperty('/health/live')
  })

  /**
   * A global prefix does not hide this package's own routes.
   *
   * `@nestjs/swagger` documents paths including `app.setGlobalPrefix()`, so a
   * filter comparing for equality would stop recognizing these routes the
   * moment a consumer sets one — and would silently keep advertising a disabled
   * feature, which is the very bug being fixed.
   */
  it('drops prefixed routes too', () => {
    const result = augmentDocument(
      generated({ '/api/v2/health/live': { get: {} }, '/api/v2/metrics': { get: {} } }),
      options({}, { health: health({ enabled: false }), metrics: metrics({ enabled: true }) }),
      ['api/v2']
    )

    expect(result.paths).not.toHaveProperty('/api/v2/health/live')
    expect(result.paths).toHaveProperty('/api/v2/metrics')
  })

  /**
   * A custom health path is matched as well as the default.
   *
   * The two registration paths mount the controller differently — `forRoot` at
   * the configured path, `forRootAsync` at the default — and this module cannot
   * tell which was used, so it must recognize both.
   */
  it('drops a custom health path and the default alike', () => {
    const result = augmentDocument(
      generated({ '/status/live': { get: {} }, '/health/live': { get: {} } }),
      options({}, { health: health({ enabled: false, path: 'status' }) })
    )

    expect(result.paths).toEqual({})
  })

  /**
   * A configured path written with slashes still matches.
   *
   * `'/status/'` and `'status'` name the same route, and a consumer should not
   * have to know which spelling this package compares against. Each spelling is
   * exercised on its own so a trimmer that only handled one end would fail here
   * rather than in a consumer's document.
   */
  it.each([['status'], ['/status'], ['status/'], ['/status/'], ['//status//']])(
    'tolerates a configured path written as %s',
    (configured) => {
      const result = augmentDocument(
        generated({ '/status/live': { get: {} } }),
        options({}, { health: health({ enabled: false, path: configured }) })
      )

      expect(result.paths).toEqual({})
    }
  )

  /**
   * A configured path with more than one segment survives normalization.
   *
   * Trimming must not flatten the separators it is meant to keep: a health
   * route mounted under `v1/status` is two segments, and rejoining them without
   * the slash would produce a suffix matching nothing.
   */
  it('keeps the separators inside a multi-segment configured path', () => {
    const result = augmentDocument(
      generated({ '/v1/status/live': { get: {} }, '/invoices': { get: {} } }),
      options({}, { health: health({ enabled: false, path: '/v1/status/' }) })
    )

    expect(result.paths).toEqual({ '/invoices': expect.anything() })
  })

  /**
   * A consumer's own look-alike route is never removed. Regression guard.
   *
   * The tail match exists for the global prefix, and taken alone it would treat
   * `/tenants/{id}/health/live` as this package's probe and delete it from the
   * consumer's document — losing their content to fix ours, silently, which is
   * worse than the over-listing this module exists to correct. A global prefix
   * prefixes *everything*, and `/tenants/{id}` does not prefix `/invoices`.
   */
  it('keeps a consumer route that merely ends like one of its own', () => {
    const result = augmentDocument(
      generated({ '/tenants/{id}/health/live': { get: {} }, '/invoices': { get: {} } }),
      options({}, { health: health({ enabled: false }) })
    )

    expect(result.paths).toHaveProperty('/tenants/{id}/health/live')
    expect(result.paths).toHaveProperty('/invoices')
  })

  /**
   * A shared controller prefix is not the application's prefix. Regression guard.
   *
   * Inferring the prefix from the document — "the segment every path shares" —
   * is the tempting shortcut, and an application whose routes all sit under
   * `/tenants/{id}` would have that inferred as its global prefix. The
   * consumer's own probe would then be deleted as though this package owned it.
   * The prefix is asked for, not guessed, so this document has none.
   */
  it('does not mistake a shared controller prefix for the global one', () => {
    const result = augmentDocument(
      generated({
        '/tenants/{id}/health/live': { get: {} },
        '/tenants/{id}/invoices': { get: {} }
      }),
      options({}, { health: health({ enabled: false }) })
    )

    expect(result.paths).toHaveProperty('/tenants/{id}/health/live')
    expect(result.paths).toHaveProperty('/tenants/{id}/invoices')
  })

  /**
   * The real global prefix is recognized when the application reports it.
   *
   * The other half: told the prefix is `api/v2`, the probe under it is this
   * package's and does go, while the consumer's route beside it stays.
   */
  it('removes its own route under the reported global prefix', () => {
    const result = augmentDocument(
      generated({ '/api/v2/health/live': { get: {} }, '/api/v2/invoices': { get: {} } }),
      options({}, { health: health({ enabled: false }) }),
      ['api/v2']
    )

    expect(result.paths).toEqual({ '/api/v2/invoices': expect.anything() })
  })

  /**
   * An operation at the prefix root does not defeat the match. Regression guard.
   *
   * An application with a global prefix and a controller at its root documents
   * `/api` itself beside `/api/health/live`. Nothing about that operation may
   * affect whether the probe beside it is recognized — under an inferred prefix
   * it did, which left a disabled feature advertised.
   */
  it('removes its own route when a path sits at the prefix root', () => {
    const result = augmentDocument(
      generated({
        '/api': { get: {} },
        '/api/health/live': { get: {} },
        '/api/invoices': { get: {} }
      }),
      options({}, { health: health({ enabled: false }) }),
      ['api']
    )

    expect(result.paths).not.toHaveProperty('/api/health/live')
    expect(result.paths).toHaveProperty('/api')
    expect(result.paths).toHaveProperty('/api/invoices')
  })

  /**
   * Only this package's operation leaves, not the consumer's. Regression guard.
   *
   * The controllers registered here own the `GET` alone. An application that
   * mounted another method on the same path owns that operation, and dropping
   * the whole path item to remove ours would take a live route out of their
   * document — the same class of loss as deleting a look-alike path.
   */
  it('removes only its own operation from a shared path item', () => {
    const parameters = [{ name: 'tenant', in: 'header' }]

    const result = augmentDocument(
      generated({ '/metrics': { get: {}, post: { summary: 'consumer push' }, parameters } }),
      options()
    )
    const item = (result.paths as Record<string, Record<string, unknown>>)['/metrics']

    expect(item).not.toHaveProperty('get')
    expect(item).toHaveProperty('post')
    expect(item?.['parameters']).toBe(parameters)
  })

  /**
   * The path goes once nothing is left under it.
   *
   * An item with no operations documents nothing, so keeping the key would
   * leave an empty shell where a route used to be.
   */
  it('drops the path when its last operation was its own', () => {
    const result = augmentDocument(generated({ '/metrics': { get: {} } }), options())

    expect(result.paths).toEqual({})
  })

  /**
   * A disabled feature at a custom path drops the default route too.
   *
   * The route set holds both candidates, and only the one actually documented
   * matches — a check requiring *every* candidate to match would remove nothing
   * and leave the disabled route advertised.
   */
  it('drops the default metrics route when metrics are disabled at a custom path', () => {
    const result = augmentDocument(
      generated({ '/metrics': { get: {} } }),
      options({}, { metrics: metrics({ enabled: false, path: 'scrape' }) })
    )

    expect(result.paths).toEqual({})
  })

  /**
   * Nothing is removed when both features are on.
   *
   * Asserted on the key set rather than the whole map, because the operations
   * themselves are still augmented with the responses this package contributes
   * — it is the filter, not the augmentation, that must do nothing here.
   */
  it('removes no path when nothing is disabled', () => {
    const paths = { '/invoices': { get: {} }, ...OWN_ROUTES }

    const result = augmentDocument(
      generated(paths),
      options({}, { health: health({ enabled: true }), metrics: metrics({ enabled: true }) })
    )

    expect(Object.keys(result.paths)).toEqual(Object.keys(paths))
  })
})
