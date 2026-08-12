/**
 * Unit tests for the OpenAPI bootstrap helper.
 *
 * Layer: unit.
 * Goal: prove the helper mounts the document only when both the configuration
 * and the runtime allow it; that the production refusal holds even against a
 * resolved snapshot that says otherwise, and warns only when the operator
 * actually asked for the document; and that a missing module registration fails
 * with guidance instead of Nest's generic unknown-token message.
 * Mocks: none for the peer — the real `@nestjs/swagger` runs against a real Nest
 * application built by `@nestjs/testing`. Nest's logger is replaced through the
 * public `Logger.overrideLogger` hook rather than by spying on
 * `Logger.prototype`: a prototype spy intercepts the call before Nest appends the
 * logger's context, so the context could not be asserted. `NODE_ENV` is set per
 * test and restored.
 */
import { ConsoleLogger, Logger, Module, VERSION_NEUTRAL, VersioningType } from '@nestjs/common'
import type { INestApplication, LoggerService } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { BymaxCoreModule } from '../core.module'
import type { BymaxCoreModuleOptions } from '../core.options'
import { applyBymaxOpenApi } from './openapi.bootstrap'

/** The context every log line this helper writes must carry. */
const LOG_CONTEXT = 'BymaxCoreModule'

/** The exact warning emitted when production refuses a requested document. */
const PRODUCTION_WARNING =
  'openapi.enabled was requested but the OpenAPI document is never served in production. ' +
  'Set NODE_ENV to "development" or "test" to serve it.'

/** The exact guidance thrown when the core options cannot be resolved. */
const UNRESOLVED_GUIDANCE =
  '[BymaxCoreModule] applyBymaxOpenApi could not resolve BYMAX_CORE_OPTIONS from the application. ' +
  'Register BymaxCoreModule (forRoot or forRootAsync) before calling it, and keep the module global ' +
  'or import it into the module you bootstrap.'

/** A module registering nothing at all, used to prove the unresolved-options path. */
@Module({})
class BareModule {}

/** Captures what Nest's logger received, message and context alike. */
const logged: LoggerService = {
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn()
}

/**
 * Build a real application registering `BymaxCoreModule`, deliberately left
 * uninitialized: the helper under test must run before initialization, which is
 * exactly what a real bootstrap does between `NestFactory.create` and `listen`.
 */
async function bootApp(options: BymaxCoreModuleOptions): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [BymaxCoreModule.forRoot(options)]
  }).compile()
  const app = moduleRef.createNestApplication()
  // Installed here, not in `beforeEach`: creating the application applies its own
  // logger options over Nest's global logger, so an override registered earlier
  // is discarded and every assertion on a log line would silently see nothing.
  Logger.overrideLogger(logged)
  return app
}

