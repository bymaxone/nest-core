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
import { Inject, Injectable } from '@nestjs/common'

import type { ResolvedCoreOptions } from '../core.options'
import { BYMAX_CORE_OPTIONS, BYMAX_HEALTH_INDICATORS } from '../core.tokens'
import type { HealthCheckEntry, HealthResponse, IHealthIndicator } from './health.interfaces'

/** Diagnostic rejection messages are truncated to this length before being surfaced. */
const MAX_ERROR_MESSAGE_LENGTH = 300

/**
 * Summarize a rejection reason into a safe, bounded-length message. Never
 * surfaces the raw error object, its stack, or any nested cause: only the
 * top-level message, so an indicator's failure cannot leak more than it
 * already chose to put in `Error#message`.
 *
 * @param reason - The rejection reason thrown by an indicator's `check()`.
 * @returns A truncated message string.
 */
function summarizeRejection(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason)
  return message.length > MAX_ERROR_MESSAGE_LENGTH
    ? `${message.slice(0, MAX_ERROR_MESSAGE_LENGTH)}...`
    : message
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
  timeoutMs: number
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
    .then((result) => ({ name: indicator.name, ...result }))
    .catch((reason: unknown): HealthCheckEntry => ({
      name: indicator.name,
      status: 'down',
      details: { error: summarizeRejection(reason) }
    }))
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
export class HealthService {
  /**
   * @param indicators - Every registered indicator; empty by default.
   * @param options - Resolved core options; supplies `indicatorTimeoutMs`.
   */
  constructor(
    @Inject(BYMAX_HEALTH_INDICATORS) private readonly indicators: IHealthIndicator[],
    @Inject(BYMAX_CORE_OPTIONS) private readonly options: ResolvedCoreOptions
  ) {}

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
   * Readiness check: run every registered indicator concurrently and
   * aggregate the results. `status` is `'ok'` only when every indicator
   * reports `up`; an empty indicator list is vacuously `'ok'`.
   *
   * @returns The aggregated health response.
   */
  async checkReadiness(): Promise<HealthResponse> {
    const timeoutMs = this.options.health.indicatorTimeoutMs
    const checks = await Promise.all(
      this.indicators.map((indicator) => runIndicator(indicator, timeoutMs))
    )
    const status = checks.every((check) => check.status === 'up') ? 'ok' : 'error'
    return { status, checks }
  }
}
