/**
 * End-to-end suite: the metrics token however the host keeps it.
 *
 * Layer: e2e.
 * Goal: prove that a scrape token the host holds behind a proxy that answers only `get`, behind a
 * non-enumerable getter, or inside a lazily answering options object is honoured: the endpoint
 * answers 401 without a bearer, 401 with a wrong one and 200 with the right one, in production and
 * in development, and the other options of such an object are kept.
 * Mocks: none; a real Express Nest application driven with supertest.
 */
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { BymaxCoreModule } from '@bymax-one/nest-core'
import type { BymaxCoreModuleOptions } from '@bymax-one/nest-core'

/** The token the host configures. */
const TOKEN = 'scrape-secret-7f3a'

/** The metrics block the host writes, with the token served only through `get`. */
function getOnlyBlock(): object {
  const held = { enabled: true, edgeProtected: true, authToken: TOKEN }
  return new Proxy(
    { enabled: true, edgeProtected: true },
    { get: (target, key) => (key === 'authToken' ? held.authToken : Reflect.get(target, key)) }
  )
}

/** The metrics block with the token behind a getter that is not enumerable. */
function hiddenBlock(): object {
  return Object.defineProperty({ enabled: true, edgeProtected: true }, 'authToken', {
    get: () => TOKEN
  })
}

/** Options that answer every read lazily, through `get` alone. */
function lazyOptions(): object {
  return new Proxy(
    {},
    {
      get: (_target, key) => (key === 'metrics' ? { enabled: true, authToken: TOKEN } : undefined)
    }
  )
}

/** The ways a host can hold the same configuration. */
const HOLDERS: ReadonlyArray<readonly [string, () => BymaxCoreModuleOptions]> = [
  [
    'a metrics block that answers the token through get alone',
    () => ({ metrics: getOnlyBlock() }) as BymaxCoreModuleOptions
  ],
  [
    'a metrics block with the token behind a non-enumerable getter',
    () => ({ metrics: hiddenBlock() }) as BymaxCoreModuleOptions
  ],
  ['options that answer lazily through get alone', () => lazyOptions() as BymaxCoreModuleOptions]
]

describe('the metrics token however the host keeps it', () => {
  const original = process.env['NODE_ENV']
  let app: INestApplication | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
    process.env['NODE_ENV'] = original
  })

  describe.each(['production', 'development'])('with NODE_ENV %s', (environment) => {
    it.each(HOLDERS)('honours the token held as %s', async (_name, options) => {
      process.env['NODE_ENV'] = environment
      const moduleRef = await Test.createTestingModule({
        imports: [BymaxCoreModule.forRoot(options())]
      }).compile()
      app = moduleRef.createNestApplication()
      await app.init()
      const server = app.getHttpServer()

      await request(server).get('/metrics').expect(401)
      await request(server).get('/metrics').set('Authorization', 'Bearer wrong').expect(401)
      await request(server).get('/metrics').set('Authorization', `Bearer ${TOKEN}`).expect(200)
    })
  })

  it('keeps the other options of an object that answers lazily', async () => {
    process.env['NODE_ENV'] = 'development'
    const options = new Proxy(
      {},
      {
        get: (_target, key) =>
          key === 'metrics'
            ? { enabled: true, path: 'internal-metrics', authToken: TOKEN }
            : key === 'health'
              ? { enabled: true, path: 'status' }
              : undefined
      }
    )
    const moduleRef = await Test.createTestingModule({
      imports: [BymaxCoreModule.forRoot(options as BymaxCoreModuleOptions)]
    }).compile()
    app = moduleRef.createNestApplication()
    await app.init()
    const server = app.getHttpServer()

    await request(server).get('/internal-metrics').expect(401)
    await request(server)
      .get('/internal-metrics')
      .set('Authorization', `Bearer ${TOKEN}`)
      .expect(200)
    await request(server).get('/status/live').expect(200)
  })
})
