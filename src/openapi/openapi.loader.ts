/**
 * @fileoverview Lazy `@nestjs/swagger` loader. The peer is optional: consumers
 * who never enable the OpenAPI feature never install it and never load it.
 *
 * Every runtime touch of `@nestjs/swagger` in the whole package stays behind the
 * dynamic `import()` executed here, so a static top-level import never leaks the
 * dependency into consumers who leave the feature disabled. The `import type`
 * references below are erased at compile time and never load the module at
 * runtime.
 * @layer Provider
 */
import type { INestApplication } from '@nestjs/common'
import type * as Swagger from '@nestjs/swagger'

import { isMissingModuleError, missingPeerMessage } from '../optional-peer'

/** Guidance shown when the feature is enabled but the optional peer is absent. */
const MISSING_PEER_MESSAGE = missingPeerMessage('openapi.enabled', '@nestjs/swagger')

/**
 * The subset of the `@nestjs/swagger` module surface this package uses at
 * runtime. Declared structurally, and only over a type-only namespace import, so
 * the lazily loaded module is fully typed without a top-level runtime import
 * that would defeat the optional-peer contract.
 */
export interface SwaggerModuleSurface {
  /** The fluent builder for the document's static metadata. */
  readonly DocumentBuilder: new () => Swagger.DocumentBuilder
  /** Document generation and route mounting. */
  readonly SwaggerModule: {
    /** Scan the application's controllers into a document. */
    createDocument(
      app: INestApplication,
      config: Omit<Swagger.OpenAPIObject, 'paths'>,
      options?: Swagger.SwaggerDocumentOptions
    ): Swagger.OpenAPIObject
    /** Mount the UI and the raw document on the application's HTTP adapter. */
    setup(
      path: string,
      app: INestApplication,
      document: Swagger.OpenAPIObject,
      options?: Swagger.SwaggerCustomOptions
    ): void
  }
}

/**
 * Load `@nestjs/swagger` lazily through a dynamic import. This is the only
 * runtime access to the optional peer in the whole package; a module-not-found
 * failure is rethrown as a descriptive boot error naming the package and the
 * install command, so enabling the feature without the peer fails fast and
 * legibly instead of surfacing a cryptic resolution error while the application
 * is already accepting traffic.
 *
 * @returns The loaded `@nestjs/swagger` module.
 * @throws Error When `@nestjs/swagger` is not installed.
 */
export async function loadSwagger(): Promise<SwaggerModuleSurface> {
  try {
    return await import('@nestjs/swagger')
  } catch (cause) {
    if (isMissingModuleError(cause)) {
      throw new Error(MISSING_PEER_MESSAGE, { cause })
    }
    throw cause
  }
}
