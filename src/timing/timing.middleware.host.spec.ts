/**
 * Integration tests of `BymaxTimingMiddleware` applied by a host's own module.
 *
 * Layer: integration.
 * Goal: a host that applies the middleware in its own `configure` boots without binding the clock
 * token itself, answers its route, and takes the clock a host does bind.
 * Mocks: none; a real Express Nest application is driven with supertest.
 */
import { Controller, Get, Module } from '@nestjs/common'
import type { INestApplication, MiddlewareConsumer, Provider } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import type { Server } from 'node:http'

import { BymaxCoreModule } from '../core.module'
import { BYMAX_TIMING_CLOCK } from './timing.clock'
import { BymaxTimingMiddleware } from './timing.middleware'

/** A route the middleware wraps. */
@Controller('timed')
class TimedController {
  @Get()
  ping(): { ok: boolean } {
    return { ok: true }
  }
}

/** A host module that applies the middleware itself and may bind extra providers. */
function hostModule(providers: Provider[]): new () => object {
  @Module({
    imports: [BymaxCoreModule.forRoot()],
    controllers: [TimedController],
    providers
  })
  class HostModule {
    configure(consumer: MiddlewareConsumer): void {
      consumer.apply(BymaxTimingMiddleware).forRoutes('*')
    }
  }
  return HostModule
}

describe('BymaxTimingMiddleware applied by the host', () => {
  let app: INestApplication | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  it('boots with no clock bound by the host and answers the route', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [hostModule([])] }).compile()
    app = moduleRef.createNestApplication()
    await app.init()

    const res = await request(app.getHttpServer() as Server).get('/timed')

    expect([res.status, res.body]).toEqual([200, { ok: true }])
  })

  it('reads the clock the host binds', async () => {
    const now = jest.fn(() => 0)
    const moduleRef = await Test.createTestingModule({
      imports: [hostModule([{ provide: BYMAX_TIMING_CLOCK, useValue: { now } }])]
    }).compile()
    app = moduleRef.createNestApplication()
    await app.init()

    await request(app.getHttpServer() as Server).get('/timed')

    expect(now).toHaveBeenCalled()
  })
})
