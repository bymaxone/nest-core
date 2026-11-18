/**
 * Unit tests for what the log events carry of an error the host threw.
 *
 * Layer: unit.
 * Goal: `message` is library text only and never holds the text of an error a health indicator, a
 * transition sink or a handler threw: that text goes as an `Error` under `err`, for the logger to
 * treat as the host's data, and the fields besides it are closed.
 * Mocks: spies on the Nest logger and fake timers; the service and the interceptor are real.
 */
import { Logger } from '@nestjs/common'
import type { CallHandler, ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Subject } from 'rxjs'

import { normalizeCoreOptions } from './core.options'
import { BymaxHandlerTimeoutInterceptor } from './handler-timeout/handler-timeout.interceptor'
import { HealthService } from './health/health.service'
import type { HealthIndicatorResult, IHealthIndicator } from './health/health.interfaces'
import type { IHealthTransitionSink } from './health/health.transition'

/** What a host-thrown error carries, and the log event's text must never. */
const SECRET = 'SECRET-host-7f3a'

/** The first argument of every call a spy received. */
function entries(spy: jest.SpyInstance): Array<Record<string, unknown>> {
  return spy.mock.calls.map((call) => call[0] as Record<string, unknown>)
}

/** The entry's fields other than `err`, as the text a log line would carry. */
function textOf(entry: Record<string, unknown> | undefined): string {
  const { err: _err, ...rest } = entry ?? {}
  return JSON.stringify(rest)
}

describe('the log events keep the text of a host error out of `message`', () => {
  afterEach(() => jest.restoreAllMocks())

  it('CORE_HEALTH_DOWN carries a rejection as err, and only closed fields besides', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const indicator: IHealthIndicator = {
      name: 'database',
      check: (): Promise<HealthIndicatorResult> => Promise.reject(new Error(SECRET))
    }
    await new HealthService([indicator], normalizeCoreOptions()).checkReadiness()
    const [entry] = entries(warn)
    expect(entry).toEqual({
      event: 'CORE_HEALTH_DOWN',
      message: 'The health check went down',
      check: 'database',
      cause: 'rejected',
      err: expect.objectContaining({ message: SECRET })
    })
    expect((entry as { err: unknown }).err).toBeInstanceOf(Error)
    expect(textOf(entry)).not.toContain(SECRET)
  })

  it('CORE_HEALTH_SINK_FAILED carries the sink error as err', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const sink: IHealthTransitionSink = {
      record: (): void => {
        throw new Error(SECRET)
      }
    }
    const down: IHealthIndicator = {
      name: 'redis',
      check: (): Promise<HealthIndicatorResult> => Promise.resolve({ status: 'down' })
    }
    await new HealthService(
      [down],
      normalizeCoreOptions({ health: { readinessCacheMs: 0 } }),
      undefined,
      undefined,
      sink
    ).checkReadiness()
    const failed = entries(warn).find((entry) => entry['event'] === 'CORE_HEALTH_SINK_FAILED')
    expect(failed).toEqual({
      event: 'CORE_HEALTH_SINK_FAILED',
      message: 'The transition sink threw and was ignored',
      err: expect.objectContaining({ message: SECRET })
    })
    expect(failed?.['err']).toBeInstanceOf(Error)
    expect(textOf(failed)).not.toContain(SECRET)
  })

  it('CORE_HANDLER_LATE_ERROR carries the handler error as err', () => {
    jest.useFakeTimers()
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    const handled = new Subject<string>()
    const context = {
      getType: () => 'http',
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({
        getRequest: () => ({ url: '/p' }),
        getResponse: () => ({
          headersSent: false,
          writableEnded: false,
          once: () => undefined,
          off: () => undefined,
          destroy: () => undefined
        })
      })
    } as unknown as ExecutionContext
    new BymaxHandlerTimeoutInterceptor(
      normalizeCoreOptions({ handlerTimeout: { enabled: true, timeoutMs: 1_000 } }),
      new Reflector()
    )
      .intercept(context, { handle: () => handled } as CallHandler)
      .subscribe({ error: () => undefined })
    jest.advanceTimersByTime(1_000)
    handled.error(new Error(SECRET))
    const [entry] = entries(error)
    expect(entry).toEqual({
      event: 'CORE_HANDLER_LATE_ERROR',
      message: 'A handler threw after its request was answered 504',
      err: expect.objectContaining({ message: SECRET })
    })
    expect((entry as { err: unknown }).err).toBeInstanceOf(Error)
    expect(textOf(entry)).not.toContain(SECRET)
    jest.useRealTimers()
  })
})
