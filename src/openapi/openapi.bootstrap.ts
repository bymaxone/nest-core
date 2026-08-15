/**
 * @fileoverview `applyBymaxOpenApi`, the single place in this package that
 * touches the application instance itself.
 *
 * Building an OpenAPI document requires the `INestApplication` instance, which
 * does not live in the dependency-injection container: no dynamic module can
 * reach it, and no amount of provider wiring changes that. So the feature is
 * configured like every other one — through the options `BymaxCoreModule`
 * already accepts — and only the mounting step is handed the application, in one
 * documented call.
 *
 * This helper is also the second of the two independent production guards. The
 * options resolver has already forced the feature off in a production runtime;
 * this function classifies the runtime again on its own rather than trusting
 * that snapshot's verdict, because the snapshot is a value a consumer can bind
 * themselves. Two layers, neither relying on the other's conclusion.
 *
 * Both layers classify from the same two inputs: `NODE_ENV`, and the
 * environment the application declared through `environment`. `NODE_ENV` wins
 * whenever it says anything, so **no configured value can make a runtime that
 * identified itself as production serve the document**. The declaration is read
 * only where the process declares nothing, which was previously guessed as
 * production — a guess that refused the document to any deployment validating
 * its own environment variable instead. The narrowing is deliberate and worth
 * naming: in that one ambiguous case, the snapshot the consumer bound does
 * decide the answer, because there is nothing else to decide it with.
 * @layer Bootstrap
 */
import { Logger, VERSION_NEUTRAL, VersioningType } from '@nestjs/common'
import type { INestApplication, VersioningOptions } from '@nestjs/common'
import { ApplicationConfig, DiscoveryService, Reflector } from '@nestjs/core'
import type * as Swagger from '@nestjs/swagger'

import type { ResolvedCoreOptions, ResolvedOpenApiOptions } from '../core.options'
import { BYMAX_CORE_OPTIONS } from '../core.tokens'
import { isProductionRuntime, runtimeEnvironmentName } from '../runtime.environment'
import { collectContributions, createHandlerIdMap } from './openapi.contribution'
import type { HandlerIdMap, ResolvedContribution } from './openapi.contribution'
import { augmentDocument, unsecuredOperations } from './openapi.document'
import { loadSwagger } from './openapi.loader'

/** Why the document was not mounted. */
export type OpenApiSkipReason =
  /** The consumer never enabled the feature. */
  | 'disabled'
  /** The runtime is production, where the document is never served. */
  | 'production'

/** What {@link applyBymaxOpenApi} did, so a caller can assert on it. */
export interface OpenApiMountOutcome {
  /** Whether the document and its UI were mounted. */
  mounted: boolean
  /** Present only when `mounted` is `false`. */
  reason?: OpenApiSkipReason
  /** The route the UI was mounted at. Present only when `mounted` is `true`. */
  path?: string
}

/**
 * How many operations the unsecured-operation warning names before eliding the
 * rest into a count.
 *
 * The errors in the merge module list everything they found, and this
 * deliberately does not: an error stops the boot and is read once, while this
 * line scrolls past in a boot log beside everything else, and the version that
 * prints two hundred operation keys is the one an operator learns to skip.
 */
const MAX_WARNED_OPERATIONS = 10

/** Shown when the core options cannot be resolved from the application. */
const OPTIONS_UNRESOLVED_MESSAGE =
  '[BymaxCoreModule] applyBymaxOpenApi could not resolve BYMAX_CORE_OPTIONS from the application. ' +
  'Register BymaxCoreModule (forRoot or forRootAsync) before calling it, and keep the module global ' +
  'or import it into the module you bootstrap.'

/**
 * Read the resolved options out of the running application.
 *
 * @param app - The initialized Nest application.
 * @returns The resolved core options snapshot.
 * @throws Error When `BymaxCoreModule` is not registered, rethrown with guidance
 *   rather than surfacing Nest's generic unknown-token message.
 */
