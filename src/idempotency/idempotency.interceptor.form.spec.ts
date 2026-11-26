/**
 * Integration tests for `@Idempotent` on a route that receives a urlencoded body.
 *
 * Layer: integration.
 * Goal: a form body is fingerprinted by its fields on Express and on Fastify, so a repeat replays and
 * other fields under the same key are refused.
 * Mocks: none; real Express and Fastify Nest applications over supertest.
 */
import { Controller, Module, Post } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import type { Server } from 'node:http'

import { BymaxCoreModule } from '../core.module'
import { Idempotent } from './idempotency.decorator'
import { InMemoryIdempotencyStore } from './idempotency.memory-store'
import { BYMAX_IDEMPOTENCY_STORE } from './idempotency.store'

@Controller('f')
class FormController {
  @Post('ok')
  @Idempotent({ unscoped: true })
  ok(): { ok: true } {
    return { ok: true }
  }
}

@Module({
  imports: [BymaxCoreModule.forRoot({})],
  controllers: [FormController],
  providers: [{ provide: BYMAX_IDEMPOTENCY_STORE, useValue: new InMemoryIdempotencyStore() }]
})
class FormModule {}

describe.each([
  ['Express', false],
  ['Fastify', true]
])('@Idempotent with a urlencoded body, on %s', (_platform, fastify) => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [FormModule] }).compile()
    app = fastify
      ? moduleRef.createNestApplication(new FastifyAdapter())
      : moduleRef.createNestApplication()
    await app.init()
    if (fastify) await app.getHttpAdapter().getInstance().ready()
  })
  afterAll(() => app.close())

  /** The status of one keyed form post, and whether it was a replay. */
  async function send(key: string, body: string): Promise<string> {
    const answer = await request(app.getHttpServer() as Server)
      .post('/f/ok')
      .set('Idempotency-Key', `${String(fastify)}-${key}`)
      .type('form')
      .send(body)
    return `${answer.status}${answer.headers['idempotent-replayed'] === 'true' ? ' replayed' : ''}`
  }

  it.each([
    ['fields', 'a=1&b=2', 'b=2&a=1', 'a=9&b=2'],
    ['a repeated field', 'a=1&a=2', 'a=1&a=2', 'a=2&a=1'],
    ['prototype names', 'toString=1&constructor=2', 'constructor=2&toString=1', 'constructor=3'],
    ['an empty body', '', '', 'a=1']
  ])('runs, replays and tells another body apart for %s', async (name, body, same, other) => {
    expect(await send(name.replaceAll(' ', '-'), body)).toBe('201')
    expect(await send(name.replaceAll(' ', '-'), same)).toBe('201 replayed')
    expect(await send(name.replaceAll(' ', '-'), other)).toBe('422')
  })
})