describe('applyBymaxOpenApi', () => {
  const originalNodeEnv = process.env['NODE_ENV']
  let app: INestApplication | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
    // Both restored explicitly: neither `restoreMocks` nor `clearMocks` reaches
    // process.env or Nest's global logger override.
    process.env['NODE_ENV'] = originalNodeEnv
    Logger.overrideLogger(new ConsoleLogger())
  })

  /**
   * The happy path: enabled outside production.
   *
   * The document and its UI must mount at the resolved route, and the helper
   * must report the route it used so a caller can log or assert on it.
   */
  it('mounts the document at the resolved path outside production', async () => {
    process.env['NODE_ENV'] = 'development'
    app = await bootApp({ openapi: { enabled: true, path: 'reference' } })

    const outcome = await applyBymaxOpenApi(app)

    expect(outcome).toEqual({ mounted: true, path: 'reference' })
    // The log line names both served routes under this package's context: it is
    // the only feedback a developer gets that the document is up, and where.
    expect(logged.log).toHaveBeenCalledWith(
      'OpenAPI document served at "/reference" (JSON at "/docs-json")',
      LOG_CONTEXT
    )
  })

  /**
   * Disabled is a silent no-op.
   *
   * Calling the helper unconditionally must be safe: with the feature off it
   * mounts nothing and reports why, so a template can always emit the call.
   */
  it('mounts nothing and reports "disabled" when the feature is off', async () => {
    process.env['NODE_ENV'] = 'development'
    app = await bootApp({})

    const outcome = await applyBymaxOpenApi(app)

    expect(outcome).toEqual({ mounted: false, reason: 'disabled' })
  })

  /**
   * The second production guard, against a snapshot that says otherwise.
   *
   * The options were resolved outside production, so the snapshot carries
   * `enabled: true`. Mounting must still be refused once the runtime is
   * production, because this layer does not trust the other one — that
   * independence is the whole point of having two.
   */
  it('refuses to mount in production even when the snapshot says enabled', async () => {
    process.env['NODE_ENV'] = 'development'
    app = await bootApp({ openapi: { enabled: true } })
    process.env['NODE_ENV'] = 'production'

    const outcome = await applyBymaxOpenApi(app)

    expect(outcome).toEqual({ mounted: false, reason: 'production' })
    // Asserted whole: the warning has to say both what was ignored and how to
    // get the document back, or it is a dead end for whoever reads it.
    expect(logged.warn).toHaveBeenCalledWith(PRODUCTION_WARNING, LOG_CONTEXT)
    expect(logged.log).not.toHaveBeenCalled()
  })

  /**
   * The refusal is explained when it was requested.
   *
   * With options resolved in production the snapshot already reads disabled, so
   * the recorded suppression flag is the only thing that distinguishes "the
   * operator wanted this" from "the operator never asked" — and it must produce
   * the warning.
   */
  it('warns when the document was requested and production suppressed it', async () => {
    process.env['NODE_ENV'] = 'production'
    app = await bootApp({ openapi: { enabled: true } })

    const outcome = await applyBymaxOpenApi(app)

    expect(outcome).toEqual({ mounted: false, reason: 'production' })
    expect(logged.warn).toHaveBeenCalledTimes(1)
    expect(logged.warn).toHaveBeenCalledWith(PRODUCTION_WARNING, LOG_CONTEXT)
  })

  /**
   * Silence for an application that never opted in.
   *
   * A production service that does not use the feature must boot without a
   * warning about it; a log line nobody can act on is noise that trains
   * operators to ignore the channel.
   */
  it('stays silent in production when the document was never requested', async () => {
    process.env['NODE_ENV'] = 'production'
    app = await bootApp({})

    const outcome = await applyBymaxOpenApi(app)

    expect(outcome).toEqual({ mounted: false, reason: 'production' })
    expect(logged.warn).not.toHaveBeenCalled()
  })

  /**
   * A missing module registration fails with guidance. Edge case.
   *
   * Without `BymaxCoreModule`, the token cannot resolve. The whole message is
   * asserted because each of its three sentences carries a distinct instruction
   * — what failed, what to register, and how the module must be visible — and a
   * message missing one of them sends the reader back to the source.
   */
  it('throws a descriptive error when BymaxCoreModule is not registered', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [BareModule] }).compile()
    app = moduleRef.createNestApplication()

    await expect(applyBymaxOpenApi(app)).rejects.toThrow(UNRESOLVED_GUIDANCE)
  })

  /**
   * The original resolution failure survives. Edge case: chained cause.
   *
   * The guidance replaces Nest's message, so without chaining the underlying
   * error the actual container failure would be lost — leaving no way to tell a
   * missing registration apart from a different resolution problem.
   */
  it('chains the container failure as the error cause', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [BareModule] }).compile()
    app = moduleRef.createNestApplication()

    await expect(applyBymaxOpenApi(app)).rejects.toMatchObject({
      cause: expect.any(Error)
    })
  })

  /**
   * Every URI-versioning shape maps to the segments the peer documents.
   *
   * Measured against the real scan before being encoded here: a plain default
   * version documents `/v1/…`, a custom `prefix` replaces the `v`, `prefix:
   * false` drops it, an array documents the route once per version, and
   * `VERSION_NEUTRAL` — like every non-URI type — inserts nothing. Asserted
   * through the served document rather than on a private helper, so the mapping
   * is pinned to what a consumer actually gets.
   */
  it.each([
    ['a default version', { type: VersioningType.URI, defaultVersion: '1' }, ['/v1/metrics']],
    [
      'a custom version prefix',
      { type: VersioningType.URI, defaultVersion: '2', prefix: 'rev' },
      ['/rev2/metrics']
    ],
    [
      'no version prefix',
      { type: VersioningType.URI, defaultVersion: '3', prefix: false },
      ['/3/metrics']
    ],
    [
      'several default versions',
      { type: VersioningType.URI, defaultVersion: ['1', '2'] },
      ['/v1/metrics', '/v2/metrics']
    ],
    [
      'a neutral default version',
      { type: VersioningType.URI, defaultVersion: VERSION_NEUTRAL },
      ['/metrics']
    ],
    [
      'header versioning',
      { type: VersioningType.HEADER, header: 'X-Version', defaultVersion: '1' },
      ['/metrics']
    ],
    // URI versioning with no default documents the routes unsegmented, which
    // was measured rather than assumed — a segment invented here would leave
    // the disabled route advertised.
    ['URI versioning with no default', { type: VersioningType.URI }, ['/metrics']]
  ])('removes the disabled scrape route under %s', async (_label, versioning, documented) => {
    process.env['NODE_ENV'] = 'test'
    const moduleRef = await Test.createTestingModule({
      imports: [
        BymaxCoreModule.forRootAsync({
          useFactory: () => ({ openapi: { enabled: true }, metrics: { enabled: false } })
        })
      ]
    }).compile()
    app = moduleRef.createNestApplication()
    app.enableVersioning(versioning as Parameters<typeof app.enableVersioning>[0])
    await applyBymaxOpenApi(app)
    await app.init()

    const paths = (await request(app.getHttpServer()).get('/docs-json')).body['paths'] as Record<
      string,
      unknown
    >

    for (const route of documented) {
      expect(paths).not.toHaveProperty(route)
    }
  })

  /**
   * The prefix and the version segment compose, in that order.
   *
   * Measured against the real scan: the version follows the global prefix, so
   * the scrape endpoint is documented as `/api/v1/metrics`. Joining the two the
   * wrong way — or not joining them at all — leaves the disabled route
   * advertised, which is the failure this recognition exists to prevent.
   */
  it('removes the disabled scrape route under a prefix and a version together', async () => {
    process.env['NODE_ENV'] = 'test'
    const moduleRef = await Test.createTestingModule({
      imports: [
        BymaxCoreModule.forRootAsync({
          useFactory: () => ({ openapi: { enabled: true }, metrics: { enabled: false } })
        })
      ]
    }).compile()
    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('api')
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })
    await applyBymaxOpenApi(app)
    await app.init()

    const paths = (await request(app.getHttpServer()).get('/docs-json')).body['paths'] as Record<
      string,
      unknown
    >

    expect(paths).not.toHaveProperty('/api/v1/metrics')
  })

  /**
   * An unreadable global prefix degrades to none. Edge case.
   *
   * `ApplicationConfig` is framework-internal rather than a documented
   * contract, so a future Nest release could stop providing it under that
   * token. Failing to mount the document over that would be a poor trade: an
   * application with no prefix — the majority — is unaffected, and the rest
   * merely stop having this package's own routes recognized. Simulated by
   * making the lookup throw, which is what an unregistered provider does.
   */
  it('mounts the document when the global prefix cannot be read', async () => {
    process.env['NODE_ENV'] = 'test'
    // Registered asynchronously on purpose: that path mounts the metrics
    // controller whatever the options say, so the route is in the document and
    // the filter has something to find. On the synchronous path a disabled
    // feature registers nothing, and "the route is absent" would be true no
    // matter what prefix this package believed in.
    const moduleRef = await Test.createTestingModule({
      imports: [
        BymaxCoreModule.forRootAsync({
          useFactory: () => ({ openapi: { enabled: true }, metrics: { enabled: false } })
        })
      ]
    }).compile()
    app = moduleRef.createNestApplication()
    const realGet = app.get.bind(app)
    jest.spyOn(app, 'get').mockImplementation((token: unknown, ...rest: unknown[]) => {
      if (typeof token === 'function' && token.name === 'ApplicationConfig') {
        throw new Error('not provided')
      }
      return (realGet as (...args: unknown[]) => unknown)(token, ...rest)
    })

    const outcome = await applyBymaxOpenApi(app)
    await app.init()
    const document = (await request(app.getHttpServer()).get('/docs-json')).body

    expect(outcome).toEqual({ mounted: true, path: 'docs' })
    // Degraded to "no prefix", which is what an unreadable one must mean: this
    // package's own routes are then recognized unprefixed, so a disabled
    // feature at the default path still leaves the document.
    expect(document['paths']).not.toHaveProperty('/metrics')
  })

  /**
   * The consumer's metadata and the package's schemas reach the served JSON.
   *
   * Title, version and servers are configuration, not decoration: they must
   * travel from the module options through the builder into the document the
   * application actually serves, alongside the schemas this package
   * contributes, without the application writing any of it by hand.
   */
  it('serves the configured metadata and the contributed schemas at the JSON route', async () => {
    process.env['NODE_ENV'] = 'test'
    app = await bootApp({
      openapi: {
        enabled: true,
        jsonPath: 'openapi.json',
        title: 'Billing API',
        version: '2.4.0',
        servers: [{ url: 'https://api.example.com', description: 'production' }],
        securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } }
      }
    })

    await applyBymaxOpenApi(app)
    await app.init()
    const response = await request(app.getHttpServer()).get('/openapi.json')

    expect(response.status).toBe(200)
    expect(response.body.info).toMatchObject({ title: 'Billing API', version: '2.4.0' })
    expect(response.body.servers).toEqual([
      { url: 'https://api.example.com', description: 'production' }
    ])
    expect(response.body.components.schemas).toHaveProperty('BymaxErrorEnvelope')
    expect(response.body.components.securitySchemes).toHaveProperty('bearer')
  })
})
