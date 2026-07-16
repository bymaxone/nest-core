/**
 * Unit tests for the no-op default bindings and consumer overrides.
 *
 * Layer: unit.
 * Goal: prove every pluggable token resolves its no-op default in a bare module
 * and that a consumer provider for the same token (useValue, useExisting, or a
 * value array) replaces the default as the resolved instance.
 * Mocks: none; a compiled testing module resolves the tokens.
 */
import { Global, Injectable, Module } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import type { ICorrelationIdProvider } from './envelope/correlation.interfaces'
import type { ITimingSink, RequestTimingSample } from './timing/timing.interfaces'
import { BymaxCoreModule } from './core.module'
import {
  BYMAX_CORRELATION_PROVIDER,
  BYMAX_HEALTH_INDICATORS,
  BYMAX_TIMING_SINK
} from './core.tokens'
import { NoopCorrelationIdProvider, NoopTimingSink } from './defaults.providers'

const SAMPLE: RequestTimingSample = {
  method: 'GET',
  route: '/x',
  statusCode: 200,
  durationMs: 1,
  slow: false
}

describe('no-op default classes', () => {
  /**
   * Correlation default resolves nothing.
   *
   * The default provider must return `undefined` so the envelope omits the
   * correlation id until a real provider is supplied.
   */
  it('returns undefined from the no-op correlation provider', () => {
    expect(new NoopCorrelationIdProvider().getCorrelationId()).toBeUndefined()
  })

  /**
   * Timing default discards silently.
   *
   * The default sink must accept a sample without throwing so timing never
   * breaks a request when no sink is configured.
   */
  it('discards a sample without throwing in the no-op timing sink', () => {
    expect(() => new NoopTimingSink().record(SAMPLE)).not.toThrow()
  })
})

describe('default bindings resolve in a bare module', () => {
  /**
   * Every pluggable token resolves its documented default.
   *
   * A consumer that configures nothing must still be able to inject each token;
   * the module binds a no-op for each so injection never fails.
   */
  it('binds the no-op correlation provider, no-op sink, and empty indicators', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [BymaxCoreModule.forRoot()]
    }).compile()

    expect(moduleRef.get(BYMAX_CORRELATION_PROVIDER)).toBeInstanceOf(NoopCorrelationIdProvider)
    expect(moduleRef.get(BYMAX_TIMING_SINK)).toBeInstanceOf(NoopTimingSink)
    expect(moduleRef.get(BYMAX_HEALTH_INDICATORS)).toEqual([])
    // The shared default must be frozen so a consumer cannot mutate it in place.
    expect(Object.isFrozen(moduleRef.get(BYMAX_HEALTH_INDICATORS))).toBe(true)
  })
})

describe('consumer overrides replace the defaults', () => {
  /**
   * useValue override for the timing sink.
   *
   * Replacing the module's sink binding must make the module resolve the
   * consumer instance, not the no-op default.
   */
  it('resolves a useValue timing-sink override', async () => {
    const customSink: ITimingSink = { record: (): void => undefined }
    const moduleRef = await Test.createTestingModule({
      imports: [BymaxCoreModule.forRoot()]
    })
      .overrideProvider(BYMAX_TIMING_SINK)
      .useValue(customSink)
      .compile()

    expect(moduleRef.get(BYMAX_TIMING_SINK)).toBe(customSink)
  })

  /**
   * useExisting override for the correlation provider.
   *
   * The spec's canonical pattern (section 4.3) aliases an existing service onto
   * the token from a consumer module; the module must then resolve that service
   * instance rather than the no-op default.
   */
  it('resolves a useExisting correlation-provider override from a consumer module', async () => {
    @Injectable()
    class FixedCorrelationProvider implements ICorrelationIdProvider {
      getCorrelationId(): string | undefined {
        return 'fixed'
      }
    }

    @Global()
    @Module({
      providers: [
        FixedCorrelationProvider,
        { provide: BYMAX_CORRELATION_PROVIDER, useExisting: FixedCorrelationProvider }
      ],
      exports: [BYMAX_CORRELATION_PROVIDER]
    })
    class ObservabilityModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [BymaxCoreModule.forRoot(), ObservabilityModule]
    }).compile()

    const resolved = moduleRef.get<ICorrelationIdProvider>(BYMAX_CORRELATION_PROVIDER, {
      strict: false
    })
    expect(resolved).toBe(moduleRef.get(FixedCorrelationProvider, { strict: false }))
    expect(resolved.getCorrelationId()).toBe('fixed')
  })

  /**
   * Value-array override for the health indicators.
   *
   * A consumer supplies the concrete indicator list; the module must resolve the
   * provided array rather than the empty default.
   */
  it('resolves a value-array health-indicators override', async () => {
    const indicators = [{ name: 'db' }, { name: 'cache' }]
    const moduleRef = await Test.createTestingModule({
      imports: [BymaxCoreModule.forRoot()]
    })
      .overrideProvider(BYMAX_HEALTH_INDICATORS)
      .useValue(indicators)
      .compile()

    expect(moduleRef.get(BYMAX_HEALTH_INDICATORS)).toBe(indicators)
  })
})
