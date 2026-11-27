/**
 * Unit tests for the refusal to boot beside a changed `Object.prototype`.
 *
 * Layer: unit.
 * Goal: a string key the realm's `Object.prototype` does not hold by default, or a default one replaced,
 * is refused at every boot entry (the module, the OpenAPI document and the HTTP floors) with a count
 * and nothing the host wrote; a clean realm boots and serves as before.
 * Mocks: none; the real `@nestjs/swagger` and `helmet` run, the latter against a fake Express application.
 */
import { runInNewContext } from 'node:vm'

import type { INestApplication } from '@nestjs/common'
import request from 'supertest'

import { BymaxCoreModule } from './core.module'
import { applyHttpFloors } from './http/http-floors'
import { assertObjectPrototypeClean } from './object-prototype'
import { applyBymaxOpenApi } from './openapi/openapi.bootstrap'
import { bootApp, ExampleController } from './openapi/__tests__/bootstrap.harness'

const MESSAGE = 'Object.prototype holds names or changes this package cannot run beside'

/** Whether a name is planted so that `for...in` sees it: the rows that plant run both ways. */
let ENUMERABLE = false

/** The names the peers and the document read that a host could plant, one per family of read. */
const PLANTED = [
  'description',
  'GET /examples',
  'depth',
  'chunks',
  'isWebhook',
  'type',
  'responses',
  'operationId',
  'explorer',
  'exposeInternals',
  'contentSecurityPolicy',
  'customJs'
]

/** `value` planted under `name` while `run` executes. */
async function planted<T>(name: string, value: unknown, run: () => Promise<T> | T): Promise<T> {
  Object.defineProperty(Object.prototype, name, {
    value,
    configurable: true,
    writable: true,
    enumerable: ENUMERABLE
  })
  try {
    return await run()
  } finally {
    delete (Object.prototype as Record<string, unknown>)[name]
  }
}

/** What `run` throws, or nothing. */
async function thrown(run: () => unknown): Promise<(Error & { count?: number }) | undefined> {
  try {
    await run()
  } catch (error) {
    return error as Error & { count?: number }
  }
  return undefined
}

/** A fake Express application the floors accept. */
function fakeApp(): INestApplication {
  return {
    getHttpAdapter: () => ({ getType: () => 'express' }),
    getHttpServer: () => ({ listening: false }),
    use: () => undefined,
    enableCors: () => undefined,
    useBodyParser: () => undefined
  } as unknown as INestApplication
}

