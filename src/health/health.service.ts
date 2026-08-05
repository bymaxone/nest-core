/**
 * @fileoverview `HealthService`, the readiness aggregator. Runs every
 * registered `IHealthIndicator` concurrently, applies a per-indicator
 * timeout, and converts a rejection or a timeout into a `down` entry, so one
 * failing or slow indicator never hides the results of the others. No
 * dependency on `@nestjs/terminus`: this is a small, fully tested local
 * implementation (a deliberate spec decision, see the technical
 * specification §8.3). Indicators run flat and concurrently, with no
 * dependency ordering between checks.
 * @layer Service
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import type { OnApplicationBootstrap } from '@nestjs/common'
import { DiscoveryService, Reflector } from '@nestjs/core'

import type { ResolvedCoreOptions } from '../core.options'
import { BYMAX_CORE_OPTIONS, BYMAX_HEALTH_INDICATORS } from '../core.tokens'
import type { ProviderScanner } from '../discovery'
import { discoverIndicators, mergeIndicators } from './health.discovery'
import type { HealthCheckEntry, HealthResponse, IHealthIndicator } from './health.interfaces'

/**
 * The surfaced diagnostic message is at most this many characters, including the
 * trailing ellipsis added when a longer message is truncated.
 */
const MAX_ERROR_MESSAGE_LENGTH = 300

/** Appended to a truncated message; counts toward {@link MAX_ERROR_MESSAGE_LENGTH}. */
const TRUNCATION_ELLIPSIS = '...'

/**
 * Summarize a rejection reason into a bounded-length message for the log. Never
 * surfaces the raw error object, its stack, or any nested cause: only the
 * top-level message, truncated.
 *
 * The result is written to the logger, not to the readiness response. An
 * indicator usually does not author this text — it lets a driver's error
 * propagate, and driver errors carry hosts, ports and sometimes credentials —
 * so bounding it is not enough to make it safe to serve. Where it goes is what
 * makes it safe.
 */
function summarizeRejection(reason: unknown): string {
  let message: string
  try {
    message = reason instanceof Error ? reason.message : String(reason)
  } catch {
    // Coercing an exotic reason (a null-prototype object, a throwing `toString`)
    // must not throw here: this runs inside the rejection-to-`down` conversion,
    // and a throw would reject the wrapper and hide every other indicator.
    message = 'Unknown error'
  }
  if (message.length <= MAX_ERROR_MESSAGE_LENGTH) {
    return message
  }
  return `${message.slice(0, MAX_ERROR_MESSAGE_LENGTH - TRUNCATION_ELLIPSIS.length)}${TRUNCATION_ELLIPSIS}`
}

/**
 * Run one indicator racing a per-indicator timeout. A rejection or a timeout
 * both resolve (never reject) to a `down` entry, and the timeout's timer is
 * always cleared once the race settles, whichever side wins, so no timer
 * ever outlives this call.
 *
 * @param indicator - The indicator to run.
 * @param timeoutMs - The per-indicator timeout, in milliseconds.
 * @returns The named check entry: the indicator's real result, or a `down`
 *   entry describing the timeout or the summarized rejection reason.
 */
