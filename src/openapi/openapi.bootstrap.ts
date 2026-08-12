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
 * this function checks again on its own rather than trusting that snapshot,
 * because the snapshot is a value a consumer can bind themselves. Two layers,
 * neither relying on the other, and no override.
 * @layer Bootstrap
 */
import { Logger } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { ApplicationConfig } from '@nestjs/core'
import type * as Swagger from '@nestjs/swagger'

import type { ResolvedCoreOptions, ResolvedOpenApiOptions } from '../core.options'
import { BYMAX_CORE_OPTIONS } from '../core.tokens'
import { isProductionRuntime } from '../runtime.environment'
import { augmentDocument } from './openapi.document'
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
 * Read the application's global prefix, or an empty string when it has none.
 *
 * The peer writes documented paths *including* the prefix, so this package
 * cannot recognize the routes it registered itself without knowing it. Asking
 * the application beats inferring it from the document: an application whose
 * routes all sit under one controller prefix would have that inferred as the
 * global one, and a consumer route that happened to look like this package's
 * would be treated as ours.
 *
 * Resolved defensively. `ApplicationConfig` is framework-internal rather than a
 * documented contract, so a future Nest release could stop providing it under
 * that token — and failing to mount a document over that would be a poor trade.
 * An unresolvable prefix degrades to none, which is correct for the majority of
 * applications and merely leaves this package's own routes unrecognized for the
 * rest.
 *
 * @param app - The initialized Nest application.
 * @returns The global prefix, without surrounding slashes, or an empty string.
 */
function readGlobalPrefix(app: INestApplication): string {
  try {
    return app.get(ApplicationConfig).getGlobalPrefix()
  } catch {
    return ''
  }
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

  if (isProductionRuntime()) {
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
  const document = augmentDocument(
    swagger.SwaggerModule.createDocument(app, config),
    resolved,
    readGlobalPrefix(app)
  )
  swagger.SwaggerModule.setup(options.path, app, document, {
    jsonDocumentUrl: options.jsonPath
  })
  logger.log(`OpenAPI document served at "/${options.path}" (JSON at "/${options.jsonPath}")`)
  return { mounted: true, path: options.path }
}
