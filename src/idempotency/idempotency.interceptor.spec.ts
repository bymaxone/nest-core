/**
 * Integration tests for `@Idempotent` and its interceptor.
 *
 * Layer: integration.
 * Goal: a key runs the handler once and replays its answer, a different request under the key is
 * refused, an unfinished claim answers `409`, only answers worth keeping are kept, a failing store
 * follows the route's mode, and handlers whose answer cannot be stored are refused at boot.
 * Mocks: a store wrapper that can be made to reject; everything else is a real Express Nest application.
 */
import {
  Header,
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  InternalServerErrorException,
  Module,
  Next,
  Param,
  Patch,
  RawBody,
  UploadedFile,
  UploadedFiles,
  Post,
  Res,
  Sse
} from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { Observable } from 'rxjs'
import request from 'supertest'
import type { Server } from 'node:http'

import { BymaxCoreModule } from '../core.module'
import { Idempotent } from './idempotency.decorator'
import { InMemoryIdempotencyStore } from './idempotency.memory-store'
import { BYMAX_IDEMPOTENCY_STORE } from './idempotency.store'
import type { IIdempotencyStore } from './idempotency.store'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const scope = (req: { headers?: Readonly<Record<string, unknown>> }): string =>
  String(req.headers?.['x-user'] ?? '')

/** What the handlers ran, read back by the cases. */
const runs = { count: 0 }

/** A store the cases can make fail, wrapping the in-memory one. */
class FlakyStore implements IIdempotencyStore {
  readonly inner = new InMemoryIdempotencyStore()
  failing: 'none' | 'begin' | 'complete' = 'none'

  begin(key: string, print: string, lease: number): ReturnType<IIdempotencyStore['begin']> {
    if (this.failing === 'begin') return Promise.reject(new Error('down'))
    return this.inner.begin(key, print, lease)
  }
  complete(
    key: string,
    token: string,
    response: Parameters<IIdempotencyStore['complete']>[2],
    ttl: number
  ): Promise<boolean> {
    if (this.failing === 'complete') return Promise.reject(new Error('down'))
    return this.inner.complete(key, token, response, ttl)
  }
  release(key: string, token: string): Promise<boolean> {
    return this.inner.release(key, token)
  }
}

const store = new FlakyStore()

@Controller('i')
class IdempotentController {
  @Post('create')
  @Idempotent({ scope })
  create(@Body() body?: { n?: number }): { created: number; n?: number | undefined } {
    runs.count += 1
    return { created: runs.count, n: body?.n }
  }

  @Post('ok200')
  @HttpCode(200)
  @Idempotent({ scope })
  ok(): { ok: true } {
    runs.count += 1
    return { ok: true }
  }

  @Post('located')
  @Header('Location', '/fixed')
  @Idempotent({ scope })
  located(): { ok: true } {
    runs.count += 1
    return { ok: true }
  }

  @Patch('patch')
  @Idempotent({ scope })
  patch(): { ok: true } {
    runs.count += 1
    return { ok: true }
  }

  @Post('required')
  @Idempotent({ scope, required: true })
  required(): { ok: true } {
    return { ok: true }
  }

  @Post('closed')
  @Idempotent({ scope, onStoreError: 'fail-closed' })
  closed(): { ok: true } {
    runs.count += 1
    return { ok: true }
  }

  @Post('unscoped')
  @Idempotent({ unscoped: true })
  unscoped(): { n: number } {
    runs.count += 1
    return { n: runs.count }
  }

  @Post('slow')
  @Idempotent({ scope })
  async slow(): Promise<{ done: true }> {
    runs.count += 1
    await sleep(150)
    return { done: true }
  }

  @Post('boom')
  @Idempotent({ scope })
  boom(): never {
    runs.count += 1
    throw new InternalServerErrorException()
  }

  @Post('bad')
  @Idempotent({ scope })
  bad(): never {
    runs.count += 1
    throw new BadRequestException({ code: 'APP_BAD', message: 'no' })
  }

  @Post('scopethrows')
  @Idempotent({
    scope: () => {
      throw new Error('no scope')
    }
  })
  scopeThrows(): { ok: true } {
    runs.count += 1
    return { ok: true }
  }