function resolveCoreOptions(app: INestApplication): ResolvedCoreOptions {
  try {
    return app.get<ResolvedCoreOptions>(BYMAX_CORE_OPTIONS)
  } catch (cause) {
    throw new Error(OPTIONS_UNRESOLVED_MESSAGE, { cause })
  }
}

/**
 * Read the application's routing configuration, or `undefined` when it cannot
 * be reached.
 *
 * `ApplicationConfig` is framework-internal rather than a documented contract,
 * so a future Nest release could stop providing it under that token. Failing to
 * mount a document over that would be a poor trade: an application with neither
 * a prefix nor URI versioning — the majority — is unaffected, and the rest
 * merely stop having this package's own routes recognized.
 *
 * @param app - The initialized Nest application.
 * @returns The configuration, or `undefined` when it is unavailable.
 */
function readAppConfig(app: INestApplication): ApplicationConfig | undefined {
  try {
    return app.get(ApplicationConfig)
  } catch {
    return undefined
  }
}

/**
 * The URI segments versioning inserts into a documented path, or `['']` when it
 * inserts none.
 *
 * Only `VersioningType.URI` rewrites paths — header, media-type and custom
 * versioning leave them alone, which is why the type is checked rather than the
 * mere presence of a configuration. Measured against the real scan rather than
 * assumed: `defaultVersion: '1'` documents `/v1/health/live`, `prefix: 'rev'`
 * with version `'2'` documents `/rev2/health/live`, an array documents the
 * route once per version, and `VERSION_NEUTRAL` documents no segment at all.
 *
 * The controllers this package registers declare no version of their own, so
 * they take the default — which is the only case this needs to reproduce.
 *
 * @param versioning - The application's versioning options, if any.
 * @returns The candidate segments, `['']` when the paths carry none.
 */
function versionSegments(versioning: VersioningOptions | undefined): readonly string[] {
  if (versioning === undefined || versioning.type !== VersioningType.URI) {
    return ['']
  }
  const prefix = versioning.prefix === false ? '' : (versioning.prefix ?? 'v')
  const declared = versioning.defaultVersion
  if (declared === undefined) {
    return ['']
  }
  const versions = Array.isArray(declared) ? declared : [declared]
  return versions.map((version) =>
    version === VERSION_NEUTRAL ? '' : `${prefix}${String(version)}`
  )
}

/**
 * Every path prefix this package's own routes can appear under.
 *
 * `@nestjs/swagger` documents paths as the application serves them, so a route
 * this package registered as `health/live` is documented as
 * `/api/v1/health/live` under a global prefix of `api` and URI version `1` —
 * the version segment following the prefix, measured, not assumed. Recognizing
 * its own routes means reproducing that composition; guessing it from the
 * document instead would mistake a consumer's shared controller prefix for the
 * application's own.
 *
 * @param app - The initialized Nest application.
 * @returns The prefixes to try, each without surrounding slashes.
 */
function readPathPrefixes(app: INestApplication): readonly string[] {
  const config = readAppConfig(app)
  if (config === undefined) {
    return ['']
  }
  const globalPrefix = config.getGlobalPrefix()
  // Joined unconditionally: either part may be empty, and the empty segments
  // that produces are dropped when the prefix is normalized on the way in. A
  // filter here would be a second place to keep that rule.
  return versionSegments(config.getVersioning()).map((segment) => `${globalPrefix}/${segment}`)
}

/**
 * The operation-id factory this package installs, which records the mapping and
 * delegates the string.
 *
 * Choosing the id here would rename every operation in every document a
 * consumer already publishes — the peer's own format is
 * `<ControllerKey>_<methodKey>`, plus `_<version>` when versioned, and anything
 * generating a client from that document depends on it. So the factory records
 * what it is asked about and then produces exactly the id that would have been
 * produced anyway: the consumer's own factory when they configured one, the
 * peer's format otherwise. The contract a library keys against is the handler
 * identity, never the id string.
 *
 * @param handlers - The map to record into.
 * @param configured - The consumer's own factory, when they supplied one.
 * @returns A factory to hand to the peer's document scan.
 */
