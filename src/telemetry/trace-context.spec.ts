/**
 * Unit tests for trace-context resolution.
 *
 * Layer: unit.
 * Goal: prove the reader resolves the active span's identifiers, treats "no span"
 * and "invalid span" alike as an absent context rather than a string of zeros,
 * that the no-op resolves nothing, and that enabling the feature without the
 * optional peer fails fast with a message naming the package.
 * Mocks: the OpenTelemetry API surface is expressed as plain objects against the
 * structural contract; `jest.doMock('@opentelemetry/api')` throwing simulates an
 * absent peer.
 */
import { normalizeCoreOptions } from '../core.options'
import {
  loadOtelApi,
  NoopTraceContextProvider,
  OtelTraceContextProvider,
  resolveTraceContextProvider
} from './trace-context'
import type { OtelApiSurface } from './trace-context'

/** The all-zero context the API returns when nothing is recording. */
const INVALID_CONTEXT = { traceId: '0'.repeat(32), spanId: '0'.repeat(16), traceFlags: 0 }

/** A recording span's context. */
const VALID_CONTEXT = { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), traceFlags: 1 }

/** Build an API surface whose active span reports the given context. */
function apiWithSpan(spanContext: typeof VALID_CONTEXT | undefined): OtelApiSurface {
  return {
    trace: {
      getActiveSpan: () =>
        spanContext === undefined ? undefined : { spanContext: () => spanContext }
    },
    isSpanContextValid: (context) => context.traceId !== INVALID_CONTEXT.traceId
  }
}

describe('OtelTraceContextProvider', () => {
  /**
   * The happy path: a recording span's identifiers.
   *
   * These are the values that let a log line, an error response and a timing
   * sample be recognized as one request.
   */
  it('resolves the active span identifiers', () => {
    const provider = new OtelTraceContextProvider(apiWithSpan(VALID_CONTEXT))

    expect(provider.getTraceContext()).toEqual({
      traceId: VALID_CONTEXT.traceId,
      spanId: VALID_CONTEXT.spanId
    })
  })

  /**
   * No active span resolves nothing. Edge case: untraced request.
   *
   * A request outside any trace — a health probe, a request that arrived before
   * instrumentation started — must produce an absent context, so every consumer
   * simply omits the fields.
   */
  it('resolves nothing when no span is active', () => {
    const provider = new OtelTraceContextProvider(apiWithSpan(undefined))

    expect(provider.getTraceContext()).toBeUndefined()
  })

  /**
   * An invalid span context resolves nothing. Edge case: all-zero context.
   *
   * The API answers with an all-zero context when nothing is recording. Passing
   * that through would publish `traceId: "000…0"` into responses and samples,
   * leaving every consumer to recognize a sentinel value.
   */
  it('resolves nothing for an invalid span context', () => {
    const provider = new OtelTraceContextProvider(apiWithSpan(INVALID_CONTEXT))

    expect(provider.getTraceContext()).toBeUndefined()
  })
})

describe('NoopTraceContextProvider', () => {
  /**
   * The disabled provider reports nothing.
   *
   * It is what every consumer falls back to, so "telemetry off" has to look
   * exactly like "nothing is traced".
   */
  it('resolves no trace context', () => {
    expect(new NoopTraceContextProvider().getTraceContext()).toBeUndefined()
  })
})

describe('resolveTraceContextProvider', () => {
  /**
   * Disabled telemetry never reaches the peer.
   *
   * The factory is bound on every registration path, so its gate is the only
   * thing keeping a disabled application from loading the optional peer.
   */
  it('resolves the no-op provider while telemetry is disabled', async () => {
    const provider = await resolveTraceContextProvider(normalizeCoreOptions())

    expect(provider).toBeInstanceOf(NoopTraceContextProvider)
  })

  /**
   * Enabled telemetry resolves the real reader.
   *
   * With the peer installed the factory must produce the provider that reads the
   * live API, not another no-op.
   */
  it('resolves the OpenTelemetry reader when telemetry is enabled', async () => {
    const provider = await resolveTraceContextProvider(
      normalizeCoreOptions({ telemetry: { enabled: true } })
    )

    expect(provider).toBeInstanceOf(OtelTraceContextProvider)
  })
})

describe('loadOtelApi, present optional peer', () => {
  /**
   * Resolve the real module when installed.
   *
   * The structural surface must match the real module rather than only compiling
   * against it, so both entry points are read off the loaded value.
   */
  it('resolves the module exposing trace and isSpanContextValid', async () => {
    const api = await loadOtelApi()

    expect(typeof api.trace.getActiveSpan).toBe('function')
    expect(typeof api.isSpanContextValid).toBe('function')
  })
})

describe('loadOtelApi, absent optional peer', () => {
  afterEach(() => {
    jest.dontMock('@opentelemetry/api')
    jest.resetModules()
  })

  /**
   * Fail fast, descriptively, at load time.
   *
   * The whole message is asserted: it must name the option that turned the
   * feature on as well as the package, or an operator running several optional
   * features cannot tell which switch produced the failure.
   */
  it('rejects with a descriptive error naming the package and install command', async () => {
    jest.resetModules()
    jest.doMock('@opentelemetry/api', () => {
      const error: NodeJS.ErrnoException = new Error('Cannot find module @opentelemetry/api')
      error.code = 'MODULE_NOT_FOUND'
      throw error
    })
    const { loadOtelApi: load } = require('./trace-context') as typeof import('./trace-context')

    await expect(load()).rejects.toThrow(
      'telemetry.enabled is true but the optional peer @opentelemetry/api is not installed. ' +
        'Run: pnpm add @opentelemetry/api'
    )
  })

  /**
   * Preserve the underlying resolution failure.
   *
   * The descriptive boot error must chain the original module-not-found error as
   * its `cause`, so operators can still see the root resolution failure.
   */
  it('chains the original failure as the error cause', async () => {
    jest.resetModules()
    jest.doMock('@opentelemetry/api', () => {
      const error: NodeJS.ErrnoException = new Error('Cannot find module @opentelemetry/api')
      error.code = 'ERR_MODULE_NOT_FOUND'
      throw error
    })
    const { loadOtelApi: load } = require('./trace-context') as typeof import('./trace-context')

    await expect(load()).rejects.toMatchObject({
      cause: expect.objectContaining({ message: 'Cannot find module @opentelemetry/api' })
    })
  })

  /**
   * Non-resolution failures are not masked.
   *
   * A failure that is not a module-not-found error must propagate unchanged, so
   * it is not misreported as the peer being uninstalled.
   */
  it('rethrows a non-module-not-found failure unchanged', async () => {
    jest.resetModules()
    jest.doMock('@opentelemetry/api', () => {
      throw new Error('boom: internal telemetry failure')
    })
    const { loadOtelApi: load } = require('./trace-context') as typeof import('./trace-context')

    await expect(load()).rejects.toThrow(/boom: internal telemetry failure/)
    await expect(load()).rejects.not.toThrow(/is not installed/)
  })
})
