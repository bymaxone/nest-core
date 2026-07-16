/**
 * @fileoverview The internal timing-to-metrics bridge. When timing and metrics
 * are both enabled, `BymaxCoreModule` binds this `ITimingSink` so each request
 * sample feeds two default HTTP metrics: `http_requests_total` (counter) and
 * `http_request_duration_seconds` (histogram). Both carry a deliberately
 * bounded label set, `method`, `route`, and `status_code` only, where `route`
 * is the sample's route template rather than the full URL with its query string.
 * Cardinality is bounded for matched routes; an unmatched request has no
 * template and falls back to its query-stripped path, so an endpoint exposed to
 * unmatched traffic can see `route` cardinality grow and should bound or drop
 * those series at the scraper. `prom-client` is never imported at the top level here: the loaded
 * module is passed in by the registry factory seam, keeping the optional-peer
 * boundary intact.
 * @layer Provider
 */
import type { Counter, Histogram } from 'prom-client'

import type { MetricsRegistry, PromClientModule } from './metrics.registry'
import type { ITimingSink, RequestTimingSample } from '../timing/timing.interfaces'

/** The bounded label set shared by both HTTP metrics. Cardinality is a contract. */
type HttpMetricLabel = 'method' | 'route' | 'status_code'

/** Metric name for the total count of completed HTTP requests. */
const REQUESTS_TOTAL = 'http_requests_total'

/** Metric name for the HTTP request duration histogram, in seconds. */
const REQUEST_DURATION_SECONDS = 'http_request_duration_seconds'

/** The exact, bounded label names applied to both HTTP metrics. */
const HTTP_METRIC_LABELS: readonly HttpMetricLabel[] = ['method', 'route', 'status_code']

/** Divisor converting a millisecond duration into the seconds a histogram expects. */
const MILLISECONDS_PER_SECOND = 1000

/**
 * Return the existing `http_requests_total` counter on the registry, or create
 * it. Reusing an already-registered metric keeps construction idempotent, so a
 * second bridge over the same registry never triggers a duplicate-registration
 * error from `prom-client`.
 *
 * @param promClient - The lazily loaded `prom-client` module.
 * @param registry - The registry the counter is registered against.
 * @returns The shared request counter.
 */
function getOrCreateCounter(
  promClient: PromClientModule,
  registry: MetricsRegistry
): Counter<HttpMetricLabel> {
  const existing = registry.getSingleMetric(REQUESTS_TOTAL)
  if (existing !== undefined) {
    if (!(existing instanceof promClient.Counter)) {
      throw new Error(
        `A metric named "${REQUESTS_TOTAL}" is already registered on the metrics registry with a ` +
          `different type; the HTTP metrics bridge requires it to be a Counter.`
      )
    }
    return existing as unknown as Counter<HttpMetricLabel>
  }
  return new promClient.Counter({
    name: REQUESTS_TOTAL,
    help: 'Total number of completed HTTP requests, labeled by method, route, and status_code.',
    labelNames: [...HTTP_METRIC_LABELS],
    registers: [registry]
  })
}

/**
 * Return the existing `http_request_duration_seconds` histogram on the
 * registry, or create it with `prom-client`'s default buckets. Reusing an
 * already-registered metric keeps construction idempotent.
 *
 * @param promClient - The lazily loaded `prom-client` module.
 * @param registry - The registry the histogram is registered against.
 * @returns The shared request-duration histogram.
 */
function getOrCreateHistogram(
  promClient: PromClientModule,
  registry: MetricsRegistry
): Histogram<HttpMetricLabel> {
  const existing = registry.getSingleMetric(REQUEST_DURATION_SECONDS)
  if (existing !== undefined) {
    if (!(existing instanceof promClient.Histogram)) {
      throw new Error(
        `A metric named "${REQUEST_DURATION_SECONDS}" is already registered on the metrics registry ` +
          `with a different type; the HTTP metrics bridge requires it to be a Histogram.`
      )
    }
    return existing as unknown as Histogram<HttpMetricLabel>
  }
  return new promClient.Histogram({
    name: REQUEST_DURATION_SECONDS,
    help: 'HTTP request duration in seconds, labeled by method, route, and status_code.',
    labelNames: [...HTTP_METRIC_LABELS],
    registers: [registry]
  })
}

/**
 * Bridge request-timing samples into the default HTTP metrics. Bound as the
 * effective `ITimingSink` only when timing and metrics are both enabled.
 */
export class TimingMetricsSink implements ITimingSink {
  /** The total request counter, shared with the injected registry. */
  private readonly counter: Counter<HttpMetricLabel>

  /** The request-duration histogram, shared with the injected registry. */
  private readonly histogram: Histogram<HttpMetricLabel>

  /**
   * @param registry - The dedicated metrics registry the samples feed.
   * @param promClient - The lazily loaded `prom-client` module supplying the
   *   `Counter` and `Histogram` constructors, passed in so this bridge never
   *   imports the optional peer at the top level.
   */
  constructor(registry: MetricsRegistry, promClient: PromClientModule) {
    this.counter = getOrCreateCounter(promClient, registry)
    this.histogram = getOrCreateHistogram(promClient, registry)
  }

  /**
   * Record one completed request: increment the counter once and observe the
   * duration in seconds, both under the bounded label set. Any failure is
   * swallowed so a metrics backend problem can never break the request being
   * observed.
   *
   * @param sample - The timing sample for a completed request.
   */
  record(sample: RequestTimingSample): void {
    const labels: Record<HttpMetricLabel, string> = {
      method: sample.method,
      route: sample.route,
      status_code: String(sample.statusCode)
    }
    try {
      this.counter.inc(labels)
      this.histogram.observe(labels, sample.durationMs / MILLISECONDS_PER_SECOND)
    } catch {
      // Defense in depth: a sink must never throw outward. The timing
      // interceptor already guards its sink call, but a metrics-backend failure
      // here is swallowed so it can never affect the request it observes.
    }
  }
}
