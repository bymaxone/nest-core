/**
 * @fileoverview `HealthService`, the readiness aggregator. Runs every
 * registered `IHealthIndicator` concurrently, applies a per-indicator
 * timeout, and converts a rejection or a timeout into a `down` entry, so one
 * failing or slow indicator never hides the results of the others. No
 * dependency on `@nestjs/terminus`: this is a small, fully tested local
 * implementation (a deliberate spec decision, see the technical
 * specification §8.4). Indicators run flat and concurrently, with no
 * dependency ordering between checks.
 *
 * This is also where a readiness failure becomes a record: the aggregator holds
 * the last state of every check and reports each *change*, to its own logger and
 * to an `IHealthTransitionSink` when one is bound. Why that rule belongs here
 * rather than in each consuming backend is argued in `health.transition.ts`.
 * @layer Service
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import type { OnApplicationBootstrap } from '@nestjs/common'
import { DiscoveryService, Reflector } from '@nestjs/core'

import type { ResolvedCoreOptions } from '../core.options'
import {
  BYMAX_CORE_OPTIONS,
  BYMAX_HEALTH_INDICATORS,
  BYMAX_HEALTH_TRANSITION_SINK
} from '../core.tokens'
import type { ProviderScanner } from '../discovery'
import { discoverIndicators, mergeIndicators } from './health.discovery'
import type { HealthCheckEntry, HealthResponse, IHealthIndicator } from './health.interfaces'
import type {
  HealthTransition,
  HealthTransitionCause,
  IHealthTransitionSink
} from './health.transition'

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
 * One indicator's resolved result, paired with why it is down. The cause cannot
 * be recovered from the entry afterwards: a timeout and a deliberate `down` are
 * the same entry once `health.exposeIndicatorErrors` is off, its production
 * setting. A union, so the reporter needs no branch for an impossible state.
 */
type IndicatorOutcome =
  | {
      /** The entry as the readiness response will carry it. */
      readonly entry: HealthCheckEntry
      /** The dependency answered healthy. */
      readonly isUp: true
    }
  | {
      /** The entry as the readiness response will carry it. */
      readonly entry: HealthCheckEntry
      /** The dependency is not reachable. */
      readonly isUp: false
      /** Why. Carried in the type so the reporter needs no defensive branch. */
      readonly cause: HealthTransitionCause
    }

/**
 * Run one indicator racing a per-indicator timeout. A rejection or a timeout
 * both resolve (never reject) to a `down` entry, and the timeout's timer is
 * always cleared once the race settles, whichever side wins, so no timer
 * ever outlives this call.
 *
 * Nothing is logged here. Every down path returns its cause instead, and the
 * caller decides what is worth a line.
 *
 * @param indicator - The indicator to run.
 * @param timeoutMs - The per-indicator timeout, in milliseconds.
 * @param exposeErrors - Whether a rejection's message is copied into the served
 *   entry's `details.error`; it reaches the cause either way.
 * @returns The named check entry — the indicator's real result, or a `down`
 *   entry describing the timeout or the summarized rejection reason — and the
 *   cause behind it.
 */
