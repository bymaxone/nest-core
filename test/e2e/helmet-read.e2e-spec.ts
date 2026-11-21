/**
 * End-to-end suite: the helmet options however the host keeps them.
 *
 * Layer: e2e.
 * Goal: a helmet block the host holds behind a proxy that answers only `get`, behind a class
 * accessor or behind non-enumerable properties is honoured, for the nested settings of hsts, the
 * content security policy and the frame options: the response carries the headers the host asked for.
 * Mocks: none; a real Express Nest application driven with supertest.
 */
import { Controller, Get, Module } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { applyHttpFloors } from '@bymax-one/nest-core/http'

/** A route that answers, so the headers have a response to ride on. */
@Controller('h')
class PingController {
  @Get()
  ping(): { ok: true } {
    return { ok: true }
  }
}

@Module({ controllers: [PingController] })
class PingModule {}

/** What the host asks of helmet. */
const WANTED = {
  hsts: { maxAge: 63_072_000, preload: true },
  contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"] } },
  xFrameOptions: { action: 'deny' }
} as const

/** `value` served only through `get`, over an empty target. */
function getOnly<T extends object>(value: T): T {
  return new Proxy({} as T, { get: (_target, key) => Reflect.get(value, key) })
}

/** `value` with every own property behind a getter that is not enumerable. */
function hidden<T extends object>(value: T): T {
  const held = {}
  for (const key of Object.keys(value)) {
    Object.defineProperty(held, key, { get: () => Reflect.get(value, key) })
  }
  return held as T
}

/** `value` kept as accessors of a class instance. */
function accessors<T extends object>(value: T): T {
  class Holder {}
  for (const key of Object.keys(value)) {
    Object.defineProperty(Holder.prototype, key, { get: () => Reflect.get(value, key) })
  }
  return new Holder() as T
}

/** The ways a host can hold one settings object. */
const HOLD: ReadonlyArray<readonly [string, <T extends object>(value: T) => T]> = [
  ['a proxy that answers only get', getOnly],
  ['non-enumerable getters', hidden],
  ['class accessors', accessors]
]

/** Every nested block held one way, inside a block held the same way. */
function held(hold: <T extends object>(value: T) => T): object {
  return hold({
    hsts: hold({ ...WANTED.hsts }),
    contentSecurityPolicy: hold({
      useDefaults: false,
      directives: { defaultSrc: [...WANTED.contentSecurityPolicy.directives.defaultSrc] }
    }),
    xFrameOptions: hold({ ...WANTED.xFrameOptions })
  })
}

describe('the helmet options however the host keeps them', () => {
  let app: INestApplication | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  it.each(HOLD)(
    'honours hsts, the policy and the frame options held as %s',
    async (_name, hold) => {
      const moduleRef = await Test.createTestingModule({ imports: [PingModule] }).compile()
      app = moduleRef.createNestApplication()
      await applyHttpFloors(app, { helmet: held(hold) as never })
      await app.init()

      const response = await request(app.getHttpServer()).get('/h').expect(200)

      expect(response.headers['strict-transport-security']).toBe(
        'max-age=63072000; includeSubDomains; preload'
      )
      expect(response.headers['content-security-policy']).toBe("default-src 'none'")
      expect(response.headers['x-frame-options']).toBe('DENY')
    }
  )
})
