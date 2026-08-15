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
import {
  ConsoleLogger,
  Controller,
  Get,
  Logger,
  Module,
  Post,
  VERSION_NEUTRAL,
  VersioningType
} from '@nestjs/common'
import type { INestApplication, LoggerService, Type } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { DiscoveryService } from '@nestjs/core'

import { BymaxCoreModule } from '../core.module'
import type { BymaxCoreModuleOptions } from '../core.options'
import { applyBymaxOpenApi } from './openapi.bootstrap'

/** Every operation id in a document, in document order. */
function operationIdsOf(document: unknown): readonly string[] {
  const paths = (document as { paths?: Record<string, Record<string, { operationId?: string }>> })
    .paths
  return Object.values(paths ?? {}).flatMap((item) =>
    Object.values(item)
      .map((operation) => operation.operationId)
      .filter((id): id is string => typeof id === 'string')
  )
}

/** The context every log line this helper writes must carry. */
const LOG_CONTEXT = 'BymaxCoreModule'

/** The exact warning emitted when production refuses a requested document. */
const PRODUCTION_WARNING =
  'openapi.enabled was requested but the OpenAPI document is never served in production. ' +
  'Set NODE_ENV to "development" or "test" to serve it.'

/** The exact warning emitted for a single operation left requiring nothing. */
const UNSECURED_WARNING =
  'a client generated from the OpenAPI document will send no credentials to 1 operation(s): ' +
  'GET /examples. They state no security requirement, the document declares no default, and ' +
  'other operations in it do state one — so this is more often a missing openapi.security ' +
  'default than a public API. Set openapi.security, or state the intent per operation with an ' +
  'explicit [] in openapi.operationSecurity.'

/** The exact guidance thrown when the core options cannot be resolved. */
const UNRESOLVED_GUIDANCE =
  '[BymaxCoreModule] applyBymaxOpenApi could not resolve BYMAX_CORE_OPTIONS from the application. ' +
  'Register BymaxCoreModule (forRoot or forRootAsync) before calling it, and keep the module global ' +
  'or import it into the module you bootstrap.'

/** A module registering nothing at all, used to prove the unresolved-options path. */
@Module({})
class BareModule {}

/** A consumer's controller: one route described, one left as generated. */
@Controller()
class ExampleController {
  /** Stands in for a handler a consumer marks public. */
  @Post('auth/login')
  login(): string {
    return 'ok'
  }

  /** Stands in for the guarded route that loses its requirement. */
  @Get('examples')
  list(): string {
    return 'ok'
  }
}

/**
 * A controller exposing `count` bare GET routes.
 *
 * Built in a loop rather than as a dozen near-identical methods: the count is
 * the only thing that matters to the report's elision, and a dozen copies of
 * the same handler is duplication a reader has to diff to be sure of.
 *
 * @param count - How many routes to expose, as `/bulk/r0` … `/bulk/r<count-1>`.
 * @returns The controller class, ready to register.
 */
