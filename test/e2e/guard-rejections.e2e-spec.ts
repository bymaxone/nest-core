/**
 * End-to-end suite: requests that never reach a handler.
 *
 * Layer: e2e.
 * Goal: prove the recorder counts the traffic an operator needs during an
 * incident and that nothing else in the stack ever sees — a guard rejecting an
 * unauthenticated call, a guard rejecting a forbidden one, a throttler shedding
 * a brute-force burst, and a request matching no route at all. Before the
 * recorder became middleware these produced no sample whatsoever, because
 * guards run ahead of interceptors and an unmatched request reaches no
 * controller: an application could be under a credential-stuffing run with a
 * flat error graph. The suite also pins the two properties that keep the fix
 * from creating its own problems: each request is counted exactly once, and the
 * unmatched route collapses to a single fixed label instead of minting one time
 * series per path a scanner tries.
 * Mocks: guards that reject deterministically rather than a real authentication
 * or throttling stack — what is under test is whether a rejection is counted,
 * not what decided it. A real Express Nest app driven with supertest, asserted
 * through the Prometheus exposition the deployment actually serves.
 */
import {
  CanActivate,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Injectable,
  Post,
  UnauthorizedException,
  UseGuards
} from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { connect } from 'node:net'
import request from 'supertest'

import { BymaxCoreModule } from '@bymax-one/nest-core'

/** How long the abort probe's route stays in the handler, in milliseconds. */
const ABORT_PROBE_DELAY_MS = 100

/** Rejects every request the way an authentication guard rejects an anonymous one. */
@Injectable()
class DenyAuthenticationGuard implements CanActivate {
  /** @throws UnauthorizedException Always. */
  canActivate(): boolean {
    throw new UnauthorizedException()
  }
}

/** Rejects every request the way an authorization guard rejects a wrong role. */
@Injectable()
class DenyAuthorizationGuard implements CanActivate {
  /** @throws ForbiddenException Always. */
  canActivate(): boolean {
    throw new ForbiddenException()
  }
}

/** Rejects every request the way a rate limiter sheds a burst. */
@Injectable()
class ThrottleGuard implements CanActivate {
  /** @throws HttpException Always, with `429`. */
  canActivate(): boolean {
    throw new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS)
  }
}

/** The surface: one reachable route plus one behind each kind of rejection. */
@Controller()
class GuardedController {
  /** The only route a request actually reaches. */
  @Get('open')
  open(): { ok: boolean } {
    return { ok: true }
  }

  /** Replies only after a delay, so an abort can land while it is still running. */
  @Get('slow')
  async slow(): Promise<{ ok: boolean }> {
    await new Promise((resolve) => {
      setTimeout(resolve, ABORT_PROBE_DELAY_MS)
    })
    return { ok: true }
  }

  /** Parameterised, so the recorded label can be checked for the template. */
  @Get('items/:id')
  item(): { ok: boolean } {
    return { ok: true }
  }

  /** Rejected as unauthenticated — what credential stuffing produces. */
  @Post('session')
  @UseGuards(DenyAuthenticationGuard)
  session(): never {
    throw new Error('unreachable: the guard rejects first')
  }

  /** Rejected as forbidden — what a privilege probe produces. */
  @Get('admin')
  @UseGuards(DenyAuthorizationGuard)
  admin(): never {
    throw new Error('unreachable: the guard rejects first')
  }

  /** Rejected as throttled — what a rate limiter doing its job produces. */
  @Post('login')
  @UseGuards(ThrottleGuard)
  login(): never {
    throw new Error('unreachable: the guard rejects first')
  }
}

/** Parse the exposition into `{ "METHOD route status": value }` for HTTP counts. */
function requestCounts(exposition: string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const line of exposition.split('\n')) {
    const match = /^http_requests_total\{(?<labels>[^}]*)\} (?<value>[\d.]+)$/u.exec(line)
    if (match?.groups === undefined) {
      continue
    }
    const labels = new Map(
      [...(match.groups['labels'] ?? '').matchAll(/(?<key>\w+)="(?<value>[^"]*)"/gu)].map(
        (entry) => [entry.groups?.['key'] ?? '', entry.groups?.['value'] ?? '']
      )
    )
    const key = `${labels.get('method') ?? ''} ${labels.get('route') ?? ''} ${labels.get('status') ?? labels.get('status_code') ?? ''}`
    counts[key] = Number(match.groups['value'])
  }
  return counts
}

