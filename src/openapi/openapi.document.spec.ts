/**
 * Unit tests for document augmentation.
 *
 * Layer: unit.
 * Goal: prove the merge is additive and non-destructive — contributed entries
 * appear, a consumer's own entry of the same name always wins, the input
 * document is never mutated, and a malformed or absent `components` member
 * cannot make the merge throw — and that the served document describes *this*
 * deployment: a disabled feature's routes are gone, every operation carries the
 * security it actually requires, and the responses this package can describe
 * reference the schemas it contributed.
 * Mocks: none; the optional peer is not involved, which is the point of keeping
 * this module pure.
 */
import { normalizeCoreOptions } from '../core.options'
import type {
  ResolvedCoreOptions,
  ResolvedHealthOptions,
  ResolvedMetricsOptions,
  ResolvedOpenApiOptions
} from '../core.options'
import type { ResolvedContribution } from './openapi.contribution'
import { augmentDocument, unsecuredOperations } from './openapi.document'
import { CORE_PARAMETERS, CORE_SCHEMAS } from './openapi.schemas'

/** Resolved core options with the given OpenAPI and feature overrides applied. */
function options(
  openapi: Partial<ResolvedOpenApiOptions> = {},
  features: Partial<Pick<ResolvedCoreOptions, 'health' | 'metrics'>> = {}
): ResolvedCoreOptions {
  const base = normalizeCoreOptions()
  return { ...base, ...features, openapi: { ...base.openapi, ...openapi } }
}

/** The health block with overrides applied over its documented defaults. */
function health(overrides: Partial<ResolvedHealthOptions>): ResolvedHealthOptions {
  return { ...normalizeCoreOptions().health, ...overrides }
}

/** The metrics block with overrides applied over its documented defaults. */
function metrics(overrides: Partial<ResolvedMetricsOptions>): ResolvedMetricsOptions {
  return { ...normalizeCoreOptions().metrics, ...overrides }
}

/** Read a nested member without assuming the specification's own types. */
function components(document: { components: Readonly<Record<string, unknown>> }, key: string) {
  return document.components[key] as Record<string, unknown>
}

/** Read one operation out of an augmented document. */
function operation(
  document: Record<string, unknown>,
  path: string,
  method = 'get'
): Record<string, unknown> {
  const paths = document['paths'] as Record<string, Record<string, unknown>>
  return paths[path]?.[method] as Record<string, unknown>
}

/** A generated document carrying the given paths. */
function generated(paths: Record<string, unknown>): { openapi: string; paths: typeof paths } {
  return { openapi: '3.0.0', paths }
}

/** Schemes a security test can name without tripping the declared-scheme check. */
const SCHEMES = {
  cookieAuth: { type: 'apiKey', in: 'cookie', name: 'access_token' },
  refreshCookie: { type: 'apiKey', in: 'cookie', name: 'refresh_token' }
}

/** The three routes this package registers, as the peer would document them. */
const OWN_ROUTES = {
  '/health/live': { get: {} },
  '/health/ready': { get: {} },
  '/metrics': { get: {} }
}