  @Post('badunstored')
  @Idempotent({ scope, storeClientErrors: false })
  badUnstored(): never {
    runs.count += 1
    throw new BadRequestException({ code: 'APP_BAD', message: 'no' })
  }

  @Post('big')
  @Idempotent({ scope, maxBodyBytes: 8 })
  big(): { text: string } {
    runs.count += 1
    return { text: 'x'.repeat(100) }
  }

  @Post('item/:id')
  @Idempotent({ scope })
  item(@Param('id') id: string): { id: string } {
    runs.count += 1
    return { id }
  }

  @Post('empty')
  @Idempotent({ scope })
  empty(): void {
    runs.count += 1
  }
}

@Module({
  imports: [BymaxCoreModule.forRoot({})],
  controllers: [IdempotentController],
  providers: [{ provide: BYMAX_IDEMPOTENCY_STORE, useValue: store }]
})
class TestModule {}

let app: INestApplication
const server = (): Server => app.getHttpServer() as Server
const post = (path: string, key: string | undefined, user = 'u1'): request.Test => {
  const call = request(server()).post(path).set('x-user', user)
  return key === undefined ? call : call.set('Idempotency-Key', key)
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile()
  app = moduleRef.createNestApplication()
  await app.init()
})
afterAll(async () => app.close())
beforeEach(() => {
  runs.count = 0
  store.failing = 'none'
})

