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
import { hash as importedHash, timingSafeEqual as importedEqual } from 'node:crypto'

import {
  Controller,
  Get,
  HttpStatus,
  Inject,
  Logger,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
  VERSION_NEUTRAL
} from '@nestjs/common'
import type { Type } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'

import type { ResolvedCoreOptions } from '../core.options'
import { BYMAX_CORE_OPTIONS, BYMAX_METRICS_REGISTRY } from '../core.tokens'
import {
  afterSettled,
  assertObjectPrototypeClean,
  assertPromiseIntact,
  isGuardRefusal,
  ownIntrinsicConstructor
} from '../object-prototype'
import { assertAsyncFeatureEnabled } from '../passthrough.providers'
import type { MetricsRegistry } from './metrics.registry'
import { ScrapeRun } from './scrape-run'
import { writeLog } from '../write-log'

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

// Captured at load: a replacement of either after import must not decide the bearer check. The digest is the
// one-shot `hash`, which reads no method of a `Hash` instance that a host could replace.
const hash = importedHash
const timingSafeEqual = importedEqual

/**
 * Whether an `Authorization` header presents the configured scrape bearer.
 *
 * The scheme name is matched case-insensitively and tolerates more than one space
 * or tab before the credential, because an HTTP auth scheme is case-insensitive
 * (RFC 7235) — `bearer s3cret` and `Bearer  s3cret` are valid and must be accepted.
 *
 * Both sides are reduced to a fixed-length SHA-256 digest before the constant-time
 * comparison: `timingSafeEqual` throws on unequal buffer lengths, so comparing the
 * raw strings would both crash on a wrong-length token and leak the token's length
 * through that crash. The digest makes every comparison the same shape.
 *
 * @param authorization - The raw `Authorization` header value (anything).
 * @param expected - The configured bearer token, known to be non-empty.
 * @returns Whether the header carries `Bearer <expected>` under any valid casing.
 */
function bearerMatches(authorization: unknown, expected: string): boolean {
  if (typeof authorization !== 'string') {
    return false
  }
  // Strip the `Bearer` scheme prefix and its whitespace separator. `replace` returns
  // the string unchanged when the pattern does not match, so an unchanged result
  // means no bearer scheme was present and the header is rejected.
  const presented = authorization.replace(/^bearer[ \t]+/i, '')
  if (presented === authorization) {
    return false
  }
  const presentedDigest = hash('sha256', presented, 'buffer')
  const expectedDigest = hash('sha256', expected, 'buffer')
  return timingSafeEqual(presentedDigest, expectedDigest)
}

/**
 * The checks a scrape passes before anything is read or collected: the controller matches the options, and
 * `Object.prototype` is the standard one (`503` otherwise, the guard's own error as the cause), since what
 * `prom-client` reads of its labels would answer a name planted there.
 */
function admit(
  options: ResolvedCoreOptions,
  registeredPath: string,
  request: { readonly headers?: Record<string, unknown> }
): void {
  assertControllerMatchesOptions(options, registeredPath)
  // When a token is configured the scrape is credentialed: without it the exposition publishes the route
  // inventory and process internals to anyone. Unset (the default) leaves the endpoint open, to be protected
  // at the edge. Checked first, so a caller without the token learns nothing about the process.
  const { authToken } = options.metrics
  if (authToken !== undefined && !bearerMatches(request.headers?.['authorization'], authToken)) {
    throw new UnauthorizedException()
  }
  assertRuntimeClean(assertObjectPrototypeClean)
}

/** `503` with the guard's own error as the cause when `check` refuses what a host replaced after load. */
function assertRuntimeClean(check: () => void): void {
  try {
    check()
  } catch (cause) {
    throw new ServiceUnavailableException('Metrics are unavailable', { cause })
  }
}