describe('augmentDocument', () => {
  /**
   * The contributed catalogue reaches the document.
   *
   * With the default `includeCoreSchemas`, every schema and parameter this
   * package owns must appear under `components`, which is what makes an error
   * response or a paginated list describable by a consumer's operations.
   */
  it('contributes the core schemas and parameters', () => {
    const result = augmentDocument({ openapi: '3.0.0', components: {} }, options())

    expect(components(result, 'schemas')).toMatchObject(CORE_SCHEMAS)
    expect(components(result, 'parameters')).toMatchObject(CORE_PARAMETERS)
  })

  /**
   * The consumer's definition wins a name collision.
   *
   * A consumer who documents their own `BymaxErrorEnvelope` means it; silently
   * replacing it with this package's would be a surprise a documentation tool
   * must never spring.
   */
  it('keeps the consumer definition when a name collides', () => {
    const mine = { type: 'object', description: 'my own envelope' }

    const result = augmentDocument(
      { components: { schemas: { BymaxErrorEnvelope: mine } } },
      options()
    )

    expect(components(result, 'schemas')['BymaxErrorEnvelope']).toBe(mine)
    expect(components(result, 'schemas')['BymaxHealthResponse']).toBeDefined()
  })

  /**
   * An existing parameter definition survives the merge.
   *
   * Parameters follow the same non-destructive rule as schemas, and they are
   * read from a different member of `components`: a merge that read the wrong
   * member would still contribute this package's parameters correctly while
   * silently dropping every parameter the document already had.
   */
  it('keeps parameters the document already defines', () => {
    const existing = { InvoiceId: { name: 'invoiceId', in: 'path', required: true } }

    const result = augmentDocument({ components: { parameters: existing } }, options())

    expect(components(result, 'parameters')['InvoiceId']).toEqual(existing.InvoiceId)
    expect(components(result, 'parameters')['BymaxPageQueryPage']).toBeDefined()
  })

  /**
   * Opting out contributes nothing.
   *
   * With `includeCoreSchemas` false, the document must be left exactly as
   * generated, so a consumer who documents these shapes themselves gets no
   * duplicate entries.
   */
  it('contributes no schemas when includeCoreSchemas is false', () => {
    const result = augmentDocument(
      { components: { schemas: { Invoice: { type: 'object' } } } },
      options({ includeCoreSchemas: false })
    )

    expect(components(result, 'schemas')).toEqual({ Invoice: { type: 'object' } })
    expect(result.components).not.toHaveProperty('parameters')
  })

  /**
   * Security schemes are copied only when declared.
   *
   * An empty map must not create an empty `securitySchemes` member, because a
   * document that declares the key with nothing in it reads as "authentication
   * was considered and there is none".
   */
  it('omits securitySchemes when none are configured', () => {
    const result = augmentDocument({}, options())

    expect(result.components).not.toHaveProperty('securitySchemes')
  })

  /**
   * Declared security schemes reach the document.
   *
   * This is the consumer's own contribution channel, and it follows the same
   * non-destructive rule as the package's own entries.
   */
  it('copies declared security schemes and keeps existing ones', () => {
    const existing = { legacy: { type: 'apiKey' } }

    const result = augmentDocument(
      { components: { securitySchemes: existing } },
      options({ securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } })
    )

    expect(components(result, 'securitySchemes')).toEqual({
      legacy: { type: 'apiKey' },
      bearer: { type: 'http', scheme: 'bearer' }
    })
  })

  /**
   * The input document is never mutated.
   *
   * The caller keeps the document the peer generated; augmentation returns a
   * new one so a retry or a second mount cannot accumulate state.
   */
  it('returns a new document and leaves the input untouched', () => {
    const input = { openapi: '3.0.0', components: { schemas: {} } }

    const result = augmentDocument(input, options())

    expect(result).not.toBe(input)
    expect(input.components.schemas).toEqual({})
    expect(result.openapi).toBe('3.0.0')
  })

  /**
   * A document with no components at all. Edge case.
   *
   * The peer always emits a `components` object, but the merge must be total:
   * an absent member yields the contributed catalogue rather than a crash at
   * bootstrap, when the application is already half-started.
   */
  it('creates components when the document has none', () => {
    const result = augmentDocument({}, options())

    expect(Object.keys(components(result, 'schemas'))).toEqual(Object.keys(CORE_SCHEMAS))
  })

  /**
   * A malformed components member. Edge case: wrong type.
   *
   * Nothing enforces the shape of a document handed to this function, and a
   * null, array, or primitive member must degrade to "no existing entries"
   * rather than throw.
   */
  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'nope']
  ])('tolerates a components member that is %s', (_label, value) => {
    const result = augmentDocument({ components: value }, options())

    expect(Object.keys(components(result, 'schemas'))).toEqual(Object.keys(CORE_SCHEMAS))
  })

  /**
   * A document with no paths keeps not having one.
   *
   * The member is absent rather than empty so the augmented document stays as
   * close to the generated one as the contributions allow.
   */
  it('adds no paths member when the document has none', () => {
    const result = augmentDocument({ components: {} }, options())

    expect(result).not.toHaveProperty('paths')
  })
})

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

