/**
 * Unit tests for the handler-timeout interceptor against a fake execution context.
 *
 * Layer: unit.
 * Goal: what an HTTP round trip cannot tell apart: a non-HTTP context is left alone, a response whose
 * headers are out has its connection destroyed and gets no 504, the close listener is removed when
 * the handler ends, and a class-level opt-out is honoured.
 * Mocks: a fake context and response, a real Reflector, and fake timers.
 */
import { GatewayTimeoutException } from '@nestjs/common'
import type { CallHandler, ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { NEVER, Observable, of, Subject } from 'rxjs'

import { normalizeCoreOptions } from '../core.options'
import {
  handlerSignalOf,
  NO_HANDLER_TIMEOUT_KEY,
  NoHandlerTimeout
} from './handler-timeout.decorators'
import { BymaxHandlerTimeoutInterceptor } from './handler-timeout.interceptor'

/** A response that records what the interceptor does to it. */
class FakeResponse {
  headersSent = false
  writableEnded = false
  destroyed = 0
  readonly listeners = new Set<() => void>()
  once(_event: 'close', listener: () => void): void {
    this.listeners.add(listener)
  }
  off(_event: 'close', listener: () => void): void {
    this.listeners.delete(listener)
  }
  destroy(): void {
    this.destroyed += 1
  }
}

@NoHandlerTimeout()
class OptedOutController {
  handle(): void {}
}

class PlainController {
  handle(): void {}
}

/** A context for `controller.handle`, of the given type, on the given response. */
function contextFor(
  controller: new () => { handle(): void },
  response: FakeResponse,
  type = 'http',
  request: object = { url: '/p' }
): ExecutionContext {
  return {
    getType: () => type,
    getHandler: () => controller.prototype.handle,
    getClass: () => controller,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response
    })
  } as unknown as ExecutionContext
}

const interceptor = (enabled = true, excludePaths: string[] = []): BymaxHandlerTimeoutInterceptor =>
  new BymaxHandlerTimeoutInterceptor(
    normalizeCoreOptions({ handlerTimeout: { enabled, timeoutMs: 1_000, excludePaths } }),
    new Reflector()
  )

/** A handler that never answers. */
const stalled: CallHandler = { handle: () => NEVER }

