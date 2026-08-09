/**
 * Unit tests for the `createMetricsController` factory.
 *
 * Layer: unit.
 * Goal: prove the controller scrapes the injected registry and replies with the
 * registry's text and content type, mutating nothing; behaves identically at a
 * custom route; and fails fast through the async consistency guard when the
 * resolved options disagree with how the controller instance was registered.
 * Mocks: a hand-built registry stub and a hand-built `HttpAdapterHost` capturing
 * the header and reply (family convention, no supertest at this layer).
 */
import { UnauthorizedException } from '@nestjs/common'
import type { HttpAdapterHost } from '@nestjs/core'

import { normalizeCoreOptions } from '../core.options'
import type { ResolvedCoreOptions } from '../core.options'
import { createMetricsController } from './metrics.controller'
import type { MetricsRegistry } from './metrics.registry'

/** The subset of controller methods the tests invoke directly. */
interface MetricsControllerInstance {
  scrape(response: unknown, request?: { headers?: Record<string, unknown> }): Promise<void>
}

/** Resolved options enabling metrics at `metrics` with a required scrape bearer. */
function tokenOptions(authToken: string): ResolvedCoreOptions {
  return normalizeCoreOptions({ metrics: { enabled: true, path: 'metrics', authToken } })
}

/** Build a stub registry returning a fixed exposition text and content type. */
function stubRegistry(text: string, contentType: string): MetricsRegistry {
  return {
    metrics: jest.fn((): Promise<string> => Promise.resolve(text)),
    contentType
  } as unknown as MetricsRegistry
}

/** Captured arguments of the adapter's `setHeader` and `reply` calls. */
interface Captured {
  header: { name: string; value: string } | undefined
  body: string | undefined
  status: number | undefined
}

/** Build a stub `HttpAdapterHost` capturing the header set and the replied body. */
function stubAdapterHost(): { adapterHost: HttpAdapterHost; captured: Captured } {
  const captured: Captured = { header: undefined, body: undefined, status: undefined }
  const httpAdapter = {
    setHeader: (_response: unknown, name: string, value: string): void => {
      captured.header = { name, value }
    },
    reply: (_response: unknown, body: string, status: number): void => {
      captured.body = body
      captured.status = status
    }
  }
  return { adapterHost: { httpAdapter } as unknown as HttpAdapterHost, captured }
}

/** Build a controller instance registered at `path`, wired to the given registry and options. */
function buildController(params: {
  path: string
  text?: string
  contentType?: string
  options?: ResolvedCoreOptions
}): { controller: MetricsControllerInstance; registry: MetricsRegistry; captured: Captured } {
  const registry = stubRegistry(
    params.text ?? '# HELP up 1\nup 1\n',
    params.contentType ?? 'text/plain; version=0.0.4; charset=utf-8'
  )
  const { adapterHost, captured } = stubAdapterHost()
  const options =
    params.options ?? normalizeCoreOptions({ metrics: { enabled: true, path: params.path } })
  const ControllerClass = createMetricsController(params.path)
  const controller = new ControllerClass(
    registry,
    options,
    adapterHost
  ) as unknown as MetricsControllerInstance
  return { controller, registry, captured }
}

