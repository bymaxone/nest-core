/**
 * @fileoverview The readiness transition contract: a sink that receives one
 * event each time a check changes state, and the cause that says why.
 *
 * This exists because a readiness failure can otherwise leave no record an
 * operator will ever read. There are three ways for a check to be down, and the
 * aggregator is the only place that can tell them apart: the indicator rejected,
 * the indicator reported `down` on purpose, or the aggregator gave up waiting.
 * The third is knowledge that exists nowhere else — an indicator the aggregator
 * abandoned is never told, so it cannot report anything — and it is the shape a
 * hung dependency takes. A database under load, a network partition and a paused
 * container all hang; a refusal comes back immediately.
 *
 * Two decisions elsewhere combine to make that silence total in a typical
 * deployment, and each is right on its own. Probe paths are excluded from the
 * HTTP log surface, because probes are the highest-volume request a backend
 * serves. And a well-written indicator returns `{ status: 'down' }` rather than
 * throwing, because readiness is usually unauthenticated and a driver's error
 * carries hosts, ports and sometimes credentials — which is exactly the row this
 * package's own contract steers implementations toward.
 *
 * **Transitions, not outcomes.** The sink is called once per *change* of state
 * per check name, never once per probe. That rule lives in the aggregator rather
 * than in the sink deliberately: a readiness check runs every few seconds, so a
 * line per failure turns one outage into thousands of identical records that
 * bury the one carrying the cause. Leaving the de-duplication to each consumer
 * would mean every backend re-deriving the same rule, and re-deriving it subtly
 * differently. A sink that never sees raw outcomes cannot get it wrong.
 * @layer Contract
 */

/**
 * Why a check is down, as only the aggregator can distinguish it.
 *
 * A discriminated union rather than a string, so a consumer switches
 * exhaustively and the compiler reports the arm it has not handled when a future
 * version adds one. "The dependency answered that it is down" and "the
 * dependency accepted the work and never answered" are different outages calling
 * for different responses, and the readiness body cannot tell them apart because
 * it carries only `up` or `down`.
 */
export type HealthTransitionCause =
  | {
      /** The indicator rejected, or threw synchronously. */
      readonly kind: 'rejected'
      /**
       * The rejection's top-level message, truncated to 300 characters. Never
       * the raw error, its stack, or any nested cause.
       *
       * This reaches the sink whether or not `health.exposeIndicatorErrors` is
       * set: that option governs what is written into the HTTP response, which
       * is typically unauthenticated, while a sink is application-side code at
       * the same trust level as the logger. An indicator usually does not author
       * this text — it lets a driver's error propagate — so treat it as
       * potentially carrying hosts and ports, and send it where access is
       * already controlled.
       */
      readonly message: string
    }
  | {
      /** The indicator answered, and reported its dependency unhealthy. */
      readonly kind: 'reported-down'
    }
  | {
      /** The aggregator gave up waiting for the indicator. */
      readonly kind: 'timed-out'
      /** The bound that elapsed, from `health.indicatorTimeoutMs`. */
      readonly timeoutMs: number
    }

/**
 * One change of state for one check.
 *
 * A discriminated union on `isUp` rather than an object with an optional cause,
 * so the compiler guarantees that a transition to `down` carries one and that a
 * transition to `up` does not — a recovery has no cause to describe.
 */
export type HealthTransition =
  | {
      /** The check's name, as {@link IHealthIndicator.name} declares it. */
      readonly name: string
      /** The dependency is reachable again. */
      readonly isUp: true
    }
  | {
      /** The check's name, as {@link IHealthIndicator.name} declares it. */
      readonly name: string
      /** The dependency is not reachable. */
      readonly isUp: false
      /** Why, as far as the aggregator can tell. */
      readonly cause: HealthTransitionCause
    }

/**
 * Receives one event per change of readiness state, per check.
 *
 * Bind an implementation under `BYMAX_HEALTH_TRANSITION_SINK` from a module of
 * your own marked `@Global()`. Nothing is bound by default, and with no sink the
 * aggregator writes its own transition lines to Nest's logger, so a readiness
 * failure is never silent.
 *
 * Binding a sink stands that line down. Both destinations are usually the same
 * logger in a consuming application, so keeping it would put two records of one
 * transition side by side — the noise this feature exists to remove. The sink is
 * handed the cause as structured data, strictly more than the line renders, so
 * what reaches the log after that is the consumer's decision.
 *
 * Called synchronously from the readiness path, so an implementation must be
 * cheap and must not block: hand the event to a logger and return. A throw is
 * caught and reported by the aggregator rather than failing the probe — a
 * readiness endpoint that answers `500` because its *logging* broke would take a
 * healthy deployment out of rotation — but do not rely on that as flow control.
 *
 * Takes a single object, matching `ITimingSink.record`, so a later field is an
 * additive change rather than a new positional parameter.
 */
export interface IHealthTransitionSink {
  /**
   * Record one change of readiness state.
   *
   * @param transition - The check that changed, its new state, and the cause
   *   when it went down.
   */
  record(transition: HealthTransition): void
}