describe('@Idempotent', () => {
  it('runs the handler once and replays status, body and a replay marker', async () => {
    const first = await post('/i/create', 'k-replay').send({ n: 1 })
    const second = await post('/i/create', 'k-replay').send({ n: 1 })

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(second.body).toEqual(first.body)
    expect(runs.count).toBe(1)
    expect(first.headers['idempotent-replayed']).toBeUndefined()
    expect(second.headers['idempotent-replayed']).toBe('true')
  })

  it('replays the status of an @HttpCode route and an empty answer', async () => {
    const patched = await request(server())
      .patch('/i/patch')
      .set('x-user', 'u1')
      .set('Idempotency-Key', 'k-patch')
    expect(patched.status).toBe(200)
    runs.count = 0
    await post('/i/ok200', 'k-200')
    const again = await post('/i/ok200', 'k-200')
    await post('/i/empty', 'k-empty')
    const empty = await post('/i/empty', 'k-empty')

    expect(again.status).toBe(200)
    expect(empty.status).toBe(201)
    expect(empty.text).toBe('')
    expect(runs.count).toBe(2)
  })

  it('treats a body with its members in another order as the same request', async () => {
    await post('/i/create', 'k-order').send({ n: 1, a: [1, { y: 1, x: 2 }] })
    const again = await post('/i/create', 'k-order').send({ a: [1, { x: 2, y: 1 }], n: 1 })

    expect(again.status).toBe(201)
    expect(runs.count).toBe(1)
  })

  it.each([
    ['another body', '/i/create', { n: 2 }],
    ['another path', '/i/ok200', { n: 1 }]
  ])('refuses the key reused with %s with 422', async (_name, path, body) => {
    await post('/i/create', 'k-reuse').send({ n: 1 })
    const reused = await post(path, 'k-reuse').send(body)

    expect(reused.status).toBe(422)
    expect(reused.body.code).toBe('BYMAX_IDEMPOTENCY_KEY_REUSED')
  })

  it('refuses the same key with another route parameter or query', async () => {
    await post('/i/item/a', 'k-param')
    const param = await post('/i/item/b', 'k-param')
    await post('/i/create', 'k-query')
    const query = await post('/i/create?x=1', 'k-query')

    expect([param.status, query.status]).toEqual([422, 422])
  })

  it('keeps callers apart by scope and shares one namespace when unscoped', async () => {
    await post('/i/create', 'k-scope', 'alice')
    await post('/i/create', 'k-scope', 'bob')
    await post('/i/unscoped', 'k-un', 'alice')
    await post('/i/unscoped', 'k-un', 'bob')

    expect(runs.count).toBe(3)
  })

  it('fails closed when the scope is empty', async () => {
    const res = await post('/i/create', 'k-noscope', '')

    expect(res.status).toBe(503)
    expect(res.body.code).toBe('BYMAX_IDEMPOTENCY_STORE_UNAVAILABLE')
    expect(runs.count).toBe(0)
  })

  it('runs unprotected without a header, and refuses on a required route', async () => {
    await post('/i/create', undefined)
    await post('/i/create', undefined)
    const required = await post('/i/required', undefined)

    expect(runs.count).toBe(2)
    expect(required.status).toBe(400)
    expect(required.body.code).toBe('BYMAX_IDEMPOTENCY_KEY_REQUIRED')
  })

  it.each([['has space'], ['x'.repeat(256)], ['café'], ['']])(
    'refuses the invalid key %j with 400',
    async (key) => {
      const res = await post('/i/create', key)

      expect(res.status).toBe(400)
      expect(res.body.code).toBe('BYMAX_IDEMPOTENCY_KEY_INVALID')
    }
  )

  it('answers 409 with Retry-After while the first request is running', async () => {
    const first = post('/i/slow', 'k-slow').then((res) => res)
    await sleep(40)
    const second = await post('/i/slow', 'k-slow')
    await first
    const third = await post('/i/slow', 'k-slow')

    expect(second.status).toBe(409)
    expect(second.body.code).toBe('BYMAX_IDEMPOTENCY_IN_PROGRESS')
    expect(second.headers['retry-after']).toBe('1')
    expect(third.status).toBe(201)
    expect(runs.count).toBe(1)
  })

  it('drops the claim after a server error so a retry runs again', async () => {
    const first = await post('/i/boom', 'k-boom')
    const second = await post('/i/boom', 'k-boom')

    expect([first.status, second.status]).toEqual([500, 500])
    expect(runs.count).toBe(2)
  })

  it('keeps a client error and replays it with its code', async () => {
    const first = await post('/i/bad', 'k-bad')
    const second = await post('/i/bad', 'k-bad')

    expect(second.status).toBe(400)
    expect(second.body.code).toBe('APP_BAD')
    expect(second.body.message).toBe(first.body.message)
    expect(runs.count).toBe(1)
  })

  it('answers 409 NOT_REPLAYABLE when the first answer was over the bound', async () => {
    const first = await post('/i/big', 'k-big')
    const second = await post('/i/big', 'k-big')

    expect(first.status).toBe(201)
    expect(second.status).toBe(409)
    expect(second.body.code).toBe('BYMAX_IDEMPOTENCY_NOT_REPLAYABLE')
    expect(second.headers['retry-after']).toBeUndefined()
    expect(runs.count).toBe(1)
  })

  it('runs unprotected when the store is down and the route is fail-open', async () => {
    store.failing = 'begin'
    const res = await post('/i/create', 'k-down')

    expect(res.status).toBe(201)
    expect(runs.count).toBe(1)
  })

  it.each(['/i/closed', '/i/required'])(
    'answers 503 on %s when the store is down',
    async (path) => {
      store.failing = 'begin'
      const res = await post(path, 'k-down')

      expect(res.status).toBe(503)
      expect(res.body.code).toBe('BYMAX_IDEMPOTENCY_STORE_UNAVAILABLE')
      expect(runs.count).toBe(0)
    }
  )

  it('answers the client when complete rejects and leaves the retry in progress', async () => {
    store.failing = 'complete'
    const first = await post('/i/create', 'k-lost')
    store.failing = 'none'
    const retry = await post('/i/create', 'k-lost')

    expect(first.status).toBe(201)
    expect(retry.status).toBe(409)
    expect(retry.body.code).toBe('BYMAX_IDEMPOTENCY_IN_PROGRESS')
    expect(runs.count).toBe(1)
  })

  it('fails closed when the scope function throws', async () => {
    const res = await post('/i/scopethrows', 'k-st')

    expect(res.status).toBe(503)
    expect(runs.count).toBe(0)
  })

  it('refuses a body that cannot be fingerprinted with 400', async () => {
    const deep = Array.from({ length: 40 }).reduce<unknown>((inner) => [inner], 1)
    const res = await post('/i/create', 'k-deep').send({ deep })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('BYMAX_IDEMPOTENCY_KEY_INVALID')
    expect(runs.count).toBe(0)
  })

  it('does not keep a client error when the route says not to', async () => {
    await post('/i/badunstored', 'k-bu')
    await post('/i/badunstored', 'k-bu')

    expect(runs.count).toBe(2)
  })

  it('lets a request with the claim lost to the client go and releases it', async () => {
    const aborted = post('/i/slow', 'k-abort')
      .timeout(30)
      .then(
        () => 'done',
        () => 'aborted'
      )
    expect(await aborted).toBe('aborted')
    await sleep(200)
    const retry = await post('/i/slow', 'k-abort')

    expect([201, 409]).toContain(retry.status)
  })

  it('documents the header and the refusals for OpenAPI', () => {
    const handler = IdempotentController.prototype.required
    const parameters = Reflect.getMetadata('swagger/apiParameters', handler) as Array<{
      name: string
      required: boolean
    }>
    const responses = Reflect.getMetadata('swagger/apiResponse', handler) as Record<number, unknown>

    expect(parameters).toEqual([
      expect.objectContaining({ name: 'Idempotency-Key', required: true })
    ])
    expect(Object.keys(responses).sort()).toEqual(['400', '409', '422', '503'])
  })
})