describe.each([false, true])('a changed Object.prototype (enumerable: %s)', (enumerable) => {
  beforeAll(() => {
    ENUMERABLE = enumerable
  })
  it.each(PLANTED)('is refused at every boot entry when %s is planted', async (name) => {
    const app = await bootApp({ openapi: { enabled: true } } as never, [ExampleController])

    const found = await planted(name, 'x', async () => ({
      module: await thrown(() => BymaxCoreModule.forRoot({})),
      document: await thrown(() => applyBymaxOpenApi(app)),
      floors: await thrown(() => applyHttpFloors(fakeApp(), {}))
    }))
    await app.close()

    for (const error of [found.module, found.document, found.floors]) {
      expect(error?.message).toBe(MESSAGE)
      expect(error?.count).toBe(1)
      expect(JSON.stringify(error)).not.toContain(name)
    }
  })

  it('carries the count as an enumerable, writable and configurable property', async () => {
    const error = await planted('one', 'x', async () => thrown(() => assertObjectPrototypeClean()))

    expect(Object.getOwnPropertyDescriptor(error, 'count')).toEqual({
      value: 1,
      enumerable: true,
      writable: true,
      configurable: true
    })
  })

  it('counts every name that is planted, and says nothing else', async () => {
    Object.defineProperty(Object.prototype, 'one', {
      value: 1,
      configurable: true,
      enumerable: ENUMERABLE
    })
    Object.defineProperty(Object.prototype, 'two', {
      value: 2,
      configurable: true,
      enumerable: ENUMERABLE
    })
    try {
      expect((await thrown(() => assertObjectPrototypeClean()))?.count).toBe(2)
    } finally {
      delete (Object.prototype as Record<string, unknown>)['one']
      delete (Object.prototype as Record<string, unknown>)['two']
    }
  })

  it.each(['hasOwnProperty', 'toString', 'valueOf', 'isPrototypeOf'])(
    'is refused when the standard %s is replaced',
    async (name) => {
      const original = Object.getOwnPropertyDescriptor(Object.prototype, name) as PropertyDescriptor
      Object.defineProperty(Object.prototype, name, { ...original, value: () => true })
      try {
        expect((await thrown(() => assertObjectPrototypeClean()))?.count).toBe(1)
      } finally {
        Object.defineProperty(Object.prototype, name, original)
      }
    }
  )

  it('is refused when a standard name was replaced before this package loaded', async () => {
    const original = Object.getOwnPropertyDescriptor(
      Object.prototype,
      'toString'
    ) as PropertyDescriptor
    Object.defineProperty(Object.prototype, 'toString', { ...original, value: () => 'changed' })
    try {
      let fresh: { assertObjectPrototypeClean: () => void } | undefined
      jest.isolateModules(() => {
        fresh = require('./object-prototype') as typeof fresh
      })

      expect((await thrown(() => fresh?.assertObjectPrototypeClean()))?.count).toBe(1)
    } finally {
      Object.defineProperty(Object.prototype, 'toString', original)
    }
  })

  it('is refused when a standard name is missing, or becomes enumerable', async () => {
    const valueOf = Object.getOwnPropertyDescriptor(
      Object.prototype,
      'valueOf'
    ) as PropertyDescriptor
    const toString = Object.getOwnPropertyDescriptor(
      Object.prototype,
      'toString'
    ) as PropertyDescriptor
    delete (Object.prototype as unknown as Record<string, unknown>)['valueOf']
    Object.defineProperty(Object.prototype, 'toString', { ...toString, enumerable: true })
    try {
      expect((await thrown(() => assertObjectPrototypeClean()))?.count).toBe(2)
    } finally {
      Object.defineProperty(Object.prototype, 'valueOf', valueOf)
      Object.defineProperty(Object.prototype, 'toString', toString)
    }
  })

  it('is refused when a standard accessor is replaced, whatever Function.prototype.toString answers', async () => {
    const proto = Object.getOwnPropertyDescriptor(
      Object.prototype,
      '__proto__'
    ) as PropertyDescriptor
    const source = Object.getOwnPropertyDescriptor(
      Function.prototype,
      'toString'
    ) as PropertyDescriptor
    Object.defineProperty(Object.prototype, '__proto__', { ...proto, get: () => ({}) })
    Object.defineProperty(Function.prototype, 'toString', {
      ...source,
      value: () => 'function get __proto__() { [native code] }'
    })
    try {
      expect((await thrown(() => assertObjectPrototypeClean()))?.count).toBe(1)
    } finally {
      Object.defineProperty(Function.prototype, 'toString', source)
      Object.defineProperty(Object.prototype, '__proto__', proto)
    }
  })

  it('is refused when a standard function is swapped for another one of the engine, after loading', async () => {
    const original = Object.getOwnPropertyDescriptor(
      Object.prototype,
      'toString'
    ) as PropertyDescriptor
    Object.defineProperty(Object.prototype, 'toString', {
      ...original,
      value: Array.prototype.toString
    })
    try {
      expect((await thrown(() => assertObjectPrototypeClean()))?.count).toBe(1)
    } finally {
      Object.defineProperty(Object.prototype, 'toString', original)
    }
  })

  it("is not refused when a standard name is tighter than the engine's, as in a frozen realm", async () => {
    const original = Object.getOwnPropertyDescriptor(
      Object.prototype,
      'toString'
    ) as PropertyDescriptor
    Object.defineProperty(Object.prototype, 'toString', { ...original, writable: false })
    try {
      expect(await thrown(() => assertObjectPrototypeClean())).toBeUndefined()
    } finally {
      Object.defineProperty(Object.prototype, 'toString', original)
    }
  })

  it.each(['get', 'set', 'value', 'writable', 'enumerable', 'configurable'])(
    'never runs an accessor planted under %s while it compares descriptors',
    async (name) => {
      let ran = 0
      Object.defineProperty(Object.prototype, name, {
        get: () => {
          ran += 1
          throw new Error('HOST')
        },
        configurable: true
      })
      let error: (Error & { count?: number }) | undefined
      try {
        error = await thrown(() => assertObjectPrototypeClean())
      } finally {
        delete (Object.prototype as unknown as Record<string, unknown>)[name]
      }

      expect(error?.message).toBe(MESSAGE)
      expect(error?.count).toBe(1)
      expect(ran).toBe(0)
    }
  )

  it('is refused when a standard function is replaced by something that is not a function', async () => {
    const toString = Object.getOwnPropertyDescriptor(
      Object.prototype,
      'toString'
    ) as PropertyDescriptor
    const valueOf = Object.getOwnPropertyDescriptor(
      Object.prototype,
      'valueOf'
    ) as PropertyDescriptor
    Object.defineProperty(Object.prototype, 'toString', { ...toString, value: 5 })
    Object.defineProperty(Object.prototype, 'valueOf', { ...valueOf, value: {} })
    try {
      expect((await thrown(() => assertObjectPrototypeClean()))?.count).toBe(2)
    } finally {
      Object.defineProperty(Object.prototype, 'toString', toString)
      Object.defineProperty(Object.prototype, 'valueOf', valueOf)
    }
  })

  it('is refused when the __proto__ accessor becomes a data property', async () => {
    const proto = Object.getOwnPropertyDescriptor(
      Object.prototype,
      '__proto__'
    ) as PropertyDescriptor
    Object.defineProperty(Object.prototype, '__proto__', {
      value: 1,
      writable: true,
      enumerable: false,
      configurable: true
    })
    try {
      expect((await thrown(() => assertObjectPrototypeClean()))?.count).toBe(1)
    } finally {
      Object.defineProperty(Object.prototype, '__proto__', proto)
    }
  })

  it.each(['get', 'set'])(
    'is refused when the __proto__ %s is the same function of another realm',
    async (which) => {
      const proto = Object.getOwnPropertyDescriptor(
        Object.prototype,
        '__proto__'
      ) as PropertyDescriptor
      const foreign = runInNewContext(
        `Object.getOwnPropertyDescriptor(Object.prototype, '__proto__').${which}`
      ) as () => unknown
      Object.defineProperty(Object.prototype, '__proto__', { ...proto, [which]: foreign })
      try {
        expect((await thrown(() => assertObjectPrototypeClean()))?.count).toBe(1)
      } finally {
        Object.defineProperty(Object.prototype, '__proto__', proto)
      }
    }
  )

  it('is not refused for a symbol key, which no option or document is read through by name', async () => {
    const key = Symbol('host')
    Object.defineProperty(Object.prototype, key, { value: 1, configurable: true })
    try {
      expect(await thrown(() => assertObjectPrototypeClean())).toBeUndefined()
    } finally {
      delete (Object.prototype as unknown as Record<symbol, unknown>)[key]
    }
  })

  it('leaves a clean realm booting, and serving its document', async () => {
    const app = await bootApp({ openapi: { enabled: true } } as never, [ExampleController])
    await applyBymaxOpenApi(app)
    await app.init()
    const answer = await request(app.getHttpServer()).get('/docs-json')
    await app.close()

    expect(answer.status).toBe(200)
    expect(await thrown(() => applyHttpFloors(fakeApp(), {}))).toBeUndefined()
  })
})

