/**
 * @fileoverview Health controller factory. `createHealthController` builds a
 * fresh, `@Controller`-decorated class bound to a specific route prefix,
 * because `HealthOptions.path` is only known once `BymaxCoreModule` resolves
 * its options, and a Nest controller's route metadata is fixed at class
 * definition time. The sync registration path (`forRoot`) calls the factory
 * with the resolved `health.path`, honoring a fully custom prefix; the async
 * path (`forRootAsync`) always calls it with the default prefix, because its
 * controllers array is built before the async options resolve, and asserts
 * the resolved configuration is consistent with what was actually registered
 * at every request.
 *
 * The controller replies through the framework-agnostic `HttpAdapterHost`,
 * matching the accessor style used by the exception filter, so Express and
 * Fastify behave identically and readiness can set a dynamic status (200 or
 * 503) without depending on either platform's response type.
 * @layer Controller
 */
import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common'
import type { Type } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'

import type { ResolvedCoreOptions } from '../core.options'
import { DEFAULT_HEALTH_PATH } from '../core.options'
import { BYMAX_CORE_OPTIONS } from '../core.tokens'
import { assertAsyncFeatureEnabled } from '../passthrough.providers'
import type { HealthResponse } from './health.interfaces'
import { HealthService } from './health.service'

/**
 * Guard every request against the resolved options being inconsistent with
 * how this controller instance was actually registered. On the sync path
 * this can never trigger, since the controller is only registered when
 * `health.enabled` is true and always with the matching resolved path. On
 * the async path it is the only way to fail fast instead of silently serving
 * a disabled feature or the wrong prefix.
 *
 * @param options - The resolved core options read at request time.
 * @param registeredPath - The prefix this controller instance was created with.
 * @throws Error When health is disabled, or the resolved `health.path` does
 *   not match the prefix this controller instance serves (only reachable on
 *   the async path, where a custom path is not supported).
 */
function assertControllerMatchesOptions(
  options: ResolvedCoreOptions,
  registeredPath: string
): void {
  assertAsyncFeatureEnabled('health', options.health.enabled)
  if (options.health.path !== registeredPath) {
    throw new Error(
      `[BymaxCoreModule] The "health" controller is registered at "${registeredPath}" but the resolved ` +
        `options request "${options.health.path}". Route metadata is fixed before forRootAsync's options ` +
        `resolve, so a custom "health.path" is only honored through forRoot(); register synchronously, or ` +
        `keep the default "${DEFAULT_HEALTH_PATH}" prefix on the async path.`
    )
  }
}

/**
 * Build a `HealthController` class bound to `registeredPath`. The route
 * prefix is baked into the class's `@Controller` metadata, so calling this
 * factory twice with different prefixes yields two independently routable
 * controller classes.
 *
 * @param registeredPath - The route prefix this controller instance serves.
 * @returns A controller class ready to be added to a module's `controllers` array.
 */
export function createHealthController(registeredPath: string): Type<object> {
  @Controller(registeredPath)
  class HealthController {
    /**
     * @param healthService - The readiness and liveness aggregator.
     * @param options - Resolved core options, used to guard consistency at request time.
     * @param adapterHost - The live HTTP adapter, used to reply with a dynamic status.
     */
    constructor(
      @Inject(HealthService) private readonly healthService: HealthService,
      @Inject(BYMAX_CORE_OPTIONS) private readonly options: ResolvedCoreOptions,
      @Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost
    ) {}

    /**
     * Liveness endpoint: always 200 with the documented empty-checks shape.
     * Runs no indicators.
     *
     * @returns The liveness response.
     */
    @Get('live')
    live(): HealthResponse {
      assertControllerMatchesOptions(this.options, registeredPath)
      return this.healthService.checkLiveness()
    }

    /**
     * Readiness endpoint: 200 when every indicator is up, 503 otherwise, with
     * the full checks array in both cases so the caller can see which check
     * failed.
     *
     * @param response - The native response object, replied to through the
     *   framework-agnostic adapter so the status can vary per outcome.
     */
    @Get('ready')
    async ready(@Res() response: unknown): Promise<void> {
      assertControllerMatchesOptions(this.options, registeredPath)
      const result = await this.healthService.checkReadiness()
      const status = result.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE
      this.adapterHost.httpAdapter.reply(response, result, status)
    }
  }
  return HealthController
}