async function runIndicator(
  indicator: IHealthIndicator,
  timeoutMs: number,
  exposeErrors: boolean,
  logger: Logger
): Promise<HealthCheckEntry> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<HealthCheckEntry>((resolve) => {
    timer = setTimeout(() => {
      resolve({ name: indicator.name, status: 'down', details: { timedOutAfterMs: timeoutMs } })
    }, timeoutMs)
  })
  // `Promise.resolve().then(...)` defers the actual `indicator.check()` call
  // into a `.then()` callback, so a misbehaving indicator that throws
  // synchronously (instead of returning a rejected promise) is caught by the
  // `.catch()` below just like a normal rejection, instead of escaping this
  // function and rejecting the outer `Promise.all` in `checkReadiness`, which
  // would hide every other indicator's result.
  const checked = Promise.resolve()
    .then(() => indicator.check())
    // Spread the result first, then set the name, so a misbehaving indicator
    // that returns its own `name` cannot spoof the declared check name.
    .then((result) => ({ ...result, name: indicator.name }))
    .catch((reason: unknown): HealthCheckEntry => {
      const message = summarizeRejection(reason)
      // The message goes to the log unconditionally: readiness is usually
      // unauthenticated, and an indicator rarely authors its own failure text —
      // it lets a driver's error propagate, and those carry hosts, ports and
      // sometimes credentials. The log is where access is already controlled.
      logger.warn(`Health indicator "${indicator.name}" reported down: ${message}`)
      return exposeErrors
        ? { name: indicator.name, status: 'down', details: { error: message } }
        : { name: indicator.name, status: 'down' }
    })
  try {
    return await Promise.race([checked, timedOut])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The readiness aggregator. Injected with the health-indicator multi-token
 * and the resolved core options, from which it reads
 * `health.indicatorTimeoutMs`.
 */
@Injectable()
export class HealthService implements OnApplicationBootstrap {
  /**
   * Nest's own logger, scoped to this class. The failure reason of a `down`
   * indicator is written here rather than into the HTTP response, so the
   * diagnostic survives without being served to whoever can reach the probe.
   */
  private readonly logger = new Logger(HealthService.name)

  /**
   * The effective readiness set, computed once. Discovery walks the whole
   * provider graph, and readiness is polled continuously; recomputing per
   * request would put that walk on the probe's path for no benefit, since the
   * container's providers do not change after bootstrap.
   */
  private effectiveIndicators: readonly IHealthIndicator[] | undefined

  /**
   * @param indicators - Every explicitly registered indicator; empty when none
   *   resolve. Injected with `@Optional()`: `BymaxCoreModule` binds no local
   *   default for this token, so a consumer's own `BYMAX_HEALTH_INDICATORS`
   *   binding (from their own, globally-visible module) is not shadowed by one;
   *   when nothing is bound, this defaults to an empty array.
   * @param options - Resolved core options; supplies `indicatorTimeoutMs`.
   * @param discovery - Nest's provider-graph reader, present only when
   *   `DiscoveryModule` is imported, which `BymaxCoreModule` does exactly when
   *   discovery can be needed. Optional so this service stays constructible
   *   without it when the feature is off.
   * @param reflector - Nest's metadata reader, used to match the indicator
   *   marker. Optional for the same reason.
   */
  constructor(
    @Optional()
    @Inject(BYMAX_HEALTH_INDICATORS)
    private readonly indicators: readonly IHealthIndicator[] = [],
    @Inject(BYMAX_CORE_OPTIONS) private readonly options: ResolvedCoreOptions,
    // Injected by Nest's token, but typed as the narrow contract this service
    // actually uses: the dependency is "something that lists providers", not the
    // whole discovery service.
    @Optional() @Inject(DiscoveryService) private readonly discovery?: ProviderScanner,
    @Optional() @Inject(Reflector) private readonly reflector?: Reflector
  ) {}

  /**
   * Resolve the readiness set once the whole container is instantiated.
   *
   * Bound to `onApplicationBootstrap`, not `onModuleInit`: module-init hooks run
   * concurrently across modules, so a provider this scan needs may not exist
   * yet. Running here also means a provider marked as an indicator but not
   * implementing the contract fails the boot, instead of failing the first
   * readiness probe in production.
   */
  onApplicationBootstrap(): void {
    this.resolveIndicators()
  }

  /**
   * The effective readiness set, computed on first use and memoized.
   *
   * @returns The explicit indicators, plus the discovered ones when the feature
   *   is enabled.
   * @throws Error When discovery is enabled but Nest's discovery services are
   *   not reachable, which means this service was constructed outside
   *   `BymaxCoreModule`; a silent fallback would leave an operator believing
   *   checks are running that never run.
   */
  private resolveIndicators(): readonly IHealthIndicator[] {
    if (this.effectiveIndicators !== undefined) {
      return this.effectiveIndicators
    }
    // Gated on `enabled` as well as `autoDiscover`: the asynchronous path
    // registers this service whatever the options say, and scanning for a
    // feature that is switched off would let a misdeclared indicator fail a boot
    // that never asked for readiness at all.
    if (!this.options.health.enabled || !this.options.health.autoDiscover) {
      this.effectiveIndicators = this.indicators
      return this.effectiveIndicators
    }
    if (this.discovery === undefined || this.reflector === undefined) {
      throw new Error(
        "[BymaxCoreModule] health.autoDiscover is enabled but Nest's DiscoveryService is not available. " +
          'Register the health feature through BymaxCoreModule, which imports DiscoveryModule for it.'
      )
    }
    this.effectiveIndicators = mergeIndicators(
      this.indicators,
      discoverIndicators(this.discovery, this.reflector)
    )
    return this.effectiveIndicators
  }

  /**
   * Liveness check: the process is up and able to respond. Runs no
   * indicators, so it never depends on the health of anything else.
   *
   * @returns The documented liveness shape: `{ status: 'ok', checks: [] }`.
   */
  checkLiveness(): HealthResponse {
    return { status: 'ok', checks: [] }
  }

  /**
   * Readiness check: run every indicator in the effective set concurrently and
   * aggregate the results. `status` is `'ok'` only when every indicator
   * reports `up`; an empty indicator list is vacuously `'ok'`.
   *
   * @returns The aggregated health response.
   */
  async checkReadiness(): Promise<HealthResponse> {
    const timeoutMs = this.options.health.indicatorTimeoutMs
    const exposeErrors = this.options.health.exposeIndicatorErrors
    const checks = await Promise.all(
      this.resolveIndicators().map((indicator) =>
        runIndicator(indicator, timeoutMs, exposeErrors, this.logger)
      )
    )
    const status = checks.every((check) => check.status === 'up') ? 'ok' : 'error'
    return { status, checks }
  }
}
