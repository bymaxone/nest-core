/**
 * @fileoverview Metrics controller factory. `createMetricsController` builds a
 * fresh, `@Controller`-decorated class bound to a specific route, because
 * `MetricsOptions.path` is only known once `BymaxCoreModule` resolves its
 * options and a Nest controller's route metadata is fixed at class-definition
 * time. The sync registration path (`forRoot`) calls the factory with the
 * resolved `metrics.path` only when the feature is enabled; the async path
 * (`forRootAsync`) always calls it with the default route, because its
 * controllers array is built before the async options resolve, and the handler
 * asserts the resolved configuration is consistent with what was registered.
 *
 * The controller is intentionally thin: it delegates to the injected
 * `prom-client` `Registry`, serving its text exposition through the
 * framework-agnostic `HttpAdapterHost` with the registry's own content type, so
 * Express and Fastify behave identically and no metric is ever mutated here.
 * @layer Controller
 */
import { createHash, timingSafeEqual } from 'node:crypto'

import {
  Controller,
  Get,
  HttpStatus,
  Inject,
  Req,
  Res,
  UnauthorizedException
} from '@nestjs/common'
import type { Type } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'

import type { ResolvedCoreOptions } from '../core.options'
import { BYMAX_CORE_OPTIONS, BYMAX_METRICS_REGISTRY } from '../core.tokens'
import { assertAsyncFeatureEnabled } from '../passthrough.providers'
import type { MetricsRegistry } from './metrics.registry'

/**
 * Guard every request against the resolved options being inconsistent with how
 * this controller instance was registered. On the sync path this can never
 * trigger, since the controller is only registered when `metrics.enabled` is
 * true and always with the matching resolved path. On the async path it is the
 * only way to fail fast instead of silently serving a disabled feature or the
 * wrong route.
 *
 * @param options - The resolved core options read at request time.
 * @param registeredPath - The route this controller instance was created with.
 * @throws Error When metrics is disabled, or the resolved `metrics.path` does
 *   not match the route this controller instance serves (only reachable on the
 *   async path, where a custom path is not supported).
 */
function assertControllerMatchesOptions(
  options: ResolvedCoreOptions,
  registeredPath: string
): void {
  assertAsyncFeatureEnabled('metrics', options.metrics.enabled)
  if (options.metrics.path !== registeredPath) {
    throw new Error(
      `[BymaxCoreModule] The "metrics" controller is registered at "${registeredPath}" but the resolved ` +
        `options request "${options.metrics.path}". Route metadata is fixed before forRootAsync's options ` +
        `resolve, so a custom "metrics.path" is only honored through forRoot(); register synchronously, or ` +
        `keep the default "metrics" route on the async path.`
    )
  }
}

/**
 * Whether an `Authorization` header presents the configured scrape bearer.
 *
 * Both sides are reduced to a fixed-length SHA-256 digest before the constant-time
 * comparison: `timingSafeEqual` throws on unequal buffer lengths, so comparing the
 * raw strings would both crash on a wrong-length token and leak the token's length
 * through that crash. The digest makes every comparison the same shape.
 *
 * @param authorization - The raw `Authorization` header value (anything).
 * @param expected - The configured bearer token, known to be non-empty.
 * @returns Whether the header carries `Bearer <expected>`.
 */
function bearerMatches(authorization: unknown, expected: string): boolean {
  const prefix = 'Bearer '
  if (typeof authorization !== 'string' || !authorization.startsWith(prefix)) {
    return false
  }
  const presented = authorization.slice(prefix.length)
  const presentedDigest = createHash('sha256').update(presented).digest()
  const expectedDigest = createHash('sha256').update(expected).digest()
  return timingSafeEqual(presentedDigest, expectedDigest)
}

/**
 * Build a `MetricsController` class bound to `registeredPath`. The route is
 * baked into the class's `@Controller` metadata, so calling this factory twice
 * with different routes yields two independently routable controller classes.
 *
 * @param registeredPath - The route this controller instance serves.
 * @returns A controller class ready to be added to a module's `controllers` array.
 */
export function createMetricsController(registeredPath: string): Type<object> {
  @Controller(registeredPath)
  class MetricsController {
    /**
     * @param registry - The dedicated `prom-client` registry to scrape.
     * @param options - Resolved core options, used to guard consistency at request time.
     * @param adapterHost - The live HTTP adapter, used to reply with the correct content type.
     */
    constructor(
      @Inject(BYMAX_METRICS_REGISTRY) private readonly registry: MetricsRegistry,
      @Inject(BYMAX_CORE_OPTIONS) private readonly options: ResolvedCoreOptions,
      @Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost
    ) {}

    /**
     * Scrape endpoint: serve the registry's Prometheus text exposition with the
     * registry's own content type. The controller delegates entirely to
     * `prom-client` and never mutates a metric.
     *
     * @param response - The native response object, replied to through the
     *   framework-agnostic adapter so the content type is set consistently
     *   across HTTP platforms.
     */
    @Get()
    async scrape(
      @Res() response: unknown,
      @Req() request: { readonly headers?: Record<string, unknown> }
    ): Promise<void> {
      assertControllerMatchesOptions(this.options, registeredPath)
      // When a token is configured the scrape is credentialed: without it the
      // exposition publishes the route inventory and process internals to anyone.
      // Unset (the default) leaves the endpoint open, to be protected at the edge.
      const { authToken } = this.options.metrics
      if (
        authToken !== undefined &&
        !bearerMatches(request.headers?.['authorization'], authToken)
      ) {
        throw new UnauthorizedException()
      }
      const body = await this.registry.metrics()
      this.adapterHost.httpAdapter.setHeader(response, 'Content-Type', this.registry.contentType)
      this.adapterHost.httpAdapter.reply(response, body, HttpStatus.OK)
    }
  }
  return MetricsController
}