describe('requests that never reach a handler', () => {
  let app: INestApplication | undefined

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [BymaxCoreModule.forRoot({ timing: { enabled: true }, metrics: { enabled: true } })],
      controllers: [GuardedController]
    }).compile()
    app = moduleRef.createNestApplication()
    await app.init()
  })

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  /**
   * Every ending is counted, exactly once, under a bounded label.
   *
   * The four rejection cases are the point of the fix; the two reachable ones
   * are the control that proves it did not stop counting what already worked.
   * `exactly once` is asserted on every case rather than mere presence, because
   * the plausible way to fix under-counting is to add a second recorder, and
   * that doubles every rate an alert threshold is tuned against — a silent
   * failure worse than the visible one. The scanner probe is asserted to land
   * on the fixed `<unmatched>` label: recording its raw path would hand an
   * attacker a way to mint unbounded time series, turning an observability fix
   * into a memory-exhaustion vector.
   */
  it('counts guard rejections, throttling and unmatched paths exactly once each', async () => {
    const server = app?.getHttpServer()

    await request(server).get('/open').expect(200)
    await request(server).get('/items/42').expect(200)
    await request(server).post('/session').expect(401)
    await request(server).get('/admin').expect(403)
    await request(server).post('/login').expect(429)
    await request(server).get('/.env').expect(404)

    const scrape = await request(server).get('/metrics').expect(200)
    const counts = requestCounts(scrape.text)

    expect(counts).toMatchObject({
      'GET /open 200': 1,
      'GET /items/:id 200': 1,
      'POST /session 401': 1,
      'GET /admin 403': 1,
      'POST /login 429': 1,
      'GET <unmatched> 404': 1
    })
  })

  /**
   * A client that hangs up mid-handler is counted once, not twice.
   *
   * Destroying the socket does not cancel the JavaScript already running: the
   * handler finishes, writes to a dead socket, and the response object emits
   * `'close'`. Nest's interceptor pipeline saw that as an ordinary success — a
   * peer session measured five aborts producing exactly five `200`s on a real
   * backend — so a recorder that emitted on `'close'` **in addition** to the
   * interceptor would have doubled every aborted request. This suite's other
   * cases prove the middleware sees what the interceptor could not; this one
   * proves it did not start seeing anything twice, which is the failure the
   * obvious fix would have introduced and the quieter of the two.
   *
   * The status stays whatever the response held — `200` by default in Node,
   * since nothing settled another one. Recording a sentinel instead would
   * rewrite the value of `status_code="200"` series that already exist in every
   * deployment, moving error-rate panels with no change in traffic; that is a
   * separate decision from counting the request at all.
   */
  it('counts an aborted request exactly once', async () => {
    const server = app?.getHttpServer() as import('node:http').Server
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve)
    })
    const { port } = server.address() as import('node:net').AddressInfo

    await new Promise<void>((resolve) => {
      const socket = connect(port, '127.0.0.1', () => {
        socket.write('GET /slow HTTP/1.1\r\nHost: localhost\r\n\r\n')
        // Destroyed while the handler is still awaiting, which is the case
        // under test: aborting before it started would exercise a different
        // path and would pass whether or not the double-count exists.
        setTimeout(() => {
          socket.destroy()
          resolve()
        }, ABORT_PROBE_DELAY_MS / 2)
      })
      socket.on('error', () => {
        resolve()
      })
    })
    // The handler is still running: wait past its delay so the sample the
    // completed handler produces has been recorded before the scrape.
    await new Promise((resolve) => {
      setTimeout(resolve, ABORT_PROBE_DELAY_MS * 2)
    })

    const scrape = await request(server).get('/metrics').expect(200)
    const counts = requestCounts(scrape.text)

    expect(counts['GET /slow 200']).toBe(1)
  })

  /**
   * A scanner cannot grow the label set.
   *
   * Distinct probe paths must collapse onto one series whose count rises,
   * rather than one series each. This is the cardinality bound stated as the
   * property an attacker would try to break, not as an implementation detail:
   * five probes, one series, count five.
   */
  it('collapses distinct unmatched paths onto a single series', async () => {
    const server = app?.getHttpServer()
    const probes = ['/.env', '/.git/config', '/wp-admin', '/admin.php', '/../../etc/passwd']

    for (const probe of probes) {
      await request(server).get(probe)
    }

    const scrape = await request(server).get('/metrics').expect(200)
    const counts = requestCounts(scrape.text)
    const unmatched = Object.keys(counts).filter((key) => key.includes('<unmatched>'))

    expect(unmatched).toEqual(['GET <unmatched> 404'])
    expect(counts['GET <unmatched> 404']).toBe(probes.length)
  })
})
