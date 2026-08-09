/**
 * Unit tests for module-options resolution and immutability.
 *
 * Layer: unit.
 * Goal: prove `normalizeCoreOptions` applies the documented defaults, merges
 * partial input per feature without dropping siblings, keeps unset optional
 * fields absent, and deep-freezes the result so configuration cannot drift at
 * runtime.
 * Mocks: none (pure function).
 */
import { DEFAULT_CORE_OPTIONS, normalizeCoreOptions } from './core.options'

describe('normalizeCoreOptions', () => {
  /**
   * Empty-input defaults.
   *
   * With no consumer input the resolver must yield the exact documented default
   * matrix; this snapshot is the contract every feature relies on.
   */
  it('applies the documented defaults for empty input', () => {
    expect(normalizeCoreOptions()).toEqual({
      envelope: { enabled: true, exposeInternals: false },
      timing: { enabled: true },
      health: {
        enabled: true,
        path: 'health',
        indicatorTimeoutMs: 5000,
        exposeIndicatorErrors: false,
        autoDiscover: false
      },
      metrics: { enabled: false, path: 'metrics', collectDefaultMetrics: true, defaultLabels: {} },
      openapi: {
        enabled: false,
        suppressedInProduction: false,
        path: 'docs',
        jsonPath: 'docs-json',
        title: 'API',
        description: '',
        version: '1.0.0',
        servers: [],
        securitySchemes: {},
        includeCoreSchemas: true
      },
      telemetry: { enabled: false, exposeTraceId: false }
    })
  })

  /**
   * Unset optional field stays absent.
   *
   * `slowRequestThresholdMs` has no default, so it must not appear as a key on
   * the resolved object rather than being present as `undefined`.
   */
  it('omits slowRequestThresholdMs when the consumer does not set it', () => {
    expect('slowRequestThresholdMs' in normalizeCoreOptions().timing).toBe(false)
  })

  /**
   * Per-feature merge preserves siblings.
   *
   * Overriding one field of one feature must keep that feature's other defaults
   * and must not touch the other features' defaults.
   */
  it('merges a partial feature block without dropping sibling defaults', () => {
    const resolved = normalizeCoreOptions({ health: { path: 'status' } })

    expect(resolved.health).toEqual({
      enabled: true,
      path: 'status',
      indicatorTimeoutMs: 5000,
      exposeIndicatorErrors: false,
      autoDiscover: false
    })
    expect(resolved.metrics.enabled).toBe(false)
    expect(resolved.envelope.enabled).toBe(true)
  })

  /**
   * Every overridable field is honored.
   *
   * A fully-specified input must be reflected verbatim, proving each default is
   * actually overridable (guards against a hard-coded value ignoring input).
   */
  it('honors every explicitly provided field', () => {
    const resolved = normalizeCoreOptions({
      envelope: { enabled: false, exposeInternals: true },
      timing: { enabled: false, slowRequestThresholdMs: 1000 },
      health: {
        enabled: false,
        path: 'hz',
        indicatorTimeoutMs: 250,
        exposeIndicatorErrors: true,
        autoDiscover: true
      },
      metrics: {
        enabled: true,
        path: 'prom',
        collectDefaultMetrics: false,
        defaultLabels: { app: 'api' }
      },
      telemetry: { enabled: true, exposeTraceId: true }
    })

    expect(resolved).toEqual({
      envelope: { enabled: false, exposeInternals: true },
      timing: { enabled: false, slowRequestThresholdMs: 1000 },
      health: {
        enabled: false,
        path: 'hz',
        indicatorTimeoutMs: 250,
        exposeIndicatorErrors: true,
        autoDiscover: true
      },
      metrics: {
        enabled: true,
        path: 'prom',
        collectDefaultMetrics: false,
        defaultLabels: { app: 'api' }
      },
      openapi: {
        enabled: false,
        suppressedInProduction: false,
        path: 'docs',
        jsonPath: 'docs-json',
        title: 'API',
        description: '',
        version: '1.0.0',
        servers: [],
        securitySchemes: {},
        includeCoreSchemas: true
      },
      telemetry: { enabled: true, exposeTraceId: true }
    })
  })

  /**
   * Consumer-owned label object is not captured.
   *
   * The resolver must clone `defaultLabels` so deep-freezing the snapshot never
   * freezes the object the consumer passed in.
   */
  it('clones defaultLabels instead of freezing the consumer object', () => {
    const labels = { app: 'api' }
    const resolved = normalizeCoreOptions({ metrics: { defaultLabels: labels } })

    expect(resolved.metrics.defaultLabels).not.toBe(labels)
    expect(Object.isFrozen(labels)).toBe(false)
  })

  /**
   * A configured scrape token is carried onto the resolved options so the
   * controller can enforce it.
   */
  it('carries a configured metrics authToken through resolution', () => {
    const resolved = normalizeCoreOptions({ metrics: { authToken: 's3cret' } })

    expect(resolved.metrics.authToken).toBe('s3cret')
  })

  /**
   * With no token, or an empty one, `authToken` stays absent rather than
   * present-and-empty: an empty token would arm the guard against a bearer nobody
   * can present, silently sealing the endpoint shut.
   */
  it.each([
    ['omitted', undefined],
    ['an empty string', '']
  ])('leaves metrics authToken absent when %s', (_label, authToken) => {
    const resolved = normalizeCoreOptions({
      metrics: authToken === undefined ? {} : { authToken }
    })

    expect('authToken' in resolved.metrics).toBe(false)
  })

  /**
   * Deep immutability.
   *
   * The snapshot and every nested block must be frozen so no consumer can mutate
   * live configuration after the module is built.
   */
  it('deep-freezes the resolved snapshot and its nested blocks', () => {
    const resolved = normalizeCoreOptions({ metrics: { defaultLabels: { app: 'api' } } })

    expect(Object.isFrozen(resolved)).toBe(true)
    expect(Object.isFrozen(resolved.envelope)).toBe(true)
    expect(Object.isFrozen(resolved.timing)).toBe(true)
    expect(Object.isFrozen(resolved.health)).toBe(true)
    expect(Object.isFrozen(resolved.metrics)).toBe(true)
    expect(Object.isFrozen(resolved.metrics.defaultLabels)).toBe(true)
  })

  /**
   * Mutation is rejected in strict mode.
   *
   * A frozen snapshot must throw on write; specs run as ES modules (strict), so
   * the assignment is expected to throw rather than silently no-op.
   */
  it('throws when a nested field is mutated', () => {
    const resolved = normalizeCoreOptions()

    expect(() => {
      ;(resolved.health as { path: string }).path = 'hacked'
    }).toThrow()
  })

  /**
   * DEFAULT_CORE_OPTIONS mirrors the empty-input resolution.
   *
   * The exported constant must equal a fresh default resolution and be frozen,
   * so consumers can rely on it as the canonical default snapshot.
   */
  it('exposes DEFAULT_CORE_OPTIONS as the frozen default resolution', () => {
    expect(DEFAULT_CORE_OPTIONS).toEqual(normalizeCoreOptions())
    expect(Object.isFrozen(DEFAULT_CORE_OPTIONS)).toBe(true)
  })
})