async function runIndicator(
  indicator: IHealthIndicator,
  timeoutMs: number,
  exposeErrors: boolean
): Promise<IndicatorOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<IndicatorOutcome>((resolve) => {
    timer = setTimeout(() => {
      resolve({
        entry: { name: indicator.name, status: 'down', details: { timedOutAfterMs: timeoutMs } },
        isUp: false,
        cause: { kind: 'timed-out', timeoutMs }
      })
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
    .then((result): IndicatorOutcome => {
      const entry = { ...result, name: indicator.name }
      // Anything that is not `up` counts as down, matching how the aggregate
      // status below reads the same field, so a misbehaving indicator cannot
      // be down in the response and up in the log.
      return result.status === 'up'
        ? { entry, isUp: true }
        : { entry, isUp: false, cause: { kind: 'reported-down' } }
    })
    .catch((reason: unknown): IndicatorOutcome => {
      const message = summarizeRejection(reason)
      return {
        entry: exposeErrors
          ? { name: indicator.name, status: 'down', details: { error: message } }
          : { name: indicator.name, status: 'down' },
        isUp: false,
        cause: { kind: 'rejected', message }
      }
    })
  try {
    return await Promise.race([checked, timedOut])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Render a cause as the tail of a log line.
 *
 * @param cause - The cause to describe.
 * @returns A human-readable fragment naming what happened.
 */
function describeCause(cause: HealthTransitionCause): string {
  switch (cause.kind) {
    case 'rejected':
      return `the indicator rejected: ${cause.message}`
    case 'timed-out':
      return `the indicator did not answer within ${cause.timeoutMs}ms`
    case 'reported-down':
      return 'the indicator reported it down'
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
   * The last state observed per check name, absent until the first observation,
   * tagged with the probe that observed it. Keyed by name, so one map serves
   * every check and one dependency can neither trigger nor suppress another's
   * line. This is the state that makes the difference between a line per change
   * and a line per probe.
   */
  private readonly lastState = new Map<string, { readonly isUp: boolean; readonly seq: number }>()

  /**
   * Counts readiness probes, so an outcome can be ordered against what is
   * already recorded. Readiness is not called one at a time: an orchestrator's
   * probe and a load balancer's health check reach this concurrently, and this
   * feature's own subject — a dependency that hangs until `indicatorTimeoutMs`
   * elapses — is exactly what makes an earlier probe finish after a later one.
   * Comparing states alone would then let the stale observation win.
   */
  private probeSequence = 0

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
   * @param transitionSink - Receives one event per change of readiness state.
   *   `@Optional()` and bound to nothing by default, for the same reason as the
   *   indicator array: a local default here would shadow a consumer's override.
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
    @Optional() @Inject(Reflector) private readonly reflector?: Reflector,
    @Optional()
    @Inject(BYMAX_HEALTH_TRANSITION_SINK)
    private readonly transitionSink?: IHealthTransitionSink
  ) {}

  /**
   * Report one check's current state, emitting only when it differs from the
   * last state observed for that name.
   *
   * The asymmetry on a first observation is deliberate. A first observation that
   * is FAILING is a transition: a process that boots against a dependency
   * already down would otherwise look healthy in the log forever. A first
   * observation that is HEALTHY is not: that is the expected state, and
   * announcing it would write one line per dependency on every boot — the noise
   * the probe-path exclusion exists to keep out.
   *
   * A cause is recorded at the transition, so a dependency that stays down while
   * its failure mode changes underneath keeps the first one. That is the cost of
   * one line per outage instead of one per probe.
   *
   * @param outcome - The indicator's resolved outcome for this probe.
   * @param seq - The probe that produced it, from {@link probeSequence}.
   */
  private reportTransition(outcome: IndicatorOutcome, seq: number): void {
    const name = outcome.entry.name
    const previous = this.lastState.get(name)
    // An outcome no newer than the one already recorded describes a moment that
    // has since been superseded, so it is dropped rather than reported. Without
    // this a hung dependency writes the sequence backwards: the later probe
    // reports the recovery, then the earlier one's timeout lands behind it and
    // reports the dependency down again.
    //
    // `<=` rather than `<` also settles the one case where two outcomes share a
    // probe: nothing stops a consumer binding two indicators under the same
    // name — `mergeIndicators` dedupes the discovered set against the explicit
    // one, not the explicit one against itself — and the first observation of a
    // name is what the aggregate response reports, so it is what the log follows
    // too. Names that differ are unaffected: their first outcome finds no
    // previous entry at all.
    if (previous !== undefined && seq <= previous.seq) {
      return
    }
    const changed = previous?.isUp !== outcome.isUp
    // Recorded even when the state is unchanged, so the newest probe to observe
    // this check is always what a later-arriving outcome is ordered against.
    this.lastState.set(name, { isUp: outcome.isUp, seq })
    if (!changed) {
      return
    }
    if (outcome.isUp) {
      if (previous === undefined) {
        return
      }
      this.describe(`Health check "${name}" recovered`, false)
      this.emit({ name, isUp: true })
      return
    }
    this.describe(`Health check "${name}" went down: ${describeCause(outcome.cause)}`, true)
    this.emit({ name, isUp: false, cause: outcome.cause })
  }

  /**
   * Write a transition to this package's own logger, unless a sink is bound —
   * the reasoning for standing down is on `IHealthTransitionSink`.
   *
   * Down is a warning, not an error: an unreachable dependency is what readiness
   * exists to route around, while `error` is what pages someone.
   *
   * @param message - The line to write.
   * @param isDown - Whether it describes a check going down, which sets the level.
   */
  private describe(message: string, isDown: boolean): void {
    if (this.transitionSink !== undefined) {
      return
    }
    if (isDown) {
      this.logger.warn(message)
      return
    }
    this.logger.log(message)
  }

  /**
   * Hand a transition to the consumer's sink, if one is bound. A failure is
   * contained: readiness answering `500` because its own logging broke would
   * take a healthy deployment out of rotation over an observability fault.
   *
   * Both ways a sink can fail are caught, for the same reason `runIndicator`
   * defends against an indicator that throws synchronously — a public seam
   * cannot assume the implementation behind it honors its own signature.
   * `record` is declared to return `void`, but TypeScript accepts any return
   * value in a void-returning position, so `async record()` compiles and is the
   * shape a consumer reaches for when the logger it delegates to is async. Its
   * rejection lands a microtask after the `try` block has exited, which is an
   * unhandled rejection rather than the contained failure documented on the
   * contract.
   *
   * Whatever comes back is assimilated with `Promise.resolve`, not tested with
   * `instanceof Promise`: `Promise` is a per-realm binding, so an `async` sink
   * defined in another realm returns a native promise that fails `instanceof`
   * here, and a userland promise library's result is not an instance either.
   * Assimilation is the language's own thenable test, and it is inert for the
   * `undefined` an ordinary synchronous sink returns.
   *
   * @param transition - The event to deliver.
   */
  private emit(transition: HealthTransition): void {
    if (this.transitionSink === undefined) {
      return
    }
    try {
      const returned: unknown = this.transitionSink.record(transition)
      // Guarded on the ordinary case: a sink declared `void` returns
      // `undefined`, and assimilating that would allocate two promises and queue
      // a reaction microtask to watch for a rejection that cannot arrive.
      // Anything else is assimilated, which covers a promise of any realm and a
      // thenable of any library without having to recognize either.
      //
      // The directive below covers both arms because Stryker's granularity is
      // one mutator per line. Only one of them is equivalent: replacing the
      // condition with `true` assimilates an `undefined` that resolves inertly.
      // Replacing it with `false` is a real regression, and the async, thenable
      // and cross-realm sink tests in `health.transition.spec.ts` fail on it —
      // so the tests, not the mutant, are what hold that direction.
      // Stryker disable next-line ConditionalExpression: equivalent in the `true` arm — assimilating an `undefined` resolves inertly, changing allocation and nothing observable; the `false` arm is a real regression held by the async, thenable and cross-realm sink tests rather than by this mutant.
      if (returned !== undefined) {
        Promise.resolve(returned).catch((error: unknown) => {
          this.reportSinkFailure(error)
        })
      }
    } catch (error: unknown) {
      this.reportSinkFailure(error)
    }
  }

  /**
   * Log a sink failure, without letting it reach the probe.
   *
   * @param error - Whatever the sink threw or rejected with.
   */
  private reportSinkFailure(error: unknown): void {
    this.logger.warn(`Health transition sink threw and was ignored: ${summarizeRejection(error)}`)
  }

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
    // Taken before the probes run, so an outcome is ordered by when its probe
    // started rather than by when it happened to finish.
    const seq = ++this.probeSequence
    const outcomes = await Promise.all(
      this.resolveIndicators().map((indicator) => runIndicator(indicator, timeoutMs, exposeErrors))
    )
    // After every indicator has settled, not as each one does, so the lines
    // follow the declared indicator order rather than which dependency answered
    // first — otherwise two readings of one outage order their logs differently.
    for (const outcome of outcomes) {
      this.reportTransition(outcome, seq)
    }
    const checks = outcomes.map((outcome) => outcome.entry)
    const status = checks.every((check) => check.status === 'up') ? 'ok' : 'error'
    return { status, checks }
  }
}