describe('handler timeout interceptor, on a fake context', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('hands a non-HTTP context straight to the handler', () => {
    const answer = of('x')
    const result = interceptor().intercept(contextFor(PlainController, new FakeResponse(), 'rpc'), {
      handle: () => answer
    })
    expect(result).toBe(answer)
  })

  it('hands every context straight to the handler when it is off', () => {
    const answer = of('x')
    const result = interceptor(false).intercept(contextFor(PlainController, new FakeResponse()), {
      handle: () => answer
    })
    expect(result).toBe(answer)
  })

  it('honours an opt-out placed on the controller class', () => {
    const response = new FakeResponse()
    const result = interceptor().intercept(contextFor(OptedOutController, response), stalled)
    expect(result).toBe(NEVER)
    expect(response.listeners.size).toBe(0)
  })

  /**
   * Headers already sent: a 504 cannot be written, so the connection is destroyed and nothing is
   * thrown.
   */
  it('destroys the connection, and throws nothing, when the headers are already out', () => {
    const response = new FakeResponse()
    response.headersSent = true
    const errors: unknown[] = []
    let completed = false
    interceptor()
      .intercept(contextFor(PlainController, response), stalled)
      .subscribe({ error: (e: unknown) => errors.push(e), complete: () => (completed = true) })
    jest.advanceTimersByTime(1_000)
    expect(response.destroyed).toBe(1)
    expect(errors).toEqual([])
    expect(completed).toBe(false)
  })

  it('answers with a 504 exception when the headers are not out', () => {
    const response = new FakeResponse()
    const errors: unknown[] = []
    interceptor()
      .intercept(contextFor(PlainController, response), stalled)
      .subscribe({ error: (e: unknown) => errors.push(e) })
    jest.advanceTimersByTime(1_000)
    expect(response.destroyed).toBe(0)
    expect(errors[0]).toBeInstanceOf(GatewayTimeoutException)
    expect((errors[0] as GatewayTimeoutException).message).toBe(
      'The request took too long to answer'
    )
  })

  /**
   * The signal a handler holds says why it was aborted: the bound, or the client going away.
   */
  it('aborts the signal with a reason that says why', () => {
    const expired = {}
    interceptor()
      .intercept(contextFor(PlainController, new FakeResponse(), 'http', expired), stalled)
      .subscribe({ error: () => undefined })
    jest.advanceTimersByTime(1_000)
    const atBound = handlerSignalOf(expired)?.reason as GatewayTimeoutException
    expect(atBound).toBeInstanceOf(GatewayTimeoutException)
    expect(atBound.message).toBe('Handler timed out')

    const gone = new FakeResponse()
    const closed = {}
    interceptor()
      .intercept(contextFor(PlainController, gone, 'http', closed), stalled)
      .subscribe()
    gone.listeners.forEach((listener) => listener())
    const atClose = handlerSignalOf(closed)?.reason as Error
    expect(atClose).toBeInstanceOf(Error)
    expect(atClose.message).toBe('The client disconnected')
  })

  it('removes its close listener when the handler ends, and holds none before it is subscribed', () => {
    const response = new FakeResponse()
    const handled = new Subject<string>()
    const result: Observable<unknown> = interceptor().intercept(
      contextFor(PlainController, response),
      { handle: () => handled }
    )
    expect(response.listeners.size).toBe(0)
    result.subscribe()
    expect(response.listeners.size).toBe(1)
    handled.complete()
    expect(response.listeners.size).toBe(0)
  })

  /**
   * A client that goes away aborts the signal; a close that arrives after the response has ended
   * is the normal end of a request and does not.
   */
  it('aborts the signal on a close before the response ended, and not after', () => {
    const early = new FakeResponse()
    const earlyRequest = {}
    interceptor()
      .intercept(contextFor(PlainController, early, 'http', earlyRequest), stalled)
      .subscribe()
    early.listeners.forEach((listener) => listener())
    expect(handlerSignalOf(earlyRequest)?.aborted).toBe(true)

    const late = new FakeResponse()
    late.writableEnded = true
    const lateRequest = {}
    interceptor()
      .intercept(contextFor(PlainController, late, 'http', lateRequest), stalled)
      .subscribe()
    late.listeners.forEach((listener) => listener())
    expect(handlerSignalOf(lateRequest)?.aborted).toBe(false)
  })

  /**
   * The path an excluded prefix is matched against is the request's own, whichever of the two url
   * properties the adapter provides, with the query cut off; a prefix that ends in a slash matches
   * what lies under it.
   */
  it.each([
    ['originalUrl, with a query', { originalUrl: '/p/x?a=1' }, ['/p'], true],
    ['a path equal to the prefix plus a query', { originalUrl: '/p?a=1' }, ['/p'], true],
    [
      'a path under the prefix with a query only on the prefix',
      { url: '/p/x?y=/p' },
      ['/q'],
      false
    ],
    ['url alone', { url: '/p/x' }, ['/p'], true],
    ['originalUrl over url', { originalUrl: '/other', url: '/p/x' }, ['/p'], false],
    ['neither url property', {}, ['/p'], false],
    ['a prefix with a trailing slash, under it', { url: '/p/x' }, ['/p/'], true],
    ['a prefix with a trailing slash, the bare path', { url: '/p' }, ['/p/'], false],
    ['the path equal to the prefix', { url: '/p' }, ['/p'], true]
  ])('matches excludePaths against %s', (_name, request, excludePaths, exempt) => {
    const result = interceptor(true, excludePaths).intercept(
      contextFor(PlainController, new FakeResponse(), 'http', request),
      stalled
    )
    expect(result === NEVER).toBe(exempt)
  })
})

describe('handler timeout metadata key', () => {
  /**
   * The package ships an ESM and a CJS build, and a symbol made in one build is not the symbol of the
   * other, so the key is a string. This pins the type only; it does not load either build.
   */
  it('is a string and not a symbol', () => {
    expect(typeof NO_HANDLER_TIMEOUT_KEY).toBe('string')
  })
})