function recordingOperationIdFactory(
  handlers: HandlerIdMap,
  configured: Swagger.OperationIdFactory | undefined
): Swagger.OperationIdFactory {
  return (controllerKey: string, methodKey: string, version?: string): string => {
    const id =
      configured === undefined
        ? defaultOperationId(controllerKey, methodKey, version)
        : configured(controllerKey, methodKey, version)
    handlers.record(controllerKey, methodKey, version, id)
    return id
  }
}

/**
 * Reproduce the peer's own operation-id format.
 *
 * Installing a factory means the peer stops applying its default, so the
 * default has to be restated here. Read from `@nestjs/swagger`'s explorer rather
 * than guessed, and asserted by a test against a document built without a
 * factory, so a change in the peer surfaces as a failure rather than as renamed
 * operations in every consumer's document.
 *
 * @param controllerKey - The controller class name.
 * @param methodKey - The handler method name.
 * @param version - The route's version, when the application versions routes.
 * @returns The id the peer would have produced.
 */
function defaultOperationId(controllerKey: string, methodKey: string, version?: string): string {
  return version === undefined
    ? `${controllerKey}_${methodKey}`
    : `${controllerKey}_${methodKey}_${version}`
}

/**
 * Collect what the libraries in this application contribute to the document.
 *
 * Returns nothing when the provider scan is unavailable. Enabling the document
 * imports `DiscoveryModule`, so an ordinary application always has a scanner;
 * this fallback covers the container that somehow does not — a consumer
 * assembling providers by hand, or a future in which the token moves. Failing
 * to mount over a library's optional description would be a poor trade for a
 * feature that is documentation.
 *
 * @param app - The initialized Nest application.
 * @param handlers - The handler-to-id map filled during the scan.
 * @returns One entry per contributor, or none when discovery is unavailable.
 * @throws Error When a contributor is marked but unusable, throws, or addresses
 *   a handler the application does not have.
 */
function readContributions(
  app: INestApplication,
  handlers: HandlerIdMap
): readonly ResolvedContribution[] {
  let discovery: DiscoveryService
  let reflector: Reflector
  try {
    discovery = app.get(DiscoveryService)
    reflector = app.get(Reflector)
  } catch {
    return []
  }
  return collectContributions(discovery, reflector, handlers)
}

/**
 * Report the operations the served document leaves requiring nothing at all.
 *
 * Warned rather than thrown: an API that is public on purpose is a legitimate
 * configuration, and failing a build over one would be worse than the silence
 * this replaces. Silence is what makes the case worth reporting — the document
 * still validates, every requirement in it still resolves, and the runtime still
 * answers `401`, so no other check in the build can speak about it.
 *
 * @param logger - The logger this helper writes through.
 * @param keys - The affected operation keys, empty when there is nothing to say.
 */
function warnUnsecuredOperations(logger: Logger, keys: readonly string[]): void {
  if (keys.length === 0) {
    return
  }
  const elided = keys.length - MAX_WARNED_OPERATIONS
  const listed = keys.slice(0, MAX_WARNED_OPERATIONS).join(', ')
  // Consequence first, cause second: the sentence that makes someone act is
  // what a client generated from this document will do, and a line read while
  // scrolling past a boot log is read from the front.
  logger.warn(
    `a client generated from the OpenAPI document will send no credentials to ${keys.length} ` +
      `operation(s): ${listed}${elided > 0 ? `, and ${elided} more` : ''}. They state no security ` +
      'requirement, the document declares no default, and other operations in it do state one — ' +
      'so this is more often a missing openapi.security default than a public API. Set ' +
      'openapi.security, or state the intent per operation with an explicit [] in ' +
      'openapi.operationSecurity.'
  )
}

/**
 * Assemble the document's static metadata from the resolved options.
 *
 * @param builder - A fresh builder from the lazily loaded peer.
 * @param options - The resolved OpenAPI options.
 * @returns The document configuration `createDocument` merges its scan into.
 */
