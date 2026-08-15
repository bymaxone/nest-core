/**
 * Unit tests for document augmentation.
 *
 * Layer: unit.
 * Goal: prove the report names an operation left requiring nothing beside
 * operations that are not, and stays quiet everywhere the silence is correct —
 * a document default present, no posture described anywhere, and this package's
 * own routes, which must neither be reported nor be counted as evidence.
 * Mocks: none; the optional peer is not involved, which is the point of keeping
 * this module pure.
 */
import { augmentDocument, unsecuredOperations } from './openapi.document'
import { generated, metrics, operation, options, OWN_ROUTES } from './__tests__/document.fixtures'

describe('unsecuredOperations', () => {
  /** A served document carrying the given paths and no document-level security. */
  function served(paths: Record<string, unknown>): Record<string, unknown> {
    return { openapi: '3.0.0', paths }
  }

  /**
   * The regression this exists for, in one assertion.
   *
   * A library describes its own routes, the consumer deletes the document-level
   * default along with the entries the library took over, and every route the
   * backend itself owns silently stops requiring anything. No other check in
   * the build can speak about it: the document validates, no requirement
   * dangles, and the runtime still answers 401.
   */
  it('reports an operation left bare beside one that states a requirement', () => {
    const document = served({
      '/auth/login': { post: { security: [] } },
      '/examples': { get: {} }
    })

    expect(unsecuredOperations(document, options())).toEqual(['GET /examples'])
  })

  /**
   * A document-level default answers for every operation that states nothing.
   *
   * With one present, a bare operation inherits it and is documented as
   * authenticated — which is the arrangement this warning wants people to keep,
   * so warning about it would be advice against itself.
   */
  it('stays silent when the document declares a default', () => {
    const document = {
      ...served({ '/examples': { get: {} }, '/auth/login': { post: { security: [] } } }),
      security: [{ cookieAuth: [] }]
    }

    expect(unsecuredOperations(document, options())).toEqual([])
  })

  /**
   * An explicit document-level empty array is an answer, not an omission.
   *
   * The specification reads `security: []` as removing the requirement, so a
   * consumer who wrote it declared the API public on purpose. Warning at
   * somebody who said the thing out loud is how a warning gets ignored.
   */
  it('treats an explicit empty document-level requirement as an answer', () => {
    const document = {
      ...served({ '/examples': { get: {} }, '/auth/login': { post: { security: [] } } }),
      security: []
    }

    expect(unsecuredOperations(document, options())).toEqual([])
  })

  /**
   * An application that describes no requirement anywhere never had one.
   *
   * This is the genuinely public API, and it is the case that decides whether
   * the warning survives: fired on it, the line appears on every boot forever
   * and teaches people to skip warnings, including the one that matters.
   */
  it('stays silent when no operation states a requirement', () => {
    const document = served({ '/examples': { get: {} }, '/orders': { post: {} } })

    expect(unsecuredOperations(document, options())).toEqual([])
  })

  /**
   * This package's own probes are neither reported nor counted as evidence.
   *
   * A health probe carrying no requirement is the *correct* description of a
   * route an orchestrator polls without a credential — naming it would put two
   * intended routes in every warning, which dilutes the one line that matters.
   */
  it('excludes this package own health probes from the report', () => {
    const document = served({ ...OWN_ROUTES, '/auth/login': { post: { security: [] } } })

    expect(unsecuredOperations(document, options())).toEqual([])
  })

  /**
   * The scrape endpoint's own requirement is not evidence that the consumer
   * described a posture.
   *
   * With `metrics.authToken` set, this package writes a requirement onto `GET
   * /metrics` without being asked. If that counted, a genuinely public API that
   * merely protects its scrape endpoint would have every route reported forever
   * — the false positive that kills the warning, arriving through our own door.
   */
  it('does not treat its own scrape requirement as a described posture', () => {
    const protectedScrape = options(
      {},
      { metrics: metrics({ enabled: true, authToken: 'secret' }) }
    )

    const document = augmentDocument(
      generated({ ...OWN_ROUTES, '/examples': { get: {} } }),
      protectedScrape
    )

    expect(operation(document, '/metrics')['security']).toEqual([{ BymaxMetricsAuth: [] }])
    expect(unsecuredOperations(document, protectedScrape)).toEqual([])
  })

  /**
   * Only the GET on this package's paths is ours.
   *
   * The controllers registered here expose GET and nothing else, so a consumer
   * who mounts another method under the same path owns that operation and must
   * be told when it requires nothing — the same cut `ownRouteSecurity` makes
   * when it decides whether it may speak for an operation at all.
   */
  it('reports a consumer method mounted on one of its own paths', () => {
    const document = served({
      '/health/live': { get: {}, post: {} },
      '/auth/login': { post: { security: [] } }
    })

    expect(unsecuredOperations(document, options())).toEqual(['POST /health/live'])
  })

  /**
   * Own-route recognition follows the application's prefixes.
   *
   * The peer documents paths as the application serves them, so a probe under a
   * global prefix is only recognized when the prefix is passed through. Without
   * it the probe would be reported as a consumer route requiring nothing.
   */
  it('recognizes its own routes under a global prefix', () => {
    const document = served({
      '/api/health/live': { get: {} },
      '/api/auth/login': { post: { security: [] } }
    })

    expect(unsecuredOperations(document, options(), ['api'])).toEqual([])
    expect(unsecuredOperations(document, options())).toEqual(['GET /api/health/live'])
  })

  /**
   * A contributed fragment is enough evidence on its own.
   *
   * The measured shape of the regression: the library supplies every explicit
   * requirement in the document — the consumer has deleted theirs — and the
   * routes no fragment touches are exactly the population at risk. Pinned here
   * rather than trusted from the sibling library's own measurement.
   */
  it('reports bare operations when only a contributed fragment states a requirement', () => {
    const document = augmentDocument(
      generated({
        '/auth/login': { post: { operationId: 'AuthController_login' } },
        '/examples': { get: {} }
      }),
      options(),
      [''],
      [
        {
          label: 'AuthOpenApi',
          operations: { AuthController_login: { security: [] } },
          components: {}
        }
      ]
    )

    expect(unsecuredOperations(document, options())).toEqual(['GET /examples'])
  })

  /**
   * Stating the intent silences one operation, which is the escape hatch.
   *
   * An override of `[]` writes an explicit requirement onto the operation, so a
   * consumer who means "this route is public" says so in the same vocabulary
   * the document uses instead of suppressing output.
   */
  it('stops reporting an operation marked public through an override', () => {
    const paths = { '/auth/login': { post: { security: [] } }, '/examples': { get: {} } }
    const configured = options({ operationSecurity: { 'GET /examples': [] } })

    const document = augmentDocument(generated(paths), configured)

    expect(unsecuredOperations(document, configured)).toEqual([])
  })

  /**
   * A document with no paths at all reports nothing.
   *
   * The function is total on any shape reaching it, for the same reason the
   * merge is: a malformed or absent member must not make a documentation
   * feature throw.
   */
  it('reports nothing for a document carrying no paths', () => {
    expect(unsecuredOperations({}, options())).toEqual([])
  })

  /**
   * A backend whose every route comes from a library is silent.
   *
   * The shape a derived backend starts in before it owns a single route, so a
   * report that misbehaved here would misbehave at the first boot of most new
   * backends. It is silent because every candidate is *described*, not because
   * there are no candidates: a library's operations are candidates like any
   * other — only this package's own routes are excluded — so one the library
   * left undescribed would be reported, correctly, since the deployment serves
   * it either way.
   */
  it('stays silent when every route in the document belongs to a library', () => {
    const document = served({
      ...OWN_ROUTES,
      '/auth/login': { post: { security: [] } },
      '/auth/logout': { post: { security: [{ cookieAuth: [] }] } }
    })

    expect(unsecuredOperations(document, options())).toEqual([])
  })

  /**
   * A document holding nothing but this package's own routes is silent.
   *
   * The genuinely empty candidate set, which is the edge an implementation
   * acquires a special case for by accident: everything in the document is
   * excluded, so the question "did anybody describe a posture?" is asked of an
   * empty list and must answer no rather than throw or default to yes.
   */
  it('stays silent when the document holds only this package own routes', () => {
    expect(unsecuredOperations(served({ ...OWN_ROUTES }), options())).toEqual([])
  })
})
