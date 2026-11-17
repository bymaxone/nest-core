/**
 * Integration tests for the keep-alive timeout and the body-size limits of `applyHttpFloors`.
 *
 * Layer: integration.
 * Goal: the keep-alive timeout defaults above the common 60 s load-balancer idle timeout and is
 * configurable; the JSON and urlencoded limits are explicit, separate, enforced with a typed 413,
 * and an unusable value is refused before anything is applied.
 * Mocks: none; a real Express Nest application is driven with supertest.
 */
import { Body, Controller, Module, Post } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import type { Server } from 'node:http'
import request from 'supertest'

import { BymaxCoreModule } from '../core.module'
import { applyHttpFloors } from './http-floors'
import type { HttpFloorsOptions } from './http-floors'

/** Echoes the parsed body back. */
@Controller('p')
class EchoController {
  @Post('echo')
  echo(@Body() body: unknown): unknown {
    return body
  }
}

@Module({ controllers: [EchoController] })
class EchoModule {}

/** Build an Express application, apply the helper, and initialise it. */
async function start(options?: HttpFloorsOptions): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [BymaxCoreModule.forRoot(), EchoModule]
  }).compile()
  const app = moduleRef.createNestApplication()
  await applyHttpFloors(app, options)
  await app.init()
  return app
}

/** A JSON body whose serialised form is exactly `bytes` long. */
const json = (bytes: number): string => `{"a":"${'x'.repeat(bytes - 8)}"}`

/** A urlencoded body whose serialised form is exactly `bytes` long. */
const form = (bytes: number): string => `a=${'x'.repeat(bytes - 2)}`

/** Posts `body` as `type` and returns the response. */
async function post(app: INestApplication, type: 'json' | 'form', body: string) {
  return request(app.getHttpServer() as Server)
    .post('/p/echo')
    .type(type)
    .send(body)
}

/** Applies the floors with unusable options and asserts the refusal left the application as it was. */
async function expectRefusedUntouched(options: HttpFloorsOptions, message: RegExp): Promise<void> {
  const moduleRef = await Test.createTestingModule({ imports: [EchoModule] }).compile()
  const app = moduleRef.createNestApplication<NestExpressApplication>()
  const server = app.getHttpServer() as Server
  const settings = (): number[] => [
    server.headersTimeout,
    server.requestTimeout,
    server.keepAliveTimeout,
    (server as Server & { connectionsCheckingInterval: number }).connectionsCheckingInterval
  ]
  const before = settings()
  const use = jest.spyOn(app, 'use')
  const useBodyParser = jest.spyOn(app, 'useBodyParser')
  try {
    await expect(applyHttpFloors(app, options)).rejects.toThrow(message)
    expect(use).not.toHaveBeenCalled()
    expect(useBodyParser).not.toHaveBeenCalled()
    expect(settings()).toEqual(before)
  } finally {
    await app.close()
  }
}

describe('applyHttpFloors, keep-alive timeout', () => {
  it('defaults to 65 s, above a 60 s load-balancer idle timeout', async () => {
    const app = await start()
    try {
      expect((app.getHttpServer() as Server).keepAliveTimeout).toBe(65_000)
    } finally {
      await app.close()
    }
  })

  it('applies a configured value', async () => {
    const app = await start({ keepAliveTimeoutMs: 620_000 })
    try {
      expect((app.getHttpServer() as Server).keepAliveTimeout).toBe(620_000)
    } finally {
      await app.close()
    }
  })

  it.each([0, -1, 1.5, Number.NaN])(
    'rejects a keep-alive timeout of %p and registers and sets nothing',
    async (value) => {
      await expectRefusedUntouched(
        { keepAliveTimeoutMs: value },
        /keepAliveTimeoutMs must be a positive integer/
      )
    }
  )
})

describe('applyHttpFloors, body limits', () => {
  it('keeps 100 kb for both parsers by default, and refuses above it with a typed 413', async () => {
    const app = await start()
    try {
      expect((await post(app, 'json', json(100_000))).status).toBe(201)
      expect((await post(app, 'form', form(100_000))).status).toBe(201)
      const json413 = await post(app, 'json', json(103_000))
      expect(json413.status).toBe(413)
      expect(json413.body).toMatchObject({ code: 'BYMAX_PAYLOAD_TOO_LARGE' })
      expect((await post(app, 'form', form(103_000))).status).toBe(413)
    } finally {
      await app.close()
    }
  })

  it('limits the two parsers independently, as a size string or a byte count', async () => {
    const app = await start({ bodyLimit: { json: '1kb', urlencoded: 4096 } })
    try {
      expect((await post(app, 'json', json(1_000))).status).toBe(201)
      expect((await post(app, 'json', json(1_100))).status).toBe(413)
      expect((await post(app, 'form', form(4_000))).status).toBe(201)
      expect((await post(app, 'form', form(4_200))).status).toBe(413)
    } finally {
      await app.close()
    }
  })

  it('counts a kilobyte as 1024 bytes, whatever the case of the unit', async () => {
    const app = await start({ bodyLimit: { json: '1kb', urlencoded: '2 KB' } })
    try {
      expect((await post(app, 'json', json(1_024))).status).toBe(201)
      expect((await post(app, 'json', json(1_025))).status).toBe(413)
      expect((await post(app, 'form', form(2_048))).status).toBe(201)
      expect((await post(app, 'form', form(2_049))).status).toBe(413)
    } finally {
      await app.close()
    }
  })

  it('reads a fractional size by the whole number of bytes it comes to', async () => {
    const app = await start({ bodyLimit: { json: '1.5kb' } })
    try {
      expect((await post(app, 'json', json(1_500))).status).toBe(201)
      expect((await post(app, 'json', json(1_600))).status).toBe(413)
    } finally {
      await app.close()
    }
  })

  it('changes one parser and leaves the other at 100 kb', async () => {
    const app = await start({ bodyLimit: { json: '1mb' } })
    try {
      expect((await post(app, 'json', json(500_000))).status).toBe(201)
      expect((await post(app, 'form', form(103_000))).status).toBe(413)
    } finally {
      await app.close()
    }
  })

  it.each([
    ['a zero byte count', { json: 0 }],
    ['a fractional byte count', { urlencoded: 1.5 }],
    ['a negative byte count', { json: -5 }],
    ['a size with no unit', { json: 'big' }],
    ['a zero size', { urlencoded: '0kb' }],
    ['an unknown unit', { json: '5 parsecs' }],
    ['a size under one byte', { json: '0.5b' }],
    ['a size that rounds down to no bytes', { urlencoded: '0.0009kb' }],
    ['a size beyond a safe byte count', { json: '999999999999999999999999gb' }],
    ['a byte count beyond a safe integer', { json: Number.MAX_SAFE_INTEGER + 2 }]
  ])('rejects %s and registers and sets nothing', async (_name, bodyLimit) => {
    await expectRefusedUntouched({ bodyLimit }, /bodyLimit\.(json|urlencoded)/)
  })
})