/** The registry's text, with any failure of a collector answered `503` and never left unhandled. */
async function collectOrRefuse(registry: MetricsRegistry): Promise<string> {
  try {
    const collecting = registry.metrics()
    // Settled first, so a promise that cannot be awaited keeps the run in flight until it settles, then is refused.
    await afterSettled(collecting)
    return await ownIntrinsicConstructor(collecting)
  } catch (cause) {
    throw new ServiceUnavailableException('Metrics collection failed', { cause })
  }
}

/** One warning the first time a scrape is refused for what a host replaced, until one passes again. */
class RefusalNote {
  private refusing = false

  /**
   * What a scrape that failed with `error` throws: the guard's bare refusal, which the run raises after it
   * started, becomes the `503` the first check answers. The first refusal since a scrape passed is warned.
   */
  translate(error: unknown): unknown {
    const refusal = isGuardRefusal(error)
      ? new ServiceUnavailableException('Metrics are unavailable', { cause: error })
      : error
    if (
      !this.refusing &&
      refusal instanceof ServiceUnavailableException &&
      isGuardRefusal(refusal.cause)
    ) {
      this.refusing = true
      writeLog(new Logger('MetricsController'), 'warn', {
        event: 'CORE_METRICS_RUNTIME_ALTERED',
        message: 'A built-in was replaced after load: scrapes answer 503 until it is put back'
      })
    }
    return refusal
  }

  /** A scrape passed: the next refusal is written again. */
  clear(): void {
    this.refusing = false
  }
}

/** What one scrape works through. */
interface ScrapeParts {
  readonly scrapes: ScrapeRun
  readonly registry: MetricsRegistry
  readonly refusals: RefusalNote
}

/**
 * Admit the scrape and start (or join) the shared collection. Not async, so the caller's `await` of the
 * returned promise follows the last check with nothing a host can replace in between.
 */
function startScrape(
  options: ResolvedCoreOptions,
  path: string,
  request: { readonly headers?: Record<string, unknown> },
  parts: ScrapeParts
): Promise<string> {
  admit(options, path, request)
  const run = parts.scrapes.run(() => collectOrRefuse(parts.registry))
  // Arming the timer called `setTimeout`, which a host can replace: the check is made again, last.
  assertRuntimeClean(assertPromiseIntact)
  return run
}

/**
 * A `ScrapeRun` that warns once, under the controller's name, when a collection passes its deadline.
 *
 * @param scrapeTimeoutMs - The deadline, from `metrics.scrapeTimeoutMs`.
 * @returns The run the controller scrapes through.
 */
function newScrapeRun(scrapeTimeoutMs: number): ScrapeRun {
  return new ScrapeRun(scrapeTimeoutMs, () => {
    writeLog(new Logger('MetricsController'), 'warn', {
      event: 'CORE_METRICS_SCRAPE_SLOW',
      message: 'Metrics collection is past its bound: scrapes answer 503 until it finishes',
      timeoutMs: scrapeTimeoutMs
    })
  })
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
  @Controller({ path: registeredPath, version: VERSION_NEUTRAL })
  class MetricsController {
    private readonly parts: ScrapeParts

    /**
     * @param registry - The dedicated `prom-client` registry to scrape.
     * @param options - Resolved core options, used to guard consistency at request time.
     * @param adapterHost - The live HTTP adapter, used to reply with the correct content type.
     */
    constructor(
      @Inject(BYMAX_METRICS_REGISTRY) private readonly registry: MetricsRegistry,
      @Inject(BYMAX_CORE_OPTIONS) private readonly options: ResolvedCoreOptions,
      @Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost
    ) {
      this.parts = {
        scrapes: newScrapeRun(options.metrics.scrapeTimeoutMs),
        registry,
        refusals: new RefusalNote()
      }
    }

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
      let body: string
      try {
        body = await startScrape(this.options, registeredPath, request, this.parts)
      } catch (error) {
        throw this.parts.refusals.translate(error)
      }
      this.parts.refusals.clear()
      this.adapterHost.httpAdapter.setHeader(response, 'Content-Type', this.registry.contentType)
      this.adapterHost.httpAdapter.reply(response, body, HttpStatus.OK)
    }
  }
  return MetricsController
}
