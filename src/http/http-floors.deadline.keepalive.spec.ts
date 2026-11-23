/**
 * Tests for a keep-alive socket after the request deadline answered a request.
 *
 * Layer: integration.
 * Goal: the handler timer of a request the deadline already answered does not close the socket a later
 * request on the same connection is using.
 * Mocks: none; a real listening Nest application on Express and a keep-alive agent.
 */
import { Controller, Get, Module } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { request as send, Agent } from 'node:http'
import type { AddressInfo } from 'node:net'

import { BymaxCoreModule } from '../core.module'
import { applyHttpFloors } from './http-floors'

/** Resolves after `ms` milliseconds. */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

@Controller()
class SlowController {
  @Get('slow')
  async slow(): Promise<{ ok: true }> {
    await sleep(600)
    return { ok: true }
  }

  @Get('second')
  async second(): Promise<{ ok: true }> {
    await sleep(600)
    return { ok: true }
  }
}

@Module({
  imports: [BymaxCoreModule.forRoot({ handlerTimeout: { enabled: true, timeoutMs: 300 } })],
  controllers: [SlowController]
})
class KeepAliveModule {}

/** The status of a GET to `path` through `agent`, or the error code the socket gave. */
function get(app: INestApplication, agent: Agent, path: string): Promise<number | string> {
  const { port } = app.getHttpServer().address() as AddressInfo
  return new Promise((resolve) => {
    const req = send({ host: '127.0.0.1', port, path, agent }, (res) => {
      res.resume()
      res.on('end', () => resolve(res.statusCode as number))
    })
    req.on('error', (error: NodeJS.ErrnoException) => resolve(String(error.code)))
    req.end()
  })
}

describe('the request deadline and a reused keep-alive socket', () => {
  it('answers the later request on the socket, whose own handler timer ends it', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [KeepAliveModule] }).compile()
    const app = moduleRef.createNestApplication()
    await applyHttpFloors(app, {
      helmet: false,
      requestDeadline: { timeoutMs: 50, excludePaths: ['/second'] }
    })
    await app.listen(0, '127.0.0.1')
    const agent = new Agent({ keepAlive: true, maxSockets: 1 })
    try {
      const first = await get(app, agent, '/slow')
      await sleep(75)
      const second = await get(app, agent, '/second')

      expect([first, second]).toEqual([504, 504])
    } finally {
      agent.destroy()
      await app.close()
    }
  }, 10_000)
})
