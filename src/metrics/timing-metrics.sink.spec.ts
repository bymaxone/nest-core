/**
 * Unit tests for the timing-to-metrics bridge.
 *
 * Layer: unit.
 * Goal: prove each sample produces exactly one counter increment and one
 * histogram observation of `durationMs / 1000` under the bounded
 * `method` / `route` / `status_code` labels, with `status_code` stringified;
 * that a throwing metric never propagates out of the sink; and that a second
 * bridge over the same registry reuses the metrics instead of failing on a
 * duplicate registration.
 * Mocks: a real `prom-client` registry loaded lazily for the behavioral tests;
 * a hand-built failing `prom-client` module for the swallow-on-failure test.
 */
import type { ITimingSink, RequestTimingSample } from '../timing/timing.interfaces'
import type { MetricsRegistry, PromClientModule } from './metrics.registry'
import { TimingMetricsSink } from './timing-metrics.sink'

/** Build a completed-request sample with sensible defaults and the given overrides. */
function sample(overrides: Partial<RequestTimingSample> = {}): RequestTimingSample {
  return {
    method: 'GET',
    route: '/users/:id',
    statusCode: 200,
    durationMs: 250,
    slow: false,
    ...overrides
  }
}

describe('TimingMetricsSink', () => {
  /**
   * One increment and one observation per sample, bounded labels.
   *
   * A single sample must yield `http_requests_total 1` and a duration
   * observation of `durationMs / 1000` seconds, both carrying exactly the
   * bounded label set with a stringified status code.
   */
  it('feeds both HTTP metrics with bounded labels and the duration in seconds', async () => {
    const promClient = await import('prom-client')
    const registry = new promClient.Registry()
    const sink = new TimingMetricsSink(registry, promClient)

    sink.record(sample({ durationMs: 250, statusCode: 200 }))
    const text = await registry.metrics()

    expect(text).toContain(
      'http_requests_total{method="GET",route="/users/:id",status_code="200"} 1'
    )
    expect(text).toContain(
      'http_request_duration_seconds_sum{method="GET",route="/users/:id",status_code="200"} 0.25'
    )
    expect(text).toContain(
      'http_request_duration_seconds_count{method="GET",route="/users/:id",status_code="200"} 1'
    )
  })

  /**
   * Counts accumulate across samples on the same series.
   *
   * Two samples sharing the same labels must accumulate to a count of 2,
   * confirming the counter is incremented once per recorded sample.
   */
  it('increments the counter once per recorded sample', async () => {
    const promClient = await import('prom-client')
    const registry = new promClient.Registry()
    const sink = new TimingMetricsSink(registry, promClient)

    sink.record(sample())
    sink.record(sample())
    const text = await registry.metrics()

    expect(text).toContain(
      'http_requests_total{method="GET",route="/users/:id",status_code="200"} 2'
    )
  })

  /**
   * Idempotent construction over a shared registry.
   *
   * A second bridge built against a registry that already holds the metrics
   * must reuse them rather than throw `prom-client`'s duplicate-registration
   * error, so both bridges write to the same series.
   */
  it('reuses existing metrics when a second bridge is built over the same registry', async () => {
    const promClient = await import('prom-client')
    const registry = new promClient.Registry()
    const first = new TimingMetricsSink(registry, promClient)

    const second = new TimingMetricsSink(registry, promClient)
    first.record(sample())
    second.record(sample())
    const text = await registry.metrics()

    expect(text).toContain(
      'http_requests_total{method="GET",route="/users/:id",status_code="200"} 2'
    )
  })

  /**
   * Name collision on the counter is rejected.
   *
   * The metrics registry is exported for custom metrics; if a consumer already
   * registered a non-counter under the reserved counter name, the bridge must
   * fail fast with a descriptive error instead of a later runtime type failure.
   */
  it('throws when a non-counter metric already holds the counter name', async () => {
    const promClient = await import('prom-client')
    const registry = new promClient.Registry()
    new promClient.Histogram({
      name: 'http_requests_total',
      help: 'conflicting',
      registers: [registry]
    })

    expect(() => new TimingMetricsSink(registry, promClient)).toThrow(
      /"http_requests_total" is already registered.*different type.*Counter/i
    )
  })

  /**
   * Name collision on the histogram is rejected.
   *
   * A consumer metric registered under the reserved histogram name with the
   * wrong type must be rejected at construction with a descriptive error.
   */
  it('throws when a non-histogram metric already holds the histogram name', async () => {
    const promClient = await import('prom-client')
    const registry = new promClient.Registry()
    new promClient.Counter({
      name: 'http_request_duration_seconds',
      help: 'conflicting',
      registers: [registry]
    })

    expect(() => new TimingMetricsSink(registry, promClient)).toThrow(
      /"http_request_duration_seconds" is already registered.*different type.*Histogram/i
    )
  })

  /**
   * Never throws outward.
   *
   * When the underlying metric throws, the sink must swallow the failure so a
   * metrics-backend problem can never break the request being observed.
   */
  it('swallows a failure from the underlying metric', () => {
    const throwing = {
      inc: (): void => {
        throw new Error('metrics backend down')
      },
      observe: (): void => undefined
    }
    const failingPromClient = {
      Counter: class {
        inc = throwing.inc
      },
      Histogram: class {
        observe = throwing.observe
      }
    } as unknown as PromClientModule
    const registry = { getSingleMetric: (): undefined => undefined } as unknown as MetricsRegistry
    const sink: ITimingSink = new TimingMetricsSink(registry, failingPromClient)

    expect(() => sink.record(sample())).not.toThrow()
  })
})
