/**
 * Integration tests for the body-depth floor.
 *
 * Layer: integration.
 * Goal: a request body nested deeper than the limit is answered 400 through the envelope, before
 * the consumer's validation recurses over it, on an application route and ahead of a library route alike;
 * with the option off nothing changes.
 * Mocks: none; a real Express Nest app is driven with supertest. The consumer's validation is a
 * pipe that recurses over the body the way class-transformer does.
 */
import { Body, Controller, Module, Post, UsePipes, ValidationPipe } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { IsOptional } from 'class-validator'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { BymaxCoreModule } from '../core.module'
import type { BymaxCoreModuleOptions } from '../core.options'

/** The body of the application route; the pipe transforms every value it holds. */
class EchoDto {
  @IsOptional()
  items?: unknown
}

/** An application route behind the validation pipe every Nest application uses. */
@Controller('app')
class AppController {
  @Post('echo')
  @UsePipes(new ValidationPipe({ transform: true, expectedType: EchoDto }))
  echo(@Body() body: EchoDto): { ok: true } {
    void body
    return { ok: true }
  }
}

@Module({ controllers: [AppController] })
class AppModule {}

/** A body of `levels` nested arrays, as a string. */
const nested = (levels: number): string => '['.repeat(levels) + ']'.repeat(levels)

/** The application route's body: the arrays sit under `items`, so the body is one level deeper. */
const wrapped = (levels: number): string => `{"items":${nested(levels)}}`

/** Start an application with the given core options. */
async function start(options: BymaxCoreModuleOptions): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [BymaxCoreModule.forRoot(options), AppModule]
  }).compile()
  const app = moduleRef.createNestApplication()
  await app.init()
  return app
}

const json = (app: INestApplication, path: string, body: string): request.Test =>
  request(app.getHttpServer()).post(path).set('content-type', 'application/json').send(body)

describe('body-depth floor, enabled', () => {
  let app: INestApplication

  beforeAll(async () => {
    app = await start({ bodyDepth: { enabled: true } })
  })

  afterAll(async () => {
    await app.close()
  })

  it('answers a 4 KB body of 2,000 nested arrays with 400 on an application route', async () => {
    /* Without the floor, the recursion below overflows the stack and the filter answers 500. */
    const res = await json(app, '/app/echo', wrapped(2000))
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({
      code: 'BYMAX_BAD_REQUEST',
      message: 'Request body is nested too deeply'
    })
  })

  it('answers the same body with 400 on a library route', async () => {
    /* No credential and no route of the consumer's: the floor sits before routing. */
    const res = await json(app, '/health/ready', nested(2000))
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('BYMAX_BAD_REQUEST')
  })

  it('accepts a body at the limit of 32 levels', async () => {
    const res = await json(app, '/app/echo', wrapped(31))
    expect(res.status).toBe(201)
  })

  it('refuses a body one level past the limit', async () => {
    const res = await json(app, '/app/echo', wrapped(32))
    expect(res.status).toBe(400)
  })

  it('counts objects as levels too, through arrays', async () => {
    const body =
      '{"a":'.repeat(20) + '[' + '{"a":'.repeat(14) + '1' + '}'.repeat(14) + ']' + '}'.repeat(20)
    const res = await json(app, '/app/echo', body)
    expect(res.status).toBe(400)
  })

  it('lets a flat body with many entries through', async () => {
    const res = await json(
      app,
      '/app/echo',
      JSON.stringify({ items: Array.from({ length: 5000 }, (_, i) => i) })
    )
    expect(res.status).toBe(201)
  })

  it('lets a request with no body through', async () => {
    const res = await request(app.getHttpServer()).post('/app/echo')
    expect(res.status).toBe(201)
  })
})

describe('body-depth floor, custom limit', () => {
  it('honors maxDepth', async () => {
    const app = await start({ bodyDepth: { enabled: true, maxDepth: 3 } })
    try {
      expect((await json(app, '/app/echo', wrapped(2))).status).toBe(201)
      expect((await json(app, '/app/echo', wrapped(3))).status).toBe(400)
    } finally {
      await app.close()
    }
  })
})

describe('body-depth floor, off by default', () => {
  it('does not mount: the deep body reaches the pipe and overflows it', async () => {
    const app = await start({})
    try {
      expect((await json(app, '/app/echo', wrapped(2000))).status).toBe(500)
    } finally {
      await app.close()
    }
  })

  it('does not mount when enabled is false', async () => {
    const app = await start({ bodyDepth: { enabled: false } })
    try {
      expect((await json(app, '/app/echo', wrapped(2000))).status).toBe(500)
    } finally {
      await app.close()
    }
  })
})

describe('body-depth floor, forRootAsync', () => {
  it('is mounted from an asynchronously resolved option', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        BymaxCoreModule.forRootAsync({
          useFactory: async (): Promise<BymaxCoreModuleOptions> => ({
            bodyDepth: { enabled: true, maxDepth: 2 }
          })
        }),
        AppModule
      ]
    }).compile()
    const app = moduleRef.createNestApplication()
    await app.init()
    try {
      expect((await json(app, '/app/echo', wrapped(1))).status).toBe(201)
      expect((await json(app, '/app/echo', wrapped(2))).status).toBe(400)
    } finally {
      await app.close()
    }
  })
})
