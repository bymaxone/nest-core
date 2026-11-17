/**
 * Integration test for what a client that goes away leaves running around the handler timeout.
 *
 * Layer: integration.
 * Goal: an interceptor that encloses the handler timeout, and the handler itself, are both released
 * when the client disconnects before the bound. The interceptor releases the handler, and Nest's
 * router unsubscribes the rest of the chain, so no enclosing `finalize` is left waiting.
 * Mocks: none; a real application on a loopback port, with a global interceptor outside the bound.
 */
import { Controller, Module, Post } from '@nestjs/common'
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { Server } from 'node:http'
import { request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import { finalize, Observable } from 'rxjs'

import { BymaxCoreModule } from '../core.module'

/** What the interceptor outside the bound and the handler saw end. */
const ended = { enclosing: false, handler: false }

/** A global interceptor, registered ahead of the handler timeout, that records its own teardown. */
class Enclosing implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      finalize(() => {
        ended.enclosing = true
      })
    )
  }
}

@Controller('gone')
class GoneController {
  @Post('hang')
  hang(): Observable<unknown> {
    return new Observable(() => () => {
      ended.handler = true
    })
  }
}

@Module({ controllers: [GoneController] })
class GoneModule {}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('handler timeout, a client that disconnects before the bound', () => {
  /**
   * The bound is 5 s and the client leaves after 200 ms, so only the disconnect can end either side.
   */
  it('runs the teardown of the handler and the finalize of an interceptor outside the bound', async () => {
    const ref = await Test.createTestingModule({
      imports: [
        BymaxCoreModule.forRoot({ handlerTimeout: { enabled: true, timeoutMs: 5_000 } }),
        GoneModule
      ]
    }).compile()
    const app = ref.createNestApplication()
    app.useGlobalInterceptors(new Enclosing())
    await app.init()
    await app.listen(0, '127.0.0.1')
    try {
      const { port } = (app.getHttpServer() as Server).address() as AddressInfo
      const req = httpRequest({ port, host: '127.0.0.1', path: '/gone/hang', method: 'POST' })
      req.on('error', () => undefined)
      req.end()
      await sleep(200)
      expect(ended).toEqual({ enclosing: false, handler: false })
      req.destroy()
      await sleep(300)
      expect(ended).toEqual({ enclosing: true, handler: true })
    } finally {
      await app.close()
    }
  })
})
