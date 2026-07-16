/**
 * Unit tests for the `createHealthController` factory.
 *
 * Layer: unit.
 * Goal: prove liveness always replies 200 with the empty-checks shape and
 * never touches readiness; readiness replies 200 when every check is up and
 * 503 with the full checks array (naming the failing check) otherwise; the
 * controller is thin (delegates, does not aggregate); and the async
 * consistency guard fires when the resolved options disagree with how the
 * controller instance was registered.
 * Mocks: a hand-built `HealthService` stub and a hand-built `HttpAdapterHost`
 * capturing the replied body and status (family convention, no supertest at
 * this layer).
 */
import type { HttpAdapterHost } from '@nestjs/core'

import { normalizeCoreOptions } from '../core.options'
import type { ResolvedCoreOptions } from '../core.options'
import { createHealthController } from './health.controller'
import type { HealthResponse } from './health.interfaces'
import type { HealthService } from './health.service'

/** The subset of controller methods the tests invoke directly. */
interface HealthControllerInstance {
  live(): HealthResponse
  ready(response: unknown): Promise<void>
}

/** Build a stub `HealthService` returning fixed liveness and readiness results. */
function stubHealthService(readiness: HealthResponse): HealthService {
  return {
    checkLiveness: jest.fn((): HealthResponse => ({ status: 'ok', checks: [] })),
    checkReadiness: jest.fn((): Promise<HealthResponse> => Promise.resolve(readiness))
  } as unknown as HealthService
}

/** Captured arguments of the adapter's `reply` call. */
interface Captured {
  body: HealthResponse | undefined
  status: number | undefined
}

/** Build a stub `HttpAdapterHost` that captures the replied body and status. */
function stubAdapterHost(): { adapterHost: HttpAdapterHost; captured: Captured } {
  const captured: Captured = { body: undefined, status: undefined }
  const httpAdapter = {
    reply: (_response: unknown, body: HealthResponse, status: number): void => {
      captured.body = body
      captured.status = status
    }
  }
  return { adapterHost: { httpAdapter } as unknown as HttpAdapterHost, captured }
}

/** Build a controller instance registered at `path`, wired to the given service and options. */
function buildController(params: {
  path: string
  readiness: HealthResponse
  options?: ResolvedCoreOptions
}): { controller: HealthControllerInstance; service: HealthService; captured: Captured } {
  const service = stubHealthService(params.readiness)
  const { adapterHost, captured } = stubAdapterHost()
  const options = params.options ?? normalizeCoreOptions({ health: { path: params.path } })
  const ControllerClass = createHealthController(params.path)
  const controller = new ControllerClass(
    service,
    options,
    adapterHost
  ) as unknown as HealthControllerInstance
  return { controller, service, captured }
}

describe('createHealthController', () => {
  /**
   * Liveness shape and isolation.
   *
   * Liveness must reply with the documented empty shape and must never call
   * readiness, since the aggregator is not consulted for liveness.
   */
  it('reports liveness as ok with empty checks and never calls readiness', () => {
    const { controller, service } = buildController({
      path: 'health',
      readiness: { status: 'ok', checks: [] }
    })

    const result = controller.live()

    expect(result).toEqual({ status: 'ok', checks: [] })
    expect(service.checkReadiness).not.toHaveBeenCalled()
  })

  /**
   * All-up readiness.
   *
   * When every indicator is up, readiness replies 200 with the full body.
   */
  it('replies 200 when readiness aggregates to ok', async () => {
    const readiness: HealthResponse = {
      status: 'ok',
      checks: [{ name: 'redis', status: 'up' }]
    }
    const { controller, captured } = buildController({ path: 'health', readiness })

    await controller.ready({})

    expect(captured.status).toBe(200)
    expect(captured.body).toEqual(readiness)
  })

  /**
   * Failing readiness.
   *
   * When any indicator is down, readiness replies 503 with the full checks
   * array, naming the failing check rather than hiding it.
   */
  it('replies 503 and names the failing check when readiness aggregates to error', async () => {
    const readiness: HealthResponse = {
      status: 'error',
      checks: [
        { name: 'redis', status: 'up' },
        { name: 'database', status: 'down', details: { error: 'connection refused' } }
      ]
    }
    const { controller, captured } = buildController({ path: 'health', readiness })

    await controller.ready({})

    expect(captured.status).toBe(503)
    expect(captured.body).toEqual(readiness)
  })

  /**
   * Configurable prefix does not affect behavior.
   *
   * The controller factory is exercised with a non-default prefix to prove
   * the handlers behave identically regardless of the registered path.
   */
  it('behaves the same when registered at a custom prefix', () => {
    const { controller } = buildController({
      path: 'healthz',
      readiness: { status: 'ok', checks: [] }
    })

    expect(controller.live()).toEqual({ status: 'ok', checks: [] })
  })

  /**
   * Async disabled guard.
   *
   * When the resolved options report health as disabled, but the controller
   * is still reached (only possible on the async path, since routes register
   * unconditionally there), the handler fails fast with a descriptive error
   * instead of silently serving a disabled feature.
   */
  it('throws a descriptive error when health resolves disabled', () => {
    const options = normalizeCoreOptions({ health: { enabled: false, path: 'health' } })
    const { controller } = buildController({
      path: 'health',
      readiness: { status: 'ok', checks: [] },
      options
    })

    let thrown: unknown
    try {
      controller.live()
    } catch (error) {
      thrown = error
    }

    // Assert every segment of the disabled-feature guidance so no part can empty
    // out: it must state the feature was reached while disabled, explain why the
    // route is always registered on the async path, and give the two remedies.
    expect(thrown).toBeInstanceOf(Error)
    const message = (thrown as Error).message
    expect(message).toContain('The "health" controller was reached while the feature is disabled.')
    expect(message).toContain('On the forRootAsync path this controller is always registered')
    expect(message).toContain('enable "health" in the resolved options, or do not')
    expect(message).toContain('expose this controller while the feature is disabled.')
  })

  /**
   * Async custom-path guard.
   *
   * When the resolved options request a path different from the one this
   * controller instance was registered with (only reachable on the async
   * path, where a custom path cannot be honored), the handler fails fast
   * instead of silently serving the wrong prefix.
   */
  it('throws a descriptive error when the resolved path does not match the registered prefix', () => {
    const options = normalizeCoreOptions({ health: { path: 'healthz' } })
    const { controller } = buildController({
      path: 'health',
      readiness: { status: 'ok', checks: [] },
      options
    })

    let thrown: unknown
    try {
      controller.live()
    } catch (error) {
      thrown = error
    }

    // Assert each segment of the guidance message so no part can silently empty
    // out: it must name where the controller is registered, why the mismatch is
    // unavoidable on the async path, and the two ways to resolve it.
    expect(thrown).toBeInstanceOf(Error)
    const message = (thrown as Error).message
    expect(message).toContain('controller is registered at "health" but the resolved')
    expect(message).toContain('request "healthz"')
    expect(message).toContain("Route metadata is fixed before forRootAsync's options")
    expect(message).toContain('a custom "health.path" is only honored through forRoot()')
    expect(message).toContain('keep the default "health" prefix on the async path.')
  })
})