describe('normalizeCoreOptions, openapi block', () => {
  const originalNodeEnv = process.env['NODE_ENV']

  afterEach(() => {
    // Restored explicitly: `restoreMocks` does not reach process.env, and a
    // leaked value would silently change how every later spec resolves.
    process.env['NODE_ENV'] = originalNodeEnv
  })

  /**
   * Every overridable OpenAPI field is honored.
   *
   * Each documented option must reach the snapshot unchanged in a
   * non-production runtime, so a consumer's document metadata is what the
   * bootstrap helper actually publishes.
   */
  it('honors every supplied field outside production', () => {
    process.env['NODE_ENV'] = 'development'

    const resolved = normalizeCoreOptions({
      openapi: {
        enabled: true,
        path: 'reference',
        jsonPath: 'reference.json',
        title: 'Billing API',
        description: 'Invoices and payments',
        version: '2.4.0',
        servers: [{ url: 'https://api.example.com', description: 'production' }],
        securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
        includeCoreSchemas: false
      }
    })

    expect(resolved.openapi).toEqual({
      enabled: true,
      suppressedInProduction: false,
      path: 'reference',
      jsonPath: 'reference.json',
      title: 'Billing API',
      description: 'Invoices and payments',
      version: '2.4.0',
      servers: [{ url: 'https://api.example.com', description: 'production' }],
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
      includeCoreSchemas: false
    })
  })

  /**
   * Production overrides the consumer's request.
   *
   * The first of the two production guards: asking for the document in
   * production must resolve to disabled, and must record that the refusal
   * happened so the bootstrap helper can warn instead of staying silent.
   */
  it('forces the feature off and records the refusal in production', () => {
    process.env['NODE_ENV'] = 'production'

    const resolved = normalizeCoreOptions({ openapi: { enabled: true } })

    expect(resolved.openapi.enabled).toBe(false)
    expect(resolved.openapi.suppressedInProduction).toBe(true)
  })

  /**
   * An unrecognized runtime is production.
   *
   * Fail-closed: a deployment that never set `NODE_ENV`, or set it to something
   * this package does not know, must not publish its API surface.
   */
  it('treats an unset environment as production', () => {
    delete process.env['NODE_ENV']

    const resolved = normalizeCoreOptions({ openapi: { enabled: true } })

    expect(resolved.openapi.enabled).toBe(false)
    expect(resolved.openapi.suppressedInProduction).toBe(true)
  })

  /**
   * Silence when nothing was asked for.
   *
   * A consumer who never enabled the feature must not be marked as suppressed
   * in production, because the bootstrap helper keys its warning on that flag
   * and an application that opted out should boot quietly.
   */
  it('does not mark the feature suppressed when it was never requested', () => {
    process.env['NODE_ENV'] = 'production'

    const resolved = normalizeCoreOptions({ openapi: { title: 'API' } })

    expect(resolved.openapi.enabled).toBe(false)
    expect(resolved.openapi.suppressedInProduction).toBe(false)
  })

  /**
   * Consumer-owned inputs are copied, never captured.
   *
   * The snapshot is deep-frozen, so a server list or security-scheme map that
   * was copied by reference would freeze an object the consumer still owns and
   * may reuse elsewhere.
   */
  it('clones servers and security schemes instead of freezing the consumer objects', () => {
    process.env['NODE_ENV'] = 'test'
    const servers = [{ url: 'https://api.example.com' }]
    const securitySchemes = { bearer: { type: 'http' } }

    const resolved = normalizeCoreOptions({ openapi: { servers, securitySchemes } })

    expect(resolved.openapi.servers).toEqual(servers)
    expect(resolved.openapi.servers[0]).not.toBe(servers[0])
    expect(resolved.openapi.securitySchemes).toEqual(securitySchemes)
    expect(resolved.openapi.securitySchemes['bearer']).not.toBe(securitySchemes.bearer)
    expect(Object.isFrozen(servers[0])).toBe(false)
    expect(Object.isFrozen(securitySchemes.bearer)).toBe(false)
    expect(Object.isFrozen(resolved.openapi.servers[0])).toBe(true)
  })

  /**
   * An absent server description stays absent.
   *
   * `exactOptionalPropertyTypes` distinguishes a missing key from one set to
   * `undefined`, and a serialized document must not carry a `description: null`
   * for a server that never had one.
   */
  it('omits the server description key when none was supplied', () => {
    const resolved = normalizeCoreOptions({
      openapi: { servers: [{ url: 'https://api.example.com' }] }
    })

    expect(resolved.openapi.servers[0]).not.toHaveProperty('description')
  })
})