describe('a realm that cannot be built', () => {
  it("is refused with the guard's own error, count 1, whatever vm quoted", () => {
    jest.resetModules()
    jest.doMock('node:vm', () => ({
      runInNewContext: () => {
        throw new TypeError('The property options.timeout must be a number. Received PLANTED-VALUE')
      }
    }))
    try {
      let fresh: { assertObjectPrototypeClean: () => void } | undefined
      jest.isolateModules(() => {
        fresh = require('./object-prototype') as typeof fresh
      })
      let error: (Error & { count?: number }) | undefined
      try {
        fresh?.assertObjectPrototypeClean()
      } catch (thrown) {
        error = thrown as Error & { count?: number }
      }

      expect(error?.message).toBe(MESSAGE)
      expect(error?.count).toBe(1)
      expect(JSON.stringify(error)).not.toContain('PLANTED-VALUE')
    } finally {
      jest.dontMock('node:vm')
    }
  })
})

/** The built-ins the rows below replace, held from before any row does. */
const define = Object.defineProperty
const own = Object.getOwnPropertyDescriptor
const PlainObject = Object

/** What `assertObjectPrototypeClean` throws while `key` of `target` is `replacement`, restored before returning. */
function whileReplaced(
  target: object,
  key: PropertyKey,
  replacement: unknown,
  planted: string | undefined
): (Error & { count?: number }) | undefined {
  const original = own(target, key) as PropertyDescriptor
  if (planted !== undefined) {
    define(PlainObject.prototype, planted, {
      value: 1,
      enumerable: true,
      configurable: true,
      writable: true
    })
  }
  define(target, key, { ...original, value: replacement })
  let thrown: (Error & { count?: number }) | undefined
  try {
    assertObjectPrototypeClean()
  } catch (error) {
    thrown = error as Error & { count?: number }
  } finally {
    define(target, key, original)
    if (planted !== undefined) delete (PlainObject.prototype as Record<string, unknown>)[planted]
  }
  return thrown
}