describe('augmentDocument — responses', () => {
  /**
   * Every operation gains the error envelope as its default response.
   *
   * Every error path in this package answers with the envelope, so it is
   * attached as `default` rather than guessed per status: this package knows
   * what an error looks like and does not know which statuses a consumer's
   * handler can produce.
   */
  it('attaches the error envelope to every operation, whatever its method', () => {
    const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']
    const item = Object.fromEntries(methods.map((method) => [method, {}]))

    const result = augmentDocument(
      generated({ '/invoices': item }),
      options({}, { health: health({ enabled: false }) })
    )

    for (const method of methods) {
      const responses = operation(result, '/invoices', method)['responses'] as Record<
        string,
        Record<string, unknown>
      >
      expect(responses['default']).toEqual({
        description: 'Error envelope returned by every failing request.',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/BymaxErrorEnvelope' } }
        }
      })
      // The health payload belongs to the health endpoints alone; contributing
      // it everywhere would document an invoice list as a health report.
      expect(responses).not.toHaveProperty('200')
    }
  })

  /**
   * The health endpoints document the payload they return.
   *
   * This package registered them, so unlike a consumer's operation it knows the
   * success shape precisely.
   */
  it('attaches the health response to the health operations', () => {
    const result = augmentDocument(generated({ ...OWN_ROUTES }), options())
    const responses = operation(result, '/health/ready')['responses'] as Record<string, unknown>

    expect(responses['200']).toMatchObject({
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/BymaxHealthResponse' } }
      }
    })
  })

  /**
   * A response that declares a shape survives untouched.
   *
   * Carrying `content` is what makes a response a real declaration rather than
   * the peer's placeholder, and a consumer who wrote one means it.
   */
  it('keeps a response that already declares content', () => {
    const mine = {
      description: 'my own error',
      content: { 'application/json': { schema: { type: 'object' } } }
    }

    const result = augmentDocument(
      generated({ '/invoices': { get: { responses: { default: mine } } } }),
      options()
    )
    const responses = operation(result, '/invoices')['responses'] as Record<string, unknown>

    expect(responses['default']).toBe(mine)
  })

  /**
   * A response that is only a reference is a declaration too.
   *
   * A response object may legally be nothing but `$ref`. It carries no
   * `content`, so a rule keyed on content alone would overwrite it — discarding
   * the reference and leaving `$ref` beside sibling keys, which is not a valid
   * response object.
   */
  it('keeps a response that is a bare reference', () => {
    const mine = { $ref: '#/components/responses/MyError' }

    const result = augmentDocument(
      generated({ '/invoices': { get: { responses: { default: mine } } } }),
      options()
    )
    const responses = operation(result, '/invoices')['responses'] as Record<string, unknown>

    expect(responses['default']).toBe(mine)
  })

  /**
   * The envelope is documented only while the filter that produces it is on.
   *
   * With `envelope.enabled` false the runtime shapes errors through Nest or the
   * consumer's own handler, so documenting this package's envelope would
   * describe a body the deployment never sends. The health payload is a
   * different feature and is unaffected.
   */
  it('documents the envelope only while the envelope feature is enabled', () => {
    const base = normalizeCoreOptions()
    const off: ResolvedCoreOptions = {
      ...base,
      envelope: { ...base.envelope, enabled: false },
      health: { ...base.health, enabled: true }
    }

    const result = augmentDocument(generated({ ...OWN_ROUTES }), off)
    const invoices = operation(result, '/health/ready')['responses'] as Record<string, unknown>

    expect(invoices).not.toHaveProperty('default')
    expect(invoices).toHaveProperty('200')
  })

  /**
   * The peer's placeholder gets filled in. Regression guard.
   *
   * `@nestjs/swagger` emits a `200` with a description and no `content` for
   * every handler, so an operation is never literally missing its success
   * status. A plain "existing always wins" rule therefore never writes the
   * contributed schema, and every response stays shapeless — which is exactly
   * the orphaned-schemas symptom this work exists to fix.
   */
  it('fills in a placeholder response that declares no shape', () => {
    const result = augmentDocument(
      generated({ '/health/live': { get: { responses: { 200: { description: '' } } } } }),
      options()
    )
    const responses = operation(result, '/health/live')['responses'] as Record<
      string,
      Record<string, unknown>
    >

    expect(responses['200']).toMatchObject({
      description: 'Aggregated health report.',
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/BymaxHealthResponse' } }
      }
    })
  })

  /**
   * A description the document already carries is preserved.
   *
   * The shape is what was missing; the prose may have been written by whoever
   * decorated the handler, and replacing it would discard the one part of the
   * placeholder that can hold real intent.
   */
  it('keeps a non-empty description while filling in the shape', () => {
    const result = augmentDocument(
      generated({ '/health/live': { get: { responses: { 200: { description: 'Alive.' } } } } }),
      options()
    )
    const responses = operation(result, '/health/live')['responses'] as Record<
      string,
      Record<string, unknown>
    >

    expect(responses['200']?.['description']).toBe('Alive.')
    expect(responses['200']).toHaveProperty('content')
  })

  /**
   * Opting out of the schemas opts out of the references to them.
   *
   * Referencing a schema this package did not contribute would leave a dangling
   * `$ref`, and a document that resolves nowhere is worse than one saying less.
   */
  /**
   * Opting out leaves no reference to anything. Regression guard.
   *
   * The narrow assertion below covers one operation; this one covers the whole
   * served document, including the health endpoints whose success response is
   * the one place a reference could be emitted after the catalogue was skipped.
   * A dangling `$ref` is worse than saying less: the document stops resolving.
   */
  it('emits no reference anywhere when includeCoreSchemas is false', () => {
    const result = augmentDocument(
      generated({
        '/health/live': { get: { responses: { 200: { description: '' } } } },
        '/invoices': { get: {} }
      }),
      options({ includeCoreSchemas: false })
    )

    expect(JSON.stringify(result)).not.toContain('$ref')
    expect(result.components).not.toHaveProperty('schemas')
  })

  it('adds no responses when includeCoreSchemas is false', () => {
    const result = augmentDocument(
      generated({ '/invoices': { get: {} } }),
      options({ includeCoreSchemas: false })
    )

    expect(operation(result, '/invoices')).not.toHaveProperty('responses')
  })

  /**
   * Path-item members that are not operations are carried through untouched.
   *
   * A path item may hold `parameters`, `summary` or `$ref` beside its
   * operations; treating one of those as an operation would attach responses to
   * a shared parameter list and corrupt the document.
   */
  it('leaves non-operation members of a path item alone', () => {
    const parameters = [{ name: 'tenant', in: 'header' }]

    const result = augmentDocument(
      generated({ '/invoices': { parameters, get: {} } }),
      options({}, { health: health({ enabled: false }) })
    )
    const item = (result.paths as Record<string, Record<string, unknown>>)['/invoices']

    expect(item?.['parameters']).toBe(parameters)
    expect(operation(result, '/invoices')).toHaveProperty('responses')
  })

  /**
   * A malformed path item. Edge case: wrong type.
   *
   * Nothing enforces the shape of the document handed in, so a non-object path
   * item must degrade to an empty one rather than throw at bootstrap.
   */
  it('tolerates a path item that is not an object', () => {
    const result = augmentDocument(generated({ '/invoices': null }), options())

    expect((result.paths as Record<string, unknown>)['/invoices']).toEqual({})
  })
})

