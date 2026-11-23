/**
 * Tests for the request deadline while `Object.prototype` holds a name a property descriptor reads.
 *
 * Layer: integration.
 * Goal: the deadline path defines its own properties with descriptors that inherit nothing, so a
 * `get` planted after boot does not turn the answer to a held request into a thrown `TypeError`.
 * Mocks: none; a real Nest application on Express, driven with supertest.
 */
import { CanActivate, Controller, Get, Module, UseGuards } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { applyHttpFloors } from './http-floors'

/** A guard that holds the request for `300` milliseconds, then lets it through. */
class SlowGuard implements CanActivate {
  async canActivate(): Promise<boolean> {
    await new Promise((resolve) => setTimeout(resolve, 300))
    return true
  }
}

@Controller()
class HeldController {
  @UseGuards(SlowGuard)
  @Get('held')
  held(): { ok: true } {
    return { ok: true }
  }
}

@Module({ controllers: [HeldController] })
class HeldModule {}

describe('the request deadline beside a planted descriptor name', () => {
  let app: INestApplication

  afterEach(async () => {
    delete (Object.prototype as Record<string, unknown>)['get']
    await app.close()
  })

  it('still answers 504 at the deadline when `get` is planted after boot', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [HeldModule] }).compile()
    app = moduleRef.createNestApplication()
    await applyHttpFloors(app, { requestDeadline: { timeoutMs: 100, excludePaths: [] } } as never)
    await app.init()
    Object.defineProperty(Object.prototype, 'get', {
      value: 'planted',
      enumerable: false,
      configurable: true,
      writable: true
    })
    const server = app.getHttpServer()

    const answer = await request(server).get('/held')

    expect(answer.status).toBe(504)
  })
})