describe('the guard beside a built-in the host replaced after it loaded', () => {
  it.each([
    ['Object.getOwnPropertyNames', Object, 'getOwnPropertyNames', (): string[] => []],
    ['Object.getOwnPropertyDescriptors', Object, 'getOwnPropertyDescriptors', (): object => ({})],
    [
      'Object.getOwnPropertyDescriptor',
      Object,
      'getOwnPropertyDescriptor',
      (): undefined => undefined
    ],
    ['Object.hasOwn', Object, 'hasOwn', (): boolean => false],
    [
      'Object.defineProperty',
      Object,
      'defineProperty',
      (): never => {
        throw new Error('HOST')
      }
    ],
    [
      'Reflect.apply',
      Reflect,
      'apply',
      (): never => {
        throw new Error('HOST')
      }
    ],
    [
      'Array.prototype[Symbol.iterator]',
      Array.prototype,
      Symbol.iterator,
      function* (): Generator<never> {
        // yields nothing
      }
    ],
    ['Array.prototype.push', Array.prototype, 'push', (): number => 0],
    [
      'Function.prototype.call',
      Function.prototype,
      'call',
      (): never => {
        throw new Error('HOST')
      }
    ],
    [
      'Function.prototype.apply',
      Function.prototype,
      'apply',
      (): never => {
        throw new Error('HOST')
      }
    ],
    [
      'Function.prototype.bind',
      Function.prototype,
      'bind',
      (): never => {
        throw new Error('HOST')
      }
    ]
  ])(
    'still refuses a planted name, with its own error, when %s is replaced',
    (_name, target, key, replacement) => {
      const error = whileReplaced(target, key, replacement, 'planted')

      expect(error?.message).toBe(MESSAGE)
      expect(typeof error?.count).toBe('number')
      expect((error?.count as number) >= 1).toBe(true)
    }
  )

  it.each(['Object', 'Reflect', 'Array', 'JSON'])(
    'refuses, with its own error, when the global %s is not the one it met',
    (name) => {
      const original = own(globalThis, name) as PropertyDescriptor
      define(globalThis, name, { ...original, value: {} })
      let error: (Error & { count?: number }) | undefined
      try {
        assertObjectPrototypeClean()
      } catch (thrown) {
        error = thrown as Error & { count?: number }
      } finally {
        define(globalThis, name, original)
      }

      expect(error?.message).toBe(MESSAGE)
      expect(error?.count).toBe(1)
    }
  )

  it('builds its error from the captured Error, whichever Error the host swapped in', () => {
    const original = own(globalThis, 'Error') as PropertyDescriptor
    define(globalThis, 'Error', { ...original, value: class Fake extends Array {} })
    let error: (Error & { count?: number }) | undefined
    define(PlainObject.prototype, 'planted', {
      value: 1,
      enumerable: true,
      configurable: true,
      writable: true
    })
    try {
      assertObjectPrototypeClean()
    } catch (thrown) {
      error = thrown as Error & { count?: number }
    } finally {
      delete (PlainObject.prototype as Record<string, unknown>)['planted']
      define(globalThis, 'Error', original)
    }

    expect(error).toBeInstanceOf(Error)
    expect(error?.message).toBe(MESSAGE)
  })
})

describe('the guard counting what it relies on, with nothing planted', () => {
  it.each(['call', 'apply', 'bind'])(
    'counts Function.prototype.%s replaced by another function as one change',
    (name) => {
      const error = whileReplaced(Function.prototype, name, (): void => undefined, undefined)

      expect(error?.message).toBe(MESSAGE)
      expect(error?.count).toBe(1)
    }
  )

  it('counts one name called undefined once, not once more for the end of its own list', () => {
    const error = whileReplaced(Function.prototype, 'call', Function.prototype.call, 'undefined')

    expect(error?.message).toBe(MESSAGE)
    expect(error?.count).toBe(1)
  })
})
