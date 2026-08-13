/**
 * End-to-end suite: the Fastify adapter.
 *
 * Layer: e2e.
 * Goal: prove request timing behaves identically on both official NestJS
 * platforms, which the README and the technical specification both promise.
 * Nothing exercised Fastify before, and the promise was quietly false: Nest
 * runs middleware on Fastify through `@fastify/middie`, which invokes it with
 * the raw `IncomingMessage`, so the recorder saw no route metadata at all and
 * labelled every request — matched or not — `<unmatched>`. On top of that,
 * `forRoutes('/')` is a mount on Express but an exact match on Fastify, so most
 * requests produced no sample whatsoever. Both are asserted here.
 * Mocks: a spy sink bound through the documented consumer-override pattern, and
 * a guard that rejects deterministically. A real Fastify Nest application,
 * driven through `app.inject`.
 */
import {
  CanActivate,
  Controller,
  Get,
  Global,
  Injectable,
  Module,
  UnauthorizedException,
  UseGuards
} from '@nestjs/common'
import type { DynamicModule, INestApplication } from '@nestjs/common'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'

import { BymaxCoreModule, BYMAX_TIMING_SINK, UNMATCHED_ROUTE } from '@bymax-one/nest-core'
import type { ITimingSink, RequestTimingSample } from '@bymax-one/nest-core'

/** Collects every sample the library hands to the bound sink. */
const samples: RequestTimingSample[] = []

/** Bind the collecting sink the way the README documents a consumer doing it. */
function sinkModule(): DynamicModule {
  const sink: ITimingSink = {
    record: (sample: RequestTimingSample): void => {
      samples.push(sample)
    }
  }
  @Global()
  @Module({
    providers: [{ provide: BYMAX_TIMING_SINK, useValue: sink }],
    exports: [BYMAX_TIMING_SINK]
  })
  class SinkModule {}
  return { module: SinkModule }
}

/** Rejects every request the way an authentication guard rejects an anonymous one. */
@Injectable()
class DenyGuard implements CanActivate {
  /** @throws UnauthorizedException Always. */
  canActivate(): boolean {
    throw new UnauthorizedException()
  }
}

/** The root, a parameterised route, and one behind a rejecting guard. */
@Controller()
class ProbeController {
  @Get()
  root(): { ok: boolean } {
    return { ok: true }
  }

  @Get('items/:id')
  item(): { ok: boolean } {
    return { ok: true }
  }

  @Get('admin')
  @UseGuards(DenyGuard)
  admin(): never {
    throw new Error('unreachable: the guard rejects first')
  }
}

/** Boot a Fastify application, optionally under a global prefix. */
async function bootFastify(prefix?: string): Promise<NestFastifyApplication> {
  samples.length = 0
  const moduleRef = await Test.createTestingModule({
    imports: [BymaxCoreModule.forRoot({ timing: { enabled: true } }), sinkModule()],
    controllers: [ProbeController]
  }).compile()
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  if (prefix !== undefined) {
    app.setGlobalPrefix(prefix)
  }
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
  return app
}

/** Render the collected samples as `route:status` for compact assertions. */
function labels(): string[] {
  return samples.map((sample) => `${sample.route}:${sample.statusCode}`)
}

describe('request timing on the Fastify adapter', () => {
  let app: INestApplication | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  /**
   * Every request is counted, and matched routes carry their template.
   *
   * The route template is the whole point of the label: middie hands the
   * middleware the raw request, which carries neither Express's `req.route` nor
   * Fastify's `req.routeOptions`, so without the bridge every one of these
   * would read `<unmatched>` — which destroys the per-route breakdown and, worse,
   * makes a flood of scanner probes indistinguishable from ordinary traffic.
   * The guard rejection is here for the same reason it is in the Express suite:
   * it never reaches a handler, and it is what credential stuffing looks like.
   */
  it('labels matched routes, the root, and a guard rejection', async () => {
    const fastify = await bootFastify()
    app = fastify

    await fastify.inject({ method: 'GET', url: '/items/9' })
    await fastify.inject({ method: 'GET', url: '/' })
    await fastify.inject({ method: 'GET', url: '/admin' })
    await fastify.inject({ method: 'GET', url: '/.env' })

    expect(labels()).toEqual(['/items/:id:200', '/:200', '/admin:401', `${UNMATCHED_ROUTE}:404`])
  })

  /**
   * A global prefix does not change the shape of the answer.
   *
   * The prefixed root is the case that distinguishes a working mount from a
   * broken one, and the templates must carry the prefix rather than the
   * mount-relative remainder.
   */
  it('keeps the prefix in the template when a global prefix is set', async () => {
    const fastify = await bootFastify('api')
    app = fastify

    await fastify.inject({ method: 'GET', url: '/api/items/9' })
    await fastify.inject({ method: 'GET', url: '/api' })
    await fastify.inject({ method: 'GET', url: '/api/nope' })

    expect(labels()).toEqual(['/api/items/:id:200', '/api:200', `${UNMATCHED_ROUTE}:404`])
  })

  /**
   * Distinct unmatched paths collapse onto one label here too.
   *
   * The cardinality bound is a security property, and it has to hold on both
   * adapters or the weaker one becomes the way in.
   */
  it('collapses distinct unmatched paths onto one label', async () => {
    const fastify = await bootFastify()
    app = fastify

    for (const url of ['/.env', '/.git/config', '/wp-admin', '/admin.php']) {
      await fastify.inject({ method: 'GET', url })
    }

    expect(new Set(labels())).toEqual(new Set([`${UNMATCHED_ROUTE}:404`]))
    expect(samples).toHaveLength(4)
  })
})