describe('createMetricsController', () => {
  /**
   * Serve the registry exposition with its content type.
   *
   * The handler must scrape the injected registry and reply with exactly that
   * text, the registry's own content type, and a 200 status.
   */
  it('replies with the registry text, content type, and 200', async () => {
    const { controller, registry, captured } = buildController({
      path: 'metrics',
      text: '# HELP http_requests_total\nhttp_requests_total 3\n',
      contentType: 'text/plain; version=0.0.4; charset=utf-8'
    })

    await controller.scrape({})

    expect(registry.metrics).toHaveBeenCalledTimes(1)
    expect(captured.body).toBe('# HELP http_requests_total\nhttp_requests_total 3\n')
    expect(captured.header).toEqual({
      name: 'Content-Type',
      value: 'text/plain; version=0.0.4; charset=utf-8'
    })
    expect(captured.status).toBe(200)
  })

  /**
   * Configurable route does not affect behavior.
   *
   * The factory is exercised with a non-default route to prove the handler
   * behaves identically regardless of the registered path.
   */
  it('behaves the same when registered at a custom route', async () => {
    const { controller, captured } = buildController({ path: 'internal/metrics' })

    await controller.scrape({})

    expect(captured.status).toBe(200)
  })

  /**
   * Async disabled guard.
   *
   * When the resolved options report metrics as disabled but the controller is
   * still reached (only possible on the async path, since routes register
   * unconditionally there), the handler fails fast with a descriptive error
   * instead of serving a disabled feature.
   */
  it('throws a descriptive error when metrics resolves disabled', async () => {
    const options = normalizeCoreOptions({ metrics: { enabled: false, path: 'metrics' } })
    const { controller } = buildController({ path: 'metrics', options })

    await expect(controller.scrape({})).rejects.toThrow(/metrics.*disabled/i)
  })

  /**
   * Async custom-path guard.
   *
   * When the resolved options request a route different from the one this
   * controller instance was registered with (only reachable on the async path,
   * where a custom path cannot be honored), the handler fails fast instead of
   * silently serving the wrong route.
   */
  it('throws a descriptive error when the resolved path does not match the registered route', async () => {
    const options = normalizeCoreOptions({ metrics: { enabled: true, path: 'other' } })
    const { controller } = buildController({ path: 'metrics', options })

    let thrown: unknown
    try {
      await controller.scrape({})
    } catch (error) {
      thrown = error
    }

    // Assert each segment of the guidance message so no part can silently empty
    // out: it must name where the controller is registered, what was requested,
    // why the mismatch is unavoidable on the async path, and how to resolve it.
    expect(thrown).toBeInstanceOf(Error)
    const message = (thrown as Error).message
    expect(message).toContain('controller is registered at "metrics" but the resolved')
    expect(message).toContain('request "other"')
    expect(message).toContain("Route metadata is fixed before forRootAsync's options")
    expect(message).toContain('a custom "metrics.path" is only honored through forRoot()')
    expect(message).toContain('keep the default "metrics" route on the async path.')
  })

  // -------------------------------------------------------------------------
  // Scrape authentication (metrics.authToken)
  // -------------------------------------------------------------------------

  /**
   * With a token configured, a matching `Authorization: Bearer <token>` is served
   * — the credentialed path that lets a deployment expose `/metrics` without
   * publishing its internals to every caller.
   */
  it('serves the exposition when the configured bearer token matches', async () => {
    const { controller, captured } = buildController({
      path: 'metrics',
      options: tokenOptions('s3cret')
    })

    await controller.scrape({}, { headers: { authorization: 'Bearer s3cret' } })

    expect(captured.status).toBe(200)
  })

  /** A present but wrong bearer is refused with 401 (digest mismatch branch). */
  it('refuses the scrape with 401 when the bearer token is wrong', async () => {
    const { controller } = buildController({ path: 'metrics', options: tokenOptions('s3cret') })

    await expect(
      controller.scrape({}, { headers: { authorization: 'Bearer wrong' } })
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })

  /** A non-Bearer scheme is refused with 401 (the scheme-prefix mismatch branch). */
  it('refuses the scrape with 401 when the scheme is not Bearer', async () => {
    const { controller } = buildController({ path: 'metrics', options: tokenOptions('s3cret') })

    await expect(
      controller.scrape({}, { headers: { authorization: 'Token s3cret' } })
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })

  /**
   * The auth scheme name is case-insensitive per RFC 7235, so a lowercase (or mixed
   * case) `bearer` must still be accepted — a valid client must not be rejected on
   * casing alone. Pins the `/i` flag on the scheme match.
   */
  it.each(['bearer s3cret', 'BEARER s3cret', 'BeArEr s3cret'])(
    'serves the exposition for a case-insensitive scheme %p',
    async (authorization) => {
      const { controller, captured } = buildController({
        path: 'metrics',
        options: tokenOptions('s3cret')
      })

      await controller.scrape({}, { headers: { authorization } })

      expect(captured.status).toBe(200)
    }
  )

  /**
   * More than one space or a tab may separate the scheme from the credential; the
   * separator is consumed, not treated as part of the token. Pins the `[ \t]+`
   * separator match.
   */
  it.each(['Bearer  s3cret', 'Bearer\ts3cret'])(
    'serves the exposition when the separator is %p',
    async (authorization) => {
      const { controller, captured } = buildController({
        path: 'metrics',
        options: tokenOptions('s3cret')
      })

      await controller.scrape({}, { headers: { authorization } })

      expect(captured.status).toBe(200)
    }
  )

  /** An absent Authorization header is refused with 401 (the non-string branch). */
  it('refuses the scrape with 401 when the Authorization header is absent', async () => {
    const { controller } = buildController({ path: 'metrics', options: tokenOptions('s3cret') })

    await expect(controller.scrape({}, {})).rejects.toBeInstanceOf(UnauthorizedException)
  })

  /**
   * A bare credential with no scheme must be refused even when it equals the
   * configured token: the header must present the `Bearer` scheme, not the raw
   * secret. Pins the no-scheme-matched guard (a header that carries no bearer prefix
   * is rejected before any digest comparison).
   */
  it('refuses the scrape with 401 when the token is sent without a scheme', async () => {
    const { controller } = buildController({ path: 'metrics', options: tokenOptions('s3cret') })

    await expect(
      controller.scrape({}, { headers: { authorization: 's3cret' } })
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })

  /**
   * The scheme must sit at the START of the header. A `Bearer <token>` embedded after
   * other characters must be refused even if stripping it mid-string would reconstruct
   * the configured token — pins the `^` anchor on the scheme match, closing a
   * header-smuggling path.
   */
  it('refuses the scrape with 401 when the Bearer scheme is not at the start', async () => {
    const { controller } = buildController({ path: 'metrics', options: tokenOptions('abctoken') })

    await expect(
      controller.scrape({}, { headers: { authorization: 'abcBearer token' } })
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })

  /** With no token configured the endpoint stays open even when a request is present. */
  it('serves the exposition unauthenticated when no token is configured', async () => {
    const { controller, captured } = buildController({ path: 'metrics' })

    await controller.scrape({}, { headers: {} })

    expect(captured.status).toBe(200)
  })
})
