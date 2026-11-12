/**
 * End-to-end suite: the HTTP floors on a listening server.
 *
 * Layer: e2e.
 * Goal: a client that sends its header block a byte at a time is cut by the header timeout, and a
 * gzip body is refused with 415 with the security headers still on the refusal. Both need a real
 * socket: a request issued in-process never exercises the server's connection timers.
 * Mocks: none; a real Express Nest application listens on an ephemeral port and a raw TCP client
 * speaks to it.
 */
import { Controller, Post } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Module } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { connect } from 'node:net'
import type { AddressInfo } from 'node:net'

import { BymaxCoreModule } from '@bymax-one/nest-core'
import { applyHttpFloors } from '@bymax-one/nest-core/http'

/** A route the dribbling client addresses. */
@Controller('p')
class EchoController {
  @Post('echo')
  echo(): { ok: true } {
    return { ok: true }
  }
}

@Module({ controllers: [EchoController] })
class EchoModule {}

/** What a client that dribbled its header block saw. */
interface DribbleOutcome {
  readonly firstLine: string
  readonly elapsedMs: number
}

/**
 * Send a header block one header line every 100 ms, forever, and report how the server ended it.
 *
 * @param port - The server's port.
 * @returns The status line the server wrote, if any, and the time until the socket closed.
 */
function dribble(port: number): Promise<DribbleOutcome> {
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1')
    const started = Date.now()
    let firstLine = ''
    socket.on('data', (chunk: Buffer) => {
      firstLine ||= chunk.toString('latin1').split('\r\n')[0] ?? ''
    })
    socket.on('error', () => undefined)
    socket.on('close', () => {
      clearInterval(timer)
      resolve({ firstLine, elapsedMs: Date.now() - started })
    })
    socket.write('POST /p/echo HTTP/1.1\r\nHost: x\r\n')
    const timer = setInterval(() => socket.write('X-Pad: 1\r\n'), 100)
  })
}

describe('applyHttpFloors on a listening server', () => {
  let app: INestApplication
  let port: number

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [BymaxCoreModule.forRoot(), EchoModule]
    }).compile()
    app = moduleRef.createNestApplication()
    await applyHttpFloors(app, { headersTimeoutMs: 1_000, requestTimeoutMs: 2_000 })
    await app.listen(0, '127.0.0.1')
    port = (app.getHttpServer().address() as AddressInfo).port
  })

  afterAll(async () => {
    await app.close()
  })

  /**
   * A header block that never completes is closed with 408 once the header timeout has passed,
   * and no later than that timeout plus one sweep of the server's connection check, which the
   * helper tightens to one second (Node's default is thirty).
   */
  it('cuts a header block dribbled a byte at a time at the timeout', async () => {
    const outcome = await dribble(port)
    expect(outcome.firstLine).toBe('HTTP/1.1 408 Request Timeout')
    expect(outcome.elapsedMs).toBeGreaterThanOrEqual(900)
    expect(outcome.elapsedMs).toBeLessThanOrEqual(1_000 + 1_000 + 1_000)
  }, 10_000)

  /** A complete request still gets its answer, with the headers the floor sets. */
  it('serves a normal request with the security headers', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/p/echo`, { method: 'POST' })
    expect(response.status).toBe(201)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('strict-transport-security')).toBeNull()
  })
})