describe('augmentDocument — library contributions', () => {
  /** A contribution as `collectContributions` would have resolved it. */
  function contribution(
    label: string,
    operations: Record<string, Record<string, unknown>> = {},
    components: Record<string, Record<string, Record<string, unknown>>> = {}
  ): ResolvedContribution {
    return { label, operations, components }
  }

  /** A document whose single operation carries the given id. */
  function withOperation(id: string, operation: Record<string, unknown> = {}) {
    return generated({ '/auth/login': { post: { operationId: id, ...operation } } })
  }

  /**
   * A fragment reaches the operation its handler produced.
   *
   * The whole lane in one assertion: a library addresses a handler, the scan
   * named the operation, and the fragment lands on it without either side
   * reconstructing a path.
   */
  it('applies a fragment to the operation carrying its id', () => {
    const result = augmentDocument(
      withOperation('AuthController_login'),
      options(),
      [''],
      [contribution('AuthOpenApi', { AuthController_login: { summary: 'Sign in', security: [] } })]
    )
    const login = operation(result, '/auth/login', 'post')

    expect(login['summary']).toBe('Sign in')
    expect(login['security']).toEqual([])
  })

  /**
   * The document outranks the library.
   *
   * A consumer who decorated their handler said something deliberate about it,
   * and a library shipping the same member must not overwrite it — that
   * precedence is what makes the lane safe to adopt.
   */
  it('keeps a member the operation already declares', () => {
    const result = augmentDocument(
      withOperation('AuthController_login', { summary: 'Mine' }),
      options(),
      [''],
      [contribution('AuthOpenApi', { AuthController_login: { summary: 'Theirs' } })]
    )

    expect(operation(result, '/auth/login', 'post')['summary']).toBe('Mine')
  })

  /**
   * Contributed responses go through the shape-aware rule.
   *
   * A library filling in the peer's placeholder is additive; one overwriting a
   * response that declares content is not. Reusing the rule rather than writing
   * a second one is what keeps the two lanes consistent.
   */
  it('merges contributed responses by shape rather than by presence', () => {
    const mine = { description: 'mine', content: { 'application/json': { schema: {} } } }
    const result = augmentDocument(
      withOperation('AuthController_login', {
        responses: { 200: { description: '' }, 409: mine }
      }),
      options(),
      [''],
      [
        contribution('AuthOpenApi', {
          AuthController_login: {
            responses: {
              200: { description: 'Signed in', content: { 'application/json': { schema: {} } } },
              409: { description: 'theirs', content: { 'application/json': { schema: {} } } }
            }
          }
        })
      ]
    )
    const responses = operation(result, '/auth/login', 'post')['responses'] as Record<
      string,
      Record<string, unknown>
    >

    expect(responses['200']?.['description']).toBe('Signed in')
    expect(responses['409']).toBe(mine)
  })

  /**
   * An operation with no id receives nothing. Edge case.
   *
   * `operationId` is optional in the specification, and a document assembled by
   * hand may omit it. Reading a fragment map with a non-string key would be a
   * lookup on a value this package did not produce.
   */
  it('leaves an operation without an id alone', () => {
    const result = augmentDocument(
      generated({ '/auth/login': { post: {} } }),
      options(),
      [''],
      [contribution('AuthOpenApi', { AuthController_login: { summary: 'Sign in' } })]
    )

    expect(operation(result, '/auth/login', 'post')).not.toHaveProperty('summary')
  })

  /**
   * Contributed components land beneath what the document defines.
   *
   * Same non-destructive rule as everywhere else, applied to a source the
   * consumer did not write, which is precisely when it matters most.
   */
  it('merges contributed components and keeps existing definitions', () => {
    const mine = { type: 'apiKey', in: 'header', name: 'X-Mine' }
    const result = augmentDocument(
      {
        ...withOperation('AuthController_login'),
        components: { securitySchemes: { shared: mine } }
      },
      options(),
      [''],
      [
        contribution(
          'AuthOpenApi',
          {},
          {
            securitySchemes: {
              shared: { type: 'apiKey', in: 'cookie', name: 'theirs' },
              authCookie: { type: 'apiKey', in: 'cookie', name: 'access' }
            }
          }
        )
      ]
    )
    const schemes = components(result, 'securitySchemes')

    expect(schemes['shared']).toBe(mine)
    expect(schemes['authCookie']).toEqual({ type: 'apiKey', in: 'cookie', name: 'access' })
  })

  /**
   * A requirement may name a scheme a library supplied.
   *
   * Validating before the contributed components landed would reject a consumer
   * for naming a scheme their own library provides — the arrangement this lane
   * exists to enable, failing on the lane itself.
   */
  it('accepts a document requirement naming a contributed scheme', () => {
    const build = () =>
      augmentDocument(
        withOperation('AuthController_login'),
        options({ security: [{ authCookie: [] }] }),
        [''],
        [
          contribution(
            'AuthOpenApi',
            {},
            { securitySchemes: { authCookie: { type: 'apiKey', in: 'cookie', name: 'access' } } }
          )
        ]
      )

    expect(build).not.toThrow()
  })

  /**
   * A fragment reaches its operation and no other.
   *
   * The id is the whole address. A merge that ignored it would apply every
   * library's description to every operation in the document — the loudest
   * possible way to be wrong, and one a single-operation fixture cannot see.
   */
  it('applies a fragment only to the operation it names', () => {
    const result = augmentDocument(
      generated({
        '/auth/login': { post: { operationId: 'AuthController_login' } },
        '/auth/logout': { post: { operationId: 'AuthController_logout' } }
      }),
      options(),
      [''],
      [contribution('AuthOpenApi', { AuthController_login: { summary: 'Sign in' } })]
    )

    expect(operation(result, '/auth/login', 'post')['summary']).toBe('Sign in')
    expect(operation(result, '/auth/logout', 'post')).not.toHaveProperty('summary')
  })

  /**
   * A fragment with no responses adds no responses member.
   *
   * Writing an empty one would put a member on an operation that documents
   * nothing, and `responses` is the one place a reader expects meaning.
   */
  it('adds no responses member for a fragment that carries none', () => {
    const result = augmentDocument(
      generated({ '/auth/login': { post: { operationId: 'AuthController_login' } } }),
      options({ includeCoreSchemas: false }),
      [''],
      [contribution('AuthOpenApi', { AuthController_login: { summary: 'Sign in' } })]
    )

    expect(operation(result, '/auth/login', 'post')).not.toHaveProperty('responses')
  })

  /**
   * A library describing one of this package's own routes outranks its policy.
   *
   * The precedence is derived < library < consumer, so what this package infers
   * about its own health probe is the weakest claim in the document: a library
   * that says something specific about that operation knows more than a default
   * does. Unusual, but the rule has to hold at its edge or it is not a rule.
   */
  it('lets a library override this package own-route policy', () => {
    const result = augmentDocument(
      generated({ '/health/live': { get: { operationId: 'HealthController_live' } } }),
      options({ security: [{ cookieAuth: [] }], securitySchemes: SCHEMES }),
      [''],
      [contribution('ProbeOpenApi', { HealthController_live: { security: [{ cookieAuth: [] }] } })]
    )

    expect(operation(result, '/health/live')['security']).toEqual([{ cookieAuth: [] }])
  })

  /**
   * Earlier contributors win over later ones.
   *
   * Two libraries describing the same operation resolve by the stable order the
   * collector imposes; without a rule the answer would depend on the container.
   */
  it('keeps the first contributor member when two collide', () => {
    const result = augmentDocument(
      withOperation('AuthController_login'),
      options(),
      [''],
      [
        contribution('AlphaOpenApi', { AuthController_login: { summary: 'Alpha' } }),
        contribution('ZuluOpenApi', { AuthController_login: { summary: 'Zulu' } })
      ]
    )

    expect(operation(result, '/auth/login', 'post')['summary']).toBe('Alpha')
  })
})

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
