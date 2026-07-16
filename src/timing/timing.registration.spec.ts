/**
 * Unit and integration tests for timing-feature registration on both
 * `BymaxCoreModule` paths.
 *
 * Layer: unit / integration.
 * Goal: prove the sync path omits the `APP_INTERCEPTOR` provider when timing
 * is disabled and binds it to the real `TimingInterceptor` when enabled (both
 * at the provider-definition level and end to end through a live request);
 * prove the always-on async slot's factory selects the transparent
 * pass-through when timing is disabled and the real `TimingInterceptor` when
 * enabled.
 * Mocks: a spy `ITimingSink` overriding the default binding; a minimal probe
 * controller and a real Express Nest app for the end-to-end assertions.
 */
import { Controller, Get } from '@nestjs/common'
import type { DynamicModule, INestApplication, Provider } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { normalizeCoreOptions } from '../core.options'
import { BymaxCoreModule } from '../core.module'
import { BYMAX_TIMING_SINK } from '../core.tokens'
import { PassThroughInterceptor, selectAsyncTimingInterceptor } from '../passthrough.providers'
import { DEFAULT_MONOTONIC_CLOCK } from './timing.clock'
import { TimingInterceptor } from './timing.interceptor'
import type { ITimingSink, RequestTimingSample } from './timing.interfaces'

/** Extract the injection token of a provider regardless of its shape. */
function tokenOf(provider: Provider): unknown {
  return typeof provider === 'object' && 'provide' in provider ? provider.provide : provider
}

/** Find the provider entry bound to the given token, if any. */
function providerFor(providers: Provider[], token: unknown): Provider | undefined {
  return providers.find((provider) => tokenOf(provider) === token)
}

/** A sink spy recording every sample it receives. */
function recordingSink(): ITimingSink & { samples: RequestTimingSample[] } {
  const samples: RequestTimingSample[] = []
  return {
    samples,
    record: (sample: RequestTimingSample): void => {
      samples.push(sample)
    }
  }
}

/** Minimal controller whose route proves whether a sample was recorded. */
@Controller('probe')
class ProbeController {
  @Get('ok')
  ok(): { ok: boolean } {
    return { ok: true }
  }
}

describe('BymaxCoreModule.forRoot, timing registration', () => {
  /**
   * Disabled timing registers nothing.
   *
   * The sync path knows options at definition time, so a disabled timing
   * feature must not contribute an `APP_INTERCEPTOR` provider at all.
   */
  it('registers no APP_INTERCEPTOR provider when timing is disabled', () => {
    const def: DynamicModule = BymaxCoreModule.forRoot({ timing: { enabled: false } })
    const tokens = (def.providers ?? []).map(tokenOf)

    expect(tokens).not.toContain(APP_INTERCEPTOR)
  })

  /**
   * Enabled timing registers the real interceptor class.
   *
   * The sync path must append the `APP_INTERCEPTOR` provider bound to
   * `TimingInterceptor` via `useClass` exactly when timing is enabled.
   */
  it('binds APP_INTERCEPTOR to TimingInterceptor when timing is enabled', () => {
    const def: DynamicModule = BymaxCoreModule.forRoot({ timing: { enabled: true } })
    const provider = providerFor(def.providers ?? [], APP_INTERCEPTOR)

    expect(provider).toMatchObject({ useClass: TimingInterceptor })
  })

  describe('end to end', () => {
    let app: INestApplication | undefined

    afterEach(async () => {
      await app?.close()
      app = undefined
    })

    /**
     * Enabled timing delivers a sample for a real request.
     *
     * Booting a full app proves the sync-path DI wiring resolves (options,
     * sink, and clock all inject cleanly) and that the bound interceptor is
     * genuinely active, not merely present in the provider list.
     */
    it('delivers exactly one sample to the sink for a real request', async () => {
      const sink = recordingSink()
      const moduleRef = await Test.createTestingModule({
        imports: [BymaxCoreModule.forRoot({ timing: { enabled: true } })],
        controllers: [ProbeController]
      })
        .overrideProvider(BYMAX_TIMING_SINK)
        .useValue(sink)
        .compile()
      app = moduleRef.createNestApplication()
      await app.init()

      await request(app.getHttpServer()).get('/probe/ok').expect(200, { ok: true })

      expect(sink.samples).toHaveLength(1)
      expect(sink.samples[0]).toMatchObject({ method: 'GET', statusCode: 200 })
    })

    /**
     * Disabled timing never touches the sink.
     *
     * With the feature disabled, the sync path registers no interceptor at
     * all, so a real request must leave the sink untouched.
     */
    it('never calls the sink for a real request when timing is disabled', async () => {
      const sink = recordingSink()
      const moduleRef = await Test.createTestingModule({
        imports: [BymaxCoreModule.forRoot({ timing: { enabled: false } })],
        controllers: [ProbeController]
      })
        .overrideProvider(BYMAX_TIMING_SINK)
        .useValue(sink)
        .compile()
      app = moduleRef.createNestApplication()
      await app.init()

      await request(app.getHttpServer()).get('/probe/ok').expect(200, { ok: true })

      expect(sink.samples).toHaveLength(0)
    })
  })
})

describe('selectAsyncTimingInterceptor, the async slot factory', () => {
  /**
   * Disabled timing resolves the transparent pass-through.
   *
   * The always-on async slot's factory must produce the
   * {@link PassThroughInterceptor} product when the resolved options disable
   * the timing feature.
   */
  it('resolves the pass-through interceptor when timing is disabled', () => {
    const options = normalizeCoreOptions({ timing: { enabled: false } })
    const sink = recordingSink()

    const product = selectAsyncTimingInterceptor(options, sink, DEFAULT_MONOTONIC_CLOCK)

    expect(product).toBeInstanceOf(PassThroughInterceptor)
  })

  /**
   * Enabled timing resolves the real interceptor.
   *
   * The factory must produce a `TimingInterceptor` wired to the injected sink
   * and clock when the resolved options enable the timing feature.
   */
  it('resolves TimingInterceptor when timing is enabled', () => {
    const options = normalizeCoreOptions({ timing: { enabled: true } })
    const sink = recordingSink()

    const product = selectAsyncTimingInterceptor(options, sink, DEFAULT_MONOTONIC_CLOCK)

    expect(product).toBeInstanceOf(TimingInterceptor)
  })
})
