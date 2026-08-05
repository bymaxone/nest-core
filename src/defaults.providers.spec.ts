/**
 * Unit tests for the no-op fallback classes and the module-owned default
 * provider.
 *
 * Layer: unit.
 * Goal: prove the no-op correlation provider and timing sink behave as
 * documented, and that `buildDefaultProviders` binds exactly the timing
 * clock. The pluggable extension-point tokens (`BYMAX_CORRELATION_PROVIDER`,
 * `BYMAX_TIMING_SINK`, `BYMAX_HEALTH_INDICATORS`) are deliberately NOT bound
 * here; their `@Optional()` fallback behavior and their real override paths
 * are covered where each token is consumed
 * (`envelope/exception.filter.spec.ts`, `timing/timing.interceptor.spec.ts`,
 * `health/health.service.spec.ts`) and proven end to end through a booted
 * application (`envelope/exception.filter.integration.spec.ts`,
 * `timing/timing.registration.spec.ts`, `health/health.contract.spec.ts`).
 * Mocks: none.
 */
import { normalizeCoreOptions } from './core.options'
import type { ResolvedCoreOptions } from './core.options'
import { BYMAX_CORE_OPTIONS, BYMAX_TRACE_CONTEXT } from './core.tokens'
import type { ITraceContextProvider } from './telemetry/trace-context'
import { BYMAX_TIMING_CLOCK, DEFAULT_MONOTONIC_CLOCK } from './timing/timing.clock'
import type { ITimingSink, RequestTimingSample } from './timing/timing.interfaces'
import {
  buildDefaultProviders,
  buildTraceContextProvider,
  NoopCorrelationIdProvider,
  NoopTimingSink
} from './defaults.providers'

const SAMPLE: RequestTimingSample = {
  method: 'GET',
  route: '/x',
  statusCode: 200,
  durationMs: 1,
  slow: false
}

describe('no-op fallback classes', () => {
  /**
   * Correlation fallback resolves nothing.
   *
   * The fallback must return `undefined` so the envelope omits the
   * correlation id until a real provider is bound.
   */
  it('returns undefined from the no-op correlation provider', () => {
    expect(new NoopCorrelationIdProvider().getCorrelationId()).toBeUndefined()
  })

  /**
   * Timing fallback discards silently.
   *
   * The fallback sink must accept a sample without throwing so timing never
   * breaks a request when no sink is configured or bound.
   */
  it('discards a sample without throwing in the no-op timing sink', () => {
    expect(() => new NoopTimingSink().record(SAMPLE)).not.toThrow()
  })

  /** Type check: both fallbacks satisfy their contracts. */
  it('satisfies the ITimingSink contract with the no-op sink', () => {
    const sink: ITimingSink = new NoopTimingSink()
    expect(sink.record).toBeInstanceOf(Function)
  })
})

describe('buildDefaultProviders', () => {
  /**
   * Only the timing clock is bound unconditionally.
   *
   * The correlation provider, timing sink, and health indicators are consumer
   * override points and must never be bound here (see the file's own
   * documentation for why a competing local binding would defeat a consumer's
   * override); the timing clock is an internal seam, not an override point, so
   * it is the sole default this function contributes.
   */
  it('binds exactly the timing-clock default', () => {
    const providers = buildDefaultProviders()

    expect(providers).toEqual([{ provide: BYMAX_TIMING_CLOCK, useValue: DEFAULT_MONOTONIC_CLOCK }])
  })
})

describe('buildTraceContextProvider', () => {
  /**
   * The provider is bound under the documented token, as a factory.
   *
   * A factory rather than a value because resolving the reader may have to load
   * the optional peer, which has to happen while the module resolves — not while
   * a request is being served.
   */
  it('binds an async factory under BYMAX_TRACE_CONTEXT', () => {
    expect(buildTraceContextProvider()).toEqual({
      provide: BYMAX_TRACE_CONTEXT,
      useFactory: expect.any(Function),
      inject: [BYMAX_CORE_OPTIONS]
    })
  })

  /**
   * The factory gates on the resolved options.
   *
   * On the asynchronous path this provider is registered whatever the options
   * say, so the factory's own gate is the only thing keeping a disabled
   * application from reaching the optional peer.
   */
  it('resolves a provider reporting no trace while telemetry is off', async () => {
    const factory = (
      buildTraceContextProvider() as {
        useFactory: (options: ResolvedCoreOptions) => Promise<ITraceContextProvider>
      }
    ).useFactory

    const resolved = await factory(normalizeCoreOptions())

    expect(resolved.getTraceContext()).toBeUndefined()
  })
})