function bulkController(count: number): Type<unknown> {
  class BulkController {}
  for (let index = 0; index < count; index += 1) {
    const handler = (): string => 'ok'
    // Named explicitly: `@nestjs/swagger` reads the *function's* name as the
    // handler key, not the property it is defined under, and an arrow taken
    // from a `value:` member is named "value" — so every route would answer to
    // `BulkController.value` and collide, measured rather than assumed.
    Object.defineProperty(handler, 'name', { value: `route${index}` })
    const descriptor: TypedPropertyDescriptor<() => string> = {
      value: handler,
      writable: true,
      configurable: true,
      // Nest's metadata scanner walks the prototype's own members; a
      // non-enumerable one is not a route it can find.
      enumerable: true
    }
    Object.defineProperty(BulkController.prototype, `route${index}`, descriptor)
    Get(`r${index}`)(BulkController.prototype, `route${index}`, descriptor)
  }
  Controller('bulk')(BulkController)
  return BulkController
}

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
async function bootApp(
  options: BymaxCoreModuleOptions,
  controllers: readonly Type<unknown>[] = []
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [BymaxCoreModule.forRoot(options)],
    controllers: [...controllers]
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
   * An unavailable provider scan degrades to no contributions. Edge case.
   *
   * `DiscoveryModule` is imported only when a marker scan can run, and while
   * enabling the document now imports it, a consumer can still reach this
   * helper on an application that does not. Refusing to mount a document
   * because an optional library description could not be collected would be a
   * poor trade for a feature that is documentation.
   */
  it('mounts the document when the provider scan is unavailable', async () => {
    process.env['NODE_ENV'] = 'test'
    app = await bootApp({ openapi: { enabled: true } })
    const realGet = app.get.bind(app)
    jest.spyOn(app, 'get').mockImplementation((token: unknown, ...rest: unknown[]) => {
      if (token === DiscoveryService) {
        throw new Error('not provided')
      }
      return (realGet as (...args: unknown[]) => unknown)(token, ...rest)
    })

    await expect(applyBymaxOpenApi(app)).resolves.toEqual({ mounted: true, path: 'docs' })
  })

  /**
   * The published operation ids are the peer's, not ours. Regression guard.
   *
   * This package installs an operation-id factory so it can learn which handler
   * produced which operation, and installing one stops the peer applying its
   * own default — so the default has to be reproduced here. Getting that wrong
   * renames every operation in every document a consumer publishes, breaking
   * any client generated from it. Asserted by building the same application's
   * document both ways and comparing, so a change in the peer surfaces as a
   * failure here rather than as a silent rename downstream.
   */
  it('publishes the same operation ids the peer would have', async () => {
    process.env['NODE_ENV'] = 'test'
    app = await bootApp({ openapi: { enabled: true } })
    const swagger = await import('@nestjs/swagger')
    const config = new swagger.DocumentBuilder().setTitle('t').setVersion('1').build()
    const peerIds = operationIdsOf(swagger.SwaggerModule.createDocument(app, config))

    await applyBymaxOpenApi(app)
    await app.init()
    const ourIds = operationIdsOf((await request(app.getHttpServer()).get('/docs-json')).body)

    expect(ourIds).not.toEqual([])
    expect(ourIds).toEqual(peerIds)
  })

  /**
   * A versioned route keeps the version in its published id. Regression guard.
   *
   * The peer appends it, so reproducing its format has to append it too — an id
   * dropping the version would collide between two versions of the same handler
   * and silently merge them in a generated client. Compared against the peer
   * rather than against an expected shape, because the shape held a surprise:
   * the version arrives already carrying its prefix, so the id ends `_v2` and
   * not `_2`. Asserting what the peer does beats asserting what it seemed to do.
   */
  it('keeps the version in the published operation id', async () => {
    process.env['NODE_ENV'] = 'test'
    app = await bootApp({ openapi: { enabled: true } })
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '2' })
    const swagger = await import('@nestjs/swagger')
    const config = new swagger.DocumentBuilder().setTitle('t').setVersion('1').build()
    const peerIds = operationIdsOf(swagger.SwaggerModule.createDocument(app, config))

    await applyBymaxOpenApi(app)
    await app.init()
    const ourIds = operationIdsOf((await request(app.getHttpServer()).get('/docs-json')).body)

    expect(ourIds).not.toEqual([])
    expect(ourIds.every((id) => id.endsWith('_v2'))).toBe(true)
    expect(ourIds).toEqual(peerIds)
  })

  /**
   * A consumer's own factory is delegated to, not replaced.
   *
   * The recording wrapper exists to learn the mapping; choosing the id is still
   * the consumer's to control, and a wrapper that ignored their factory would
   * take that away while looking like it had not.
   */
  it('delegates the id string to a configured factory', async () => {
    process.env['NODE_ENV'] = 'test'
    app = await bootApp({
      openapi: {
        enabled: true,
        operationIdFactory: (controllerKey, methodKey) => `${controllerKey}--${methodKey}`
      }
    })

    await applyBymaxOpenApi(app)
    await app.init()
    const ids = operationIdsOf((await request(app.getHttpServer()).get('/docs-json')).body)

    expect(ids).not.toEqual([])
    for (const id of ids) {
      expect(id).toContain('--')
    }
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

  /**
   * An operation left requiring nothing is named on the way up.
   *
   * The regression this guards is silent by construction: the document
   * validates, no requirement dangles, the runtime still answers 401, and a
   * consumer's own document test can stay green if it asserts only the
   * operations it enumerated. The boot log is the one surface that can speak,
   * and it must name the operation — a warning that only says "something is
   * wrong" costs more attention than it saves.
   */
  it('warns about an operation that requires nothing beside one that does', async () => {
    process.env['NODE_ENV'] = 'test'
    app = await bootApp(
      {
        openapi: {
          enabled: true,
          securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'access_token' } },
          operationSecurity: { 'POST /auth/login': [] }
        }
      },
      [ExampleController]
    )

    await applyBymaxOpenApi(app)

    // Asserted whole rather than by fragment: every clause is load-bearing —
    // the consequence leads, the third clause states the trigger so the line
    // explains why it is speaking at all, and the last names both ways out.
    expect(logged.warn).toHaveBeenCalledWith(UNSECURED_WARNING, LOG_CONTEXT)
  })

  /**
   * An application that describes no requirement anywhere boots quietly.
   *
   * This is the genuinely public API, and it decides whether the warning
   * survives contact with real deployments: fired here, the line appears on
   * every boot forever and teaches people to skip warnings — including the one
   * above, which is the whole point of having it.
   */
  it('stays silent when no operation describes a requirement', async () => {
    process.env['NODE_ENV'] = 'test'
    app = await bootApp({ openapi: { enabled: true } }, [ExampleController])

    await applyBymaxOpenApi(app)

    expect(logged.warn).not.toHaveBeenCalled()
  })

  /**
   * A long report is cut short and says how much it cut.
   *
   * Unlike the errors in the merge module, which stop the boot and are read
   * once, this line scrolls past beside everything else a boot prints: the
   * version that names two hundred operations is the version nobody reads. The
   * count that follows is what keeps the truncation honest.
   */
  it('names at most ten operations and counts the rest', async () => {
    process.env['NODE_ENV'] = 'test'
    // Twelve routes, one of them described: eleven are left bare, so ten are
    // named and the report has exactly one to elide.
    app = await bootApp({ openapi: { enabled: true, operationSecurity: { 'GET /bulk/r0': [] } } }, [
      bulkController(12)
    ])

    await applyBymaxOpenApi(app)

    const [message] = (logged.warn as jest.Mock).mock.calls[0] as [string]
    expect(message).toContain('will send no credentials to 11 operation(s)')
    expect(message).toContain('GET /bulk/r1, GET /bulk/r2')
    expect(message).toContain('GET /bulk/r10, and 1 more.')
    expect(message).not.toContain('GET /bulk/r11,')
  })

  /**
   * A report that fits says nothing about a remainder.
   *
   * The boundary the cap turns on: at exactly the limit there is nothing left
   * over, and a line ending "and 0 more" reads as a bug in the tool rather than
   * as a report about the document — which is how a reader learns to distrust
   * the number that matters.
   */
  it('adds no remainder when the report fits exactly', async () => {
    process.env['NODE_ENV'] = 'test'
    // Eleven routes, one described: exactly ten are left bare, which is the cap.
    app = await bootApp({ openapi: { enabled: true, operationSecurity: { 'GET /bulk/r0': [] } } }, [
      bulkController(11)
    ])

    await applyBymaxOpenApi(app)

    const [message] = (logged.warn as jest.Mock).mock.calls[0] as [string]
    expect(message).toContain('will send no credentials to 10 operation(s)')
    expect(message).toContain('GET /bulk/r10. They state no security requirement')
    expect(message).not.toContain(', and 0 more')
  })
})
