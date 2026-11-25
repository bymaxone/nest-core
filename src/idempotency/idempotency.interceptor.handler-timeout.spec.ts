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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const runs = { count: 0 }

@Controller('t')
class SlowController {
  @Post('slow')
  @Idempotent({ unscoped: true })
  async slow(): Promise<{ done: true }> {
    runs.count += 1
    await sleep(150)
    return { done: true }
  }
}

async function open(timeoutMs: number): Promise<INestApplication> {
  @Module({
    imports: [BymaxCoreModule.forRoot({ handlerTimeout: { enabled: true, timeoutMs } })],
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

describe('@Idempotent under handlerTimeout, with a handler of 150 ms', () => {
  beforeEach(() => {
    runs.count = 0
  })

  it.each([
    [100, 409, 'BYMAX_IDEMPOTENCY_NOT_REPLAYABLE'],
    [60, 409, 'BYMAX_IDEMPOTENCY_IN_PROGRESS']
  ])('after a bound of %i ms the retry answers %i %s', async (timeoutMs, status, code) => {
    const app = await open(timeoutMs)
    try {
      const first = await post(app)
      await sleep(250)
      const retry = await post(app)

      expect(first.status).toBe(504)
      expect([retry.status, retry.body.code]).toEqual([status, code])
      expect(runs.count).toBe(1)
    } finally {
      await app.close()
    }
  })
})
