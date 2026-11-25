/**
 * Integration tests of `TimingInterceptor` used as a host's own route interceptor.
 *
 * Layer: integration.
 * Goal: a host that puts `@UseInterceptors(TimingInterceptor)` on a controller boots without
 * binding the clock token itself, answers its route, and takes the clock a host does bind.
 * Mocks: none; a real Express Nest application is driven with supertest.
 */
import { Controller, Get, UseInterceptors } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import type { Server } from 'node:http'

import { BymaxCoreModule } from '../core.module'
import { BYMAX_TIMING_CLOCK } from './timing.clock'
import { TimingInterceptor } from './timing.interceptor'

/** A route that carries the interceptor itself. */
@Controller('timed')
@UseInterceptors(TimingInterceptor)
class TimedController {
  @Get()
  ping(): { ok: boolean } {
    return { ok: true }
  }
}

describe('TimingInterceptor on a route of the host', () => {
  let app: INestApplication | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  it('boots with no clock bound by the host and answers the route', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [BymaxCoreModule.forRoot()],
      controllers: [TimedController]
    }).compile()
    app = moduleRef.createNestApplication()
    await app.init()

    const res = await request(app.getHttpServer() as Server).get('/timed')

    expect([res.status, res.body]).toEqual([200, { ok: true }])
  })

  it('reads the clock the host binds', async () => {
    const now = jest.fn(() => 0)
    const moduleRef = await Test.createTestingModule({
      imports: [BymaxCoreModule.forRoot()],
      controllers: [TimedController],
      providers: [{ provide: BYMAX_TIMING_CLOCK, useValue: { now } }]
    }).compile()
    app = moduleRef.createNestApplication()
    await app.init()

    await request(app.getHttpServer() as Server).get('/timed')

    expect(now).toHaveBeenCalled()
  })
})
