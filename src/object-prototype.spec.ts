/**
 * Unit tests for the refusal to boot beside a changed `Object.prototype`.
 *
 * Layer: unit.
 * Goal: a string key the realm's `Object.prototype` does not hold by default, or a default one replaced,
 * is refused at every boot entry (the module, the OpenAPI document and the HTTP floors) with a count
 * and nothing the host wrote; a clean realm boots and serves as before.
 * Mocks: none; the real `@nestjs/swagger` and `helmet` run, the latter against a fake Express application.
 */
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'

import { BymaxCoreModule } from './core.module'
import { applyHttpFloors } from './http/http-floors'
import { assertObjectPrototypeClean } from './object-prototype'
import { applyBymaxOpenApi } from './openapi/openapi.bootstrap'
import { bootApp, ExampleController } from './openapi/__tests__/bootstrap.harness'

const MESSAGE = 'Object.prototype holds names or changes this package cannot run beside'

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
  Object.defineProperty(Object.prototype, name, { value, configurable: true, writable: true })
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

describe('a changed Object.prototype', () => {
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

  it('counts every name that is planted, and says nothing else', async () => {
    Object.defineProperty(Object.prototype, 'one', { value: 1, configurable: true })
    Object.defineProperty(Object.prototype, 'two', { value: 2, configurable: true })
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
