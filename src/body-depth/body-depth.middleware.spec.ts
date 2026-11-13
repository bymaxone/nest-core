/**
 * Unit tests for the body-depth check and its option.
 *
 * Layer: unit.
 * Goal: pin how depth is counted, that the walk survives a body deeper than the stack, that the
 * refusal quotes nothing from the request, and that an unusable limit fails at boot.
 * Mocks: none.
 */
import { BadRequestException } from '@nestjs/common'
import type { MiddlewareConsumer } from '@nestjs/common'
import type { HttpAdapterHost } from '@nestjs/core'

import { BymaxCoreModule } from '../core.module'
import { BymaxTimingMiddleware } from '../timing/timing.middleware'
import { DEFAULT_CORE_OPTIONS, normalizeCoreOptions } from '../core.options'
import { BymaxBodyDepthMiddleware, exceedsDepth } from './body-depth.middleware'

describe('exceedsDepth', () => {
  it.each([
    ['a scalar', 1, 1, false],
    ['null', null, 1, false],
    ['undefined', undefined, 1, false],
    ['a flat array at depth 1', [1, 2], 1, false],
    ['a flat object at depth 1', { a: 1 }, 1, false],
    ['an empty array', [], 1, false],
    ['two levels against a limit of 1', [[1]], 1, true],
    ['two levels against a limit of 2', [[1]], 2, false],
    ['an object in an array against a limit of 1', [{ a: 1 }], 1, true],
    ['an empty inner array still counts as a level', [[]], 1, true]
  ])('%s', (_name, value, limit, expected) => {
    /* The depth of a container is one more than its deepest child's; a scalar adds none. */
    expect(exceedsDepth(value, limit)).toBe(expected)
  })

  it('measures a body far deeper than the stack without overflowing', () => {
    /* A recursive walk overflows at roughly ten thousand frames; this is a hundred thousand. */
    let body: unknown = []
    for (let i = 0; i < 100_000; i += 1) {
      body = [body]
    }
    expect(exceedsDepth(body, 32)).toBe(true)
  })

  it('treats a Buffer or typed array as a leaf and never expands it', () => {
    /* A raw body is a Buffer; Object.values on it builds one element per byte on the event loop. */
    const values = jest.spyOn(Object, 'values')
    try {
      expect(exceedsDepth(Buffer.alloc(8_000_000), 1)).toBe(false)
      expect(exceedsDepth({ file: new Uint8Array(1_000_000) }, 1)).toBe(false)
      expect(exceedsDepth([new Float64Array(10), Buffer.from('x')], 1)).toBe(false)
      const expanded = values.mock.calls.filter(([arg]) =>
        ArrayBuffer.isView(arg as unknown as ArrayBufferView)
      )
      expect(expanded).toEqual([])
    } finally {
      values.mockRestore()
    }
  })

  it('descends only into arrays and plain objects', () => {
    /* A Map, a Date and a class instance carry no JSON nesting: they are leaves. */
    class Holder {
      readonly inner = [[[1]]]
    }
    expect(exceedsDepth([new Holder(), new Map([[1, [[1]]]]), new Date()], 1)).toBe(false)
    expect(exceedsDepth(Object.assign(Object.create(null), { a: [[1]] }), 2)).toBe(true)
  })

  it('finds depth under a wide level', () => {
    const wide = Array.from({ length: 200_000 }, () => 1)
    expect(exceedsDepth([wide, [[[0]]]], 3)).toBe(true)
    expect(exceedsDepth([wide, [[[0]]]], 4)).toBe(false)
  })
})

describe('BymaxBodyDepthMiddleware', () => {
  const middleware = (maxDepth: number): BymaxBodyDepthMiddleware =>
    new BymaxBodyDepthMiddleware(normalizeCoreOptions({ bodyDepth: { enabled: true, maxDepth } }))

  it('calls next for a body within the limit', () => {
    const next = jest.fn()
    middleware(2).use({ body: [[1]] }, undefined, next)
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('refuses a deeper body with a coded 400 and a fixed message', () => {
    const next = jest.fn()
    let thrown: unknown
    try {
      middleware(1).use({ body: { secret: [{ hunter2: 1 }] } }, undefined, next)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(BadRequestException)
    expect((thrown as BadRequestException).getResponse()).toEqual({
      code: 'BYMAX_BAD_REQUEST',
      message: 'Request body is nested too deeply'
    })
    expect(next).not.toHaveBeenCalled()
  })

  it('does nothing when the request carries no parsed body', () => {
    const next = jest.fn()
    middleware(1).use({}, undefined, next)
    expect(next).toHaveBeenCalledTimes(1)
  })
})

describe('bodyDepth options', () => {
  it('is off with a limit of 32 by default', () => {
    expect(DEFAULT_CORE_OPTIONS.bodyDepth).toEqual({ enabled: false, maxDepth: 32 })
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])(
    'rejects maxDepth %p at boot',
    (maxDepth) => {
      expect(() => normalizeCoreOptions({ bodyDepth: { maxDepth } })).toThrow(
        /bodyDepth\.maxDepth must be a positive safe integer/
      )
    }
  )
})

describe('BymaxCoreModule.configure, body-depth mount', () => {
  /** Capture what `configure` applies and where. */
  function fakeConsumer(): { applied: unknown[]; routes: unknown[] } & MiddlewareConsumer {
    const applied: unknown[] = []
    const routes: unknown[] = []
    const consumer = {
      applied,
      routes,
      apply: (...middleware: unknown[]) => {
        applied.push(...middleware)
        return {
          forRoutes: (...patterns: unknown[]) => {
            routes.push(...patterns)
            return consumer
          }
        }
      }
    }
    return consumer as never
  }

  /** An adapter host reporting the given adapter type, or none at all. */
  function hostFor(type: string | undefined): HttpAdapterHost | undefined {
    return type === undefined
      ? undefined
      : ({
          httpAdapter: { getType: (): string => type, getInstance: (): unknown => ({}) }
        } as never)
  }

  const options = (enabled: boolean): ReturnType<typeof normalizeCoreOptions> =>
    normalizeCoreOptions({ timing: { enabled: false }, bodyDepth: { enabled } })

  it.each(['express', 'some-other-adapter', undefined])('mounts on %s under "/"', (type) => {
    const consumer = fakeConsumer()
    new BymaxCoreModule(options(true), hostFor(type)).configure(consumer)
    expect(consumer.applied).toEqual([BymaxBodyDepthMiddleware])
    expect(consumer.routes).toEqual(['/'])
  })

  it('is not mounted on Fastify, whose middleware runs before the body is parsed', () => {
    const consumer = fakeConsumer()
    new BymaxCoreModule(options(true), hostFor('fastify')).configure(consumer)
    expect(consumer.applied).toEqual([])
  })

  it('is not mounted when disabled', () => {
    const consumer = fakeConsumer()
    new BymaxCoreModule(options(false), hostFor('express')).configure(consumer)
    expect(consumer.applied).toEqual([])
  })

  it('is applied after the timing middleware when both are on', () => {
    const consumer = fakeConsumer()
    const both = normalizeCoreOptions({ bodyDepth: { enabled: true } })
    new BymaxCoreModule(both, hostFor('express')).configure(consumer)
    expect(consumer.applied).toEqual([BymaxTimingMiddleware, BymaxBodyDepthMiddleware])
  })
})