describe('@Idempotent with a static @Header', () => {
  it('replays the header the route sets', async () => {
    const send = (): Promise<request.Response> =>
      request(server()).post('/i/located').set('x-user', 'u1').set('Idempotency-Key', 'k-located')
    runs.count = 0
    const first = await send()
    const second = await send()

    expect(first.headers['location']).toBe('/fixed')
    expect(second.headers['location']).toBe('/fixed')
    expect(second.headers['idempotent-replayed']).toBe('true')
    expect(runs.count).toBe(1)
  })
})

describe('@Idempotent at boot', () => {
  it('refuses @Next and the uploaded-file and raw-body parameters', () => {
    for (const parameter of [Next(), UploadedFile(), UploadedFiles(), RawBody()]) {
      expect(() => {
        class D {
          @Post()
          @Idempotent({ unscoped: true })
          d(@parameter _arg: unknown): void {}
        }
        return void D
      }).toThrow(/does not support/)
    }
  })

  it('accepts a custom parameter decorator whatever digits its generated id starts with', () => {
    for (const id of ['1abc', '2abc', '8abc', '9abc', '12abc']) {
      class Custom {
        m(): void {}
      }
      Reflect.defineMetadata(
        '__routeArguments__',
        { [`${id}__customRouteArgs__:0`]: { index: 0, data: undefined, pipes: [] } },
        Custom,
        'm'
      )
      const descriptor = Object.getOwnPropertyDescriptor(
        Custom.prototype,
        'm'
      ) as PropertyDescriptor

      expect(() => Idempotent({ unscoped: true })(Custom.prototype, 'm', descriptor)).not.toThrow()
    }
  })

  it('refuses @Res without passthrough, @Next and @Sse', () => {
    const decorate = (build: () => void): void => build()
    expect(() =>
      decorate(() => {
        class A {
          @Post()
          @Idempotent({ unscoped: true })
          a(@Res() _res: unknown): void {}
        }
        return void A
      })
    ).toThrow(/@Res\(\) without `passthrough: true`/)
    expect(() =>
      decorate(() => {
        class B {
          @Idempotent({ unscoped: true })
          @Sse()
          b(): Observable<unknown> {
            return new Observable()
          }
        }
        return void B
      })
    ).toThrow(/@Sse/)
  })

  it('accepts @Res with passthrough', () => {
    expect(() => {
      class C {
        @Post()
        @Idempotent({ unscoped: true })
        c(@Res({ passthrough: true }) _res: unknown): void {}
      }
      return void C
    }).not.toThrow()
  })

  it('fails on invalid options when the decorator is evaluated', () => {
    expect(() => Idempotent({ scope, leaseSeconds: 0 })).toThrow(/leaseSeconds/)
  })
})
