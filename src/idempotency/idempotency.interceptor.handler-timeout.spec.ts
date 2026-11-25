/**
 * Integration tests for `@Idempotent` under `handlerTimeout`, on the two sides of its release.
 *
 * Layer: integration.
 * Goal: a handler that ends before `handlerTimeout` releases it leaves the claim kept without a body,
 * and one that ends after it leaves the key in progress.
 * Mocks: none; a real Express Nest application over supertest.
 */
import { Controller, Module, Post } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { Server } from 'node:http'
import request from 'supertest'

import { BymaxCoreModule } from '../core.module'
import { Idempotent } from './idempotency.decorator'
import { InMemoryIdempotencyStore } from './idempotency.memory-store'
import { BYMAX_IDEMPOTENCY_STORE } from './idempotency.store'

const BOUND_MS = 300
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const runs = { count: 0 }
/** What the handler waits on; the test ends the handler by calling `finish`. */
const handler: { gate: Promise<void>; finish: () => void } = {
  gate: Promise.resolve(),
  finish: () => {}
}

@Controller('t')
class SlowController {
  @Post('slow')
  @Idempotent({ unscoped: true })
  async slow(): Promise<{ done: true }> {
    runs.count += 1
    await handler.gate
    return { done: true }
  }
}

async function open(): Promise<INestApplication> {
  @Module({
    imports: [BymaxCoreModule.forRoot({ handlerTimeout: { enabled: true, timeoutMs: BOUND_MS } })],
    controllers: [SlowController],
    providers: [{ provide: BYMAX_IDEMPOTENCY_STORE, useValue: new InMemoryIdempotencyStore() }]
  })
  class TimeoutModule {}
  const moduleRef = await Test.createTestingModule({ imports: [TimeoutModule] }).compile()
  const app = moduleRef.createNestApplication()
  await app.init()
  return app
}

const post = (app: INestApplication): request.Test =>
  request(app.getHttpServer() as Server)
    .post('/t/slow')
    .set('Idempotency-Key', 'timeout-key')

/** Retry until the claim has left the in-progress state, for at most `limit` tries. */
async function settled(app: INestApplication, limit: number): Promise<request.Response> {
  let retry = await post(app)
  for (
    let tries = 1;
    tries < limit && retry.body.code === 'BYMAX_IDEMPOTENCY_IN_PROGRESS';
    tries++
  ) {
    await sleep(25)
    retry = await post(app)
  }
  return retry
}

describe('@Idempotent under handlerTimeout, on the two sides of the release', () => {
  beforeEach(() => {
    runs.count = 0
    handler.gate = new Promise<void>((resolve) => {
      handler.finish = resolve
    })
  })

  it('keeps the claim without a body when the handler ends within one more bound of the 504', async () => {
    const app = await open()
    try {
      const first = await post(app)
      handler.finish()
      const retry = await settled(app, 80)

      expect(first.status).toBe(504)
      expect([retry.status, retry.body.code]).toEqual([409, 'BYMAX_IDEMPOTENCY_NOT_REPLAYABLE'])
      expect(runs.count).toBe(1)
    } finally {
      await app.close()
    }
  })

  it('leaves the key in progress when the handler ends after the release', async () => {
    const app = await open()
    try {
      const first = await post(app)
      await sleep(1000)
      handler.finish()
      await sleep(100)
      const retry = await post(app)

      expect(first.status).toBe(504)
      expect([retry.status, retry.body.code]).toEqual([409, 'BYMAX_IDEMPOTENCY_IN_PROGRESS'])
      expect(runs.count).toBe(1)
    } finally {
      await app.close()
    }
  })
})