function buildConfig(
  builder: Swagger.DocumentBuilder,
  options: ResolvedOpenApiOptions
): Omit<Swagger.OpenAPIObject, 'paths'> {
  builder.setTitle(options.title).setDescription(options.description).setVersion(options.version)
  for (const server of options.servers) {
    builder.addServer(server.url, server.description)
  }
  return builder.build()
}

/**
 * Build and mount the OpenAPI document and its interactive UI, when the
 * configuration and the runtime both allow it.
 *
 * Call it once, after `NestFactory.create` and BEFORE the application starts
 * listening. The ordering is not a style preference: mounting the document
 * re-registers routes on the HTTP adapter, and on Express 5 doing that against
 * an already-initialized application replaces the router — every route the
 * application had, including its own controllers and this package's health
 * endpoints, stops resolving. `app.listen()` performs that initialization, so
 * "before listening" is the whole rule.
 *
 * It is safe to call unconditionally: with the feature disabled, or in
 * production, it mounts nothing, loads no optional peer, and returns why.
 *
 * Testing this under Jest needs one flag. `@nestjs/swagger` is loaded through a
 * dynamic `import()`, which is what keeps the peer optional for everyone who
 * never enables the document — and Jest's module registry cannot service a
 * dynamic import without `NODE_OPTIONS=--experimental-vm-modules`. Without it,
 * only the *enabled* path fails, with `dynamic import callback invoked without
 * --experimental-vm-modules`; the disabled and production paths never reach the
 * loader and pass either way, which is what makes the omission confusing.
 *
 * @param app - The created Nest application, not yet listening.
 * @returns What happened: mounted, or skipped with a reason.
 * @throws Error When `BymaxCoreModule` is not registered, when the feature is
 *   enabled and the optional peer `@nestjs/swagger` is not installed, or when
 *   `openapi.operationSecurity` addresses an operation the generated document
 *   does not contain.
 * @example
 *   const app = await NestFactory.create(AppModule)
 *   await applyBymaxOpenApi(app)
 *   await app.listen(3000)
 */
export async function applyBymaxOpenApi(app: INestApplication): Promise<OpenApiMountOutcome> {
  const logger = new Logger('BymaxCoreModule')
  const resolved = resolveCoreOptions(app)
  const options = resolved.openapi

  if (isProductionRuntime(runtimeEnvironmentName(resolved.environment))) {
    // Warn only when the operator actually asked for the document: an
    // application that never enabled it should boot silently.
    if (options.suppressedInProduction || options.enabled) {
      logger.warn(
        'openapi.enabled was requested but the OpenAPI document is never served in production. ' +
          'Set NODE_ENV to "development" or "test" to serve it.'
      )
    }
    return { mounted: false, reason: 'production' }
  }

  if (!options.enabled) {
    return { mounted: false, reason: 'disabled' }
  }

  const swagger = await loadSwagger()
  const config = buildConfig(new swagger.DocumentBuilder(), options)
  // The map is filled by the scan below, which calls the factory once per
  // operation, so it is complete before any contributor is asked for fragments.
  const handlers = createHandlerIdMap()
  const generated = swagger.SwaggerModule.createDocument(app, config, {
    operationIdFactory: recordingOperationIdFactory(handlers, options.operationIdFactory)
  })
  // Read once and shared: recognizing this package's own routes needs the same
  // prefixes the merge does, and asking the application twice would let the two
  // answers differ for no reason.
  const prefixes = readPathPrefixes(app)
  const document = augmentDocument(generated, resolved, prefixes, readContributions(app, handlers))
  warnUnsecuredOperations(logger, unsecuredOperations(document, resolved, prefixes))
  swagger.SwaggerModule.setup(options.path, app, document, {
    jsonDocumentUrl: options.jsonPath
  })
  logger.log(`OpenAPI document served at "/${options.path}" (JSON at "/${options.jsonPath}")`)
  return { mounted: true, path: options.path }
}
