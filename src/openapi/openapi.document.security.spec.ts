/**
 * Unit tests for document augmentation.
 *
 * Layer: unit.
 * Goal: prove every operation carries the security it actually requires — the
 * document default, the per-operation override, and what this package knows
 * about the three routes it owns — and that a requirement naming a scheme the
 * document does not define fails the build rather than shipping unresolvable.
 * Mocks: none; the optional peer is not involved, which is the point of keeping
 * this module pure.
 */
import { augmentDocument } from './openapi.document'
import {
  components,
  generated,
  metrics,
  operation,
  options,
  OWN_ROUTES,
  SCHEMES
} from './__tests__/document.fixtures'

describe('augmentDocument — security', () => {
  /**
   * A document-level default is written when configured.
   *
   * This is the low-friction half of the design: most APIs are authenticated,
   * so the default belongs on the document and the exceptions are marked.
   */
  it('writes the document-level requirement', () => {
    const security = [{ cookieAuth: [] }]

    const result = augmentDocument(
      generated({ '/invoices': { get: {} } }),
      options({ security, securitySchemes: SCHEMES })
    )

    expect(result).toHaveProperty('security', security)
  })

  /**
   * A consumer's own document-level requirement wins.
   *
   * Same non-destructive rule as the component merge.
   */
  it('keeps a document-level requirement the document already has', () => {
    const mine = [{ mine: [] }]

    const result = augmentDocument(
      { ...generated({}), security: mine },
      options({ security: [{ cookieAuth: [] }], securitySchemes: SCHEMES })
    )

    expect(result.security).toBe(mine)
  })

  /**
   * No default configured means no document-level member.
   *
   * An empty `security` array at the document level means "every operation is
   * public", which is a claim this package must not make on a consumer's behalf.
   */
  it('writes no document-level requirement when none is configured', () => {
    const result = augmentDocument(generated({}), options())

    expect(result).not.toHaveProperty('security')
  })

  /**
   * A per-operation override reaches its operation, and only it.
   *
   * This is the lane that documents an operation authenticating differently
   * from the rest — a refresh endpoint reading a different cookie than the one
   * the document defaults to.
   */
  it('applies a per-operation override', () => {
    const result = augmentDocument(
      generated({ '/auth/refresh': { post: {} }, '/invoices': { get: {} } }),
      options({
        securitySchemes: SCHEMES,
        security: [{ cookieAuth: [] }],
        operationSecurity: { 'POST /auth/refresh': [{ refreshCookie: [] }] }
      })
    )

    expect(operation(result, '/auth/refresh', 'post')['security']).toEqual([{ refreshCookie: [] }])
    expect(operation(result, '/invoices')).not.toHaveProperty('security')
  })

  /**
   * An empty override marks an operation public.
   *
   * That is the specification's own way of overriding a document-level default,
   * and it matters for client generators: an operation with *absent* security
   * inherits the default, so a generated client would attach credentials to a
   * public registration endpoint.
   */
  it('marks an operation public with an empty requirement', () => {
    const result = augmentDocument(
      generated({ '/auth/login': { post: {} } }),
      options({
        securitySchemes: SCHEMES,
        security: [{ cookieAuth: [] }],
        operationSecurity: { 'POST /auth/login': [] }
      })
    )

    expect(operation(result, '/auth/login', 'post')['security']).toEqual([])
  })

  /**
   * An operation that already declares security is never touched.
   *
   * A consumer who decorated their handler outranks both the override map and
   * this package's own knowledge.
   */
  it('keeps security an operation already declares', () => {
    const mine = [{ mine: [] }]

    const result = augmentDocument(
      generated({ '/auth/login': { post: { security: mine } } }),
      options({
        securitySchemes: SCHEMES,
        security: [{ cookieAuth: [] }],
        operationSecurity: { 'POST /auth/login': [] }
      })
    )

    expect(operation(result, '/auth/login', 'post')['security']).toBe(mine)
  })

  /**
   * An override addressing nothing fails the build, and says what does exist.
   *
   * A key that matches nothing is a typo, a renamed route, or a path written
   * without the global prefix — and staying quiet would leave a route
   * documented as authenticated when it is not, or the reverse. Failing is safe
   * here because the document is only ever built outside production.
   */
  it('throws when an override addresses no documented operation', () => {
    const build = () =>
      augmentDocument(
        generated({ '/api/auth/login': { post: {} } }),
        options({ operationSecurity: { 'POST /auth/login': [] } })
      )

    expect(build).toThrow(/\[BymaxCoreModule\] openapi\.operationSecurity addresses 1 operation/)
    expect(build).toThrow(/does not contain: POST \/auth\/login/)
    expect(build).toThrow(/Keys are "<METHOD> <path>"/)
    expect(build).toThrow(/including any global prefix/)
    expect(build).toThrow(/The document contains: POST \/api\/auth\/login/)
  })

  /**
   * Several misaddressed keys are all reported, and so is everything available.
   *
   * Reporting one at a time would mean one boot per typo. The separators matter
   * as much as the items: a list rendered without them reads as a single
   * nonsense key, which is exactly the confusion this message exists to end.
   */
  it('lists every unmatched key and every documented operation', () => {
    const build = () =>
      augmentDocument(
        generated({ '/invoices': { get: {} }, '/payments': { post: {} } }),
        options({ operationSecurity: { 'POST /nope': [], 'GET /nada': [] } })
      )

    expect(build).toThrow(/addresses 2 operation/)
    expect(build).toThrow(/does not contain: POST \/nope, GET \/nada\./)
    expect(build).toThrow(/The document contains: GET \/invoices, POST \/payments\./)
  })

  /**
   * A requirement naming an undeclared scheme fails the build.
   *
   * The requirement is a reference, and a reference to nothing yields a document
   * whose security cannot be resolved: a client generator looks the name up in
   * `components.securitySchemes`, finds nothing, and either fails or emits an
   * unauthenticated client. Configuring one and forgetting the other is a single
   * edit apart.
   */
  it('throws when a document-level requirement names an undeclared scheme', () => {
    const build = () =>
      augmentDocument(generated({ '/x': { get: {} } }), options({ security: [{ ghost: [] }] }))

    expect(build).toThrow(/names 1 scheme\(s\) that the document does not define: ghost/)
    expect(build).toThrow(/Declare them in openapi\.securitySchemes, or drop the requirement/)
    expect(build).toThrow(/The document defines: \(none\)/)
  })

  /**
   * The same rule covers the per-operation lane.
   *
   * An override is the more likely place to name a scheme that only some
   * operations use, which is exactly where a typo hides longest.
   */
  it('throws when an override names an undeclared scheme, listing what exists', () => {
    const build = () =>
      augmentDocument(
        generated({ '/x': { get: {} } }),
        options({
          securitySchemes: SCHEMES,
          operationSecurity: { 'GET /x': [{ refreshCooky: [] }] }
        })
      )

    expect(build).toThrow(/does not define: refreshCooky/)
    expect(build).toThrow(/The document defines: cookieAuth, refreshCookie/)
  })

  /**
   * Every undeclared scheme is named, across both lanes, separated.
   *
   * One boot per typo would be a poor trade, and a list rendered without its
   * separators reads as a single nonsense name — the opposite of what a message
   * naming the mistake is for.
   */
  it('lists every undeclared scheme it found', () => {
    const build = () =>
      augmentDocument(
        generated({ '/x': { get: {} } }),
        options({
          security: [{ ghostOne: [] }],
          operationSecurity: { 'GET /x': [{ ghostTwo: [] }] }
        })
      )

    expect(build).toThrow(/names 2 scheme\(s\)/)
    expect(build).toThrow(/does not define: ghostOne, ghostTwo\./)
  })

  /**
   * A scheme the document itself declared counts as declared.
   *
   * The check runs against what the *served* document will define, not only
   * against what the options contributed, so a consumer who documented their
   * scheme by hand is not told it is missing.
   */
  it('accepts a requirement naming a scheme the document already declared', () => {
    const build = () =>
      augmentDocument(
        {
          ...generated({ '/x': { get: {} } }),
          components: { securitySchemes: { legacy: { type: 'apiKey' } } }
        },
        options({ security: [{ legacy: [] }] })
      )

    expect(build).not.toThrow()
  })

  /**
   * Marking an operation public names no scheme, so nothing is required.
   *
   * The empty requirement is the common case for a public route, and it must
   * not need a scheme declared to express "none".
   */
  it('needs no scheme declared to mark an operation public', () => {
    const build = () =>
      augmentDocument(
        generated({ '/auth/login': { post: {} } }),
        options({ operationSecurity: { 'POST /auth/login': [] } })
      )

    expect(build).not.toThrow()
  })

  /**
   * An empty document says so, rather than trailing off.
   *
   * Both checks in this module report what exists; when nothing does, they must
   * say that in the same words, or the reader is left wondering whether the
   * message was truncated.
   */
  it('names the empty document explicitly', () => {
    expect(() =>
      augmentDocument(generated({}), options({ operationSecurity: { 'GET /x': [] } }))
    ).toThrow(/The document contains: \(none\)\./)
  })

  /**
   * A matching override does not throw.
   *
   * The guard must not fire on the configuration it exists to support.
   */
  it('accepts an override that matches', () => {
    const build = () =>
      augmentDocument(
        generated({ '/auth/login': { post: {} } }),
        options({ operationSecurity: { 'POST /auth/login': [] } })
      )

    expect(build).not.toThrow()
  })

  /**
   * An override pointing at a route removed as disabled also fails.
   *
   * The check runs against the served document, so configuring security for a
   * feature this deployment turned off is reported rather than ignored.
   */
  it('throws when an override addresses a disabled feature route', () => {
    expect(() =>
      augmentDocument(
        generated({ ...OWN_ROUTES }),
        options({ operationSecurity: { 'GET /metrics': [] } })
      )
    ).toThrow(/does not contain: GET \/metrics/)
  })

  /**
   * The health probes are documented public when a default exists.
   *
   * They are polled by an orchestrator holding no credential, and this package
   * knows that without being told.
   */
  it('marks its own health routes public under a document default', () => {
    const result = augmentDocument(
      generated({ ...OWN_ROUTES }),
      options({ security: [{ cookieAuth: [] }], securitySchemes: SCHEMES })
    )

    expect(operation(result, '/health/live')['security']).toEqual([])
    expect(operation(result, '/health/ready')['security']).toEqual([])
  })

  /**
   * The automatic policy covers this package's method and no other.
   *
   * The controllers registered here expose `GET` alone, so a consumer who
   * mounts another method under the same path owns that operation — marking it
   * public, or bearer-protected, would state a policy for a route this package
   * knows nothing about.
   */
  it('applies its own-route policy to GET only', () => {
    const result = augmentDocument(
      generated({
        '/health/live': { get: {}, post: {} },
        '/metrics': { get: {}, post: {} }
      }),
      options(
        { security: [{ cookieAuth: [] }], securitySchemes: SCHEMES },
        { metrics: metrics({ enabled: true, authToken: 'secret' }) }
      )
    )

    expect(operation(result, '/health/live')['security']).toEqual([])
    expect(operation(result, '/health/live', 'post')).not.toHaveProperty('security')
    expect(operation(result, '/metrics')['security']).toEqual([{ BymaxMetricsAuth: [] }])
    expect(operation(result, '/metrics', 'post')).not.toHaveProperty('security')
  })

  /**
   * The reserved scheme name is not silently shared.
   *
   * This package documents the scrape operation as requiring
   * `BymaxMetricsAuth`. If something else defines that name, one definition
   * wins silently and the operation may end up pointing at a scheme that is not
   * the bearer token the runtime checks — telling a client to authenticate a
   * way that does not work.
   */
  it('throws when the consumer options define the reserved scrape scheme', () => {
    const mine = { BymaxMetricsAuth: { type: 'apiKey', in: 'header', name: 'X-Scrape' } }

    expect(() =>
      augmentDocument(
        generated({ '/metrics': { get: {} } }),
        options(
          { securitySchemes: mine },
          { metrics: metrics({ enabled: true, authToken: 'secret' }) }
        )
      )
    ).toThrow(
      /is reserved: this package contributes it to document the bearer token.*in openapi\.securitySchemes\. Rename yours, or unset metrics\.authToken/s
    )
  })

  /**
   * The collision is refused whichever side defined the reserved name.
   *
   * The sibling test covers a consumer declaring it through options; this one
   * covers the peer generating it from a decorator, which is the harder case to
   * notice because nothing in the consumer's configuration mentions the name.
   * Both must fail, and the error must say which side it found — otherwise the
   * merge silently picks a winner and the scrape operation ends up pointing at
   * a scheme that is not the bearer token the runtime actually checks.
   */
  it('throws when the generated document defines the reserved scrape scheme', () => {
    const mine = { BymaxMetricsAuth: { type: 'apiKey', in: 'header', name: 'X-Scrape' } }

    expect(() =>
      augmentDocument(
        { ...generated({ '/metrics': { get: {} } }), components: { securitySchemes: mine } },
        options({}, { metrics: metrics({ enabled: true, authToken: 'secret' }) })
      )
    ).toThrow(/"BymaxMetricsAuth" is reserved.*by the generated document/s)
  })

  /**
   * The reserved name is free while this package contributes nothing.
   *
   * Without a scrape token there is no scheme to collide with, so a consumer
   * who happens to use the name is left alone.
   */
  it('allows the reserved name when no scrape token is configured', () => {
    const mine = { BymaxMetricsAuth: { type: 'apiKey', in: 'header', name: 'X-Scrape' } }

    expect(() =>
      augmentDocument(generated({ '/x': { get: {} } }), options({ securitySchemes: mine }))
    ).not.toThrow()
  })

  /**
   * With no document default, the probes are left alone.
   *
   * An explicit "requires nothing" is noise in a document where nothing
   * requires anything.
   */
  it('leaves the health routes unmarked when no default exists', () => {
    const result = augmentDocument(generated({ ...OWN_ROUTES }), options())

    expect(operation(result, '/health/live')).not.toHaveProperty('security')
  })

  /**
   * An unprotected scrape endpoint says so, rather than inheriting.
   *
   * With no token configured the endpoint answers anyone — the documented
   * "protected at the edge" arrangement. Letting it inherit a document default
   * would describe an open endpoint as requiring a credential, which is the
   * worse of the two mistakes: documenting a guarded route as open fails loudly
   * at the first client that omits the credential, while documenting an open
   * route as guarded fails nowhere and hands the wrong answer to whoever opened
   * the document to ask what is exposed.
   */
  it('marks an unprotected scrape endpoint public under a document default', () => {
    const result = augmentDocument(
      generated({ ...OWN_ROUTES }),
      options(
        { security: [{ cookieAuth: [] }], securitySchemes: SCHEMES },
        { metrics: metrics({ enabled: true }) }
      )
    )

    expect(operation(result, '/metrics')['security']).toEqual([])
    expect(operation(result, '/health/live')['security']).toEqual([])
  })

  /**
   * Without a document default there is nothing to inherit, so nothing is said.
   *
   * The explicit `[]` exists to override a default. In a document that declares
   * none, writing it would be noise on every own route — the same rule the
   * health probes already follow, now applied to the scrape endpoint too.
   */
  it('leaves an unprotected scrape endpoint unmarked when no default exists', () => {
    const result = augmentDocument(
      generated({ ...OWN_ROUTES }),
      options({}, { metrics: metrics({ enabled: true }) })
    )

    expect(operation(result, '/metrics')).not.toHaveProperty('security')
  })

  /**
   * A protected scrape endpoint is documented as protected, with its scheme.
   *
   * This package knows the answer exactly — the endpoint is protected when, and
   * only when, `metrics.authToken` is set — so no consumer should have to
   * restate it.
   */
  it('documents the scrape bearer when a token is configured', () => {
    const result = augmentDocument(
      generated({ ...OWN_ROUTES }),
      // A custom path alongside the default, so the route set holds two
      // candidates and only one matches: a check that required *every*
      // candidate to match would document nothing here.
      options({}, { metrics: metrics({ enabled: true, authToken: 'secret', path: 'scrape' }) })
    )

    expect(operation(result, '/metrics')['security']).toEqual([{ BymaxMetricsAuth: [] }])
    expect(components(result, 'securitySchemes')['BymaxMetricsAuth']).toEqual({
      type: 'http',
      scheme: 'bearer',
      description: 'Bearer token required by the metrics scrape endpoint.'
    })
  })

  /**
   * An unprotected scrape endpoint advertises no credential.
   *
   * Documenting a scheme the deployment does not check would send a scraper
   * looking for a token that does not exist.
   */
  it('documents no scrape scheme when no token is configured', () => {
    const result = augmentDocument(
      generated({ ...OWN_ROUTES }),
      options({}, { metrics: metrics({ enabled: true }) })
    )

    expect(operation(result, '/metrics')).not.toHaveProperty('security')
    expect(result.components).not.toHaveProperty('securitySchemes')
  })
})
