/**
 * Integration tests for requests refused before routing.
 *
 * Layer: integration.
 * Goal: the body pipeline's and the router's own messages quote the request (a JSON excerpt, a
 * header value, the path), so none of them may reach the envelope, while statuses stay and a
 * refusal raised once a route matched keeps its message.
 * Mocks: none; a real Express Nest app is driven with supertest.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  Injectable,
  MiddlewareConsumer,
  Module,
  NestMiddleware,
  Param,
  ParseIntPipe,
  Post
} from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { BymaxCoreModule } from '../core.module'

/** Throws a plain 400 before routing, the way a consumer's tenant middleware would. */
@Injectable()
class PlainMiddleware implements NestMiddleware {
  use(): never {
    throw new BadRequestException('tenant header missing')
  }
}

/** Throws a coded 400 before routing. */
@Injectable()
class CodedMiddleware implements NestMiddleware {
  use(): never {
    throw new HttpException({ code: 'TENANT_REQUIRED', message: 'tenant header missing' }, 400)
  }
}

/** Routes whose own refusals happen after the route matched. */
@Controller('p')
class ProbeController {
  @Post('login')
  login(@Body() body: unknown): unknown {
    return body
  }

  @Get('num/:id')
  num(@Param('id', ParseIntPipe) id: number): number {
    return id
  }

  @Get('typed')
  typed(): never {
    throw Object.assign(new Error('unsupported charset "OWN"'), {
      status: 415,
      expose: true,
      type: 'charset.unsupported'
    })
  }

  @Get('untyped')
  untyped(): never {
    throw Object.assign(new Error('unsupported charset "OWN"'), { status: 415, expose: true })
  }

  @Get('typed-other')
  typedOther(): never {
    throw Object.assign(new Error('own text'), { status: 422, expose: true, type: 'x.y' })
  }

  @Get('non-string-message')
  nonStringMessage(): never {
    throw new HttpException({ message: 42 }, 409)
  }

  @Get('null-response')
  nullResponse(): never {
    throw new HttpException(null as unknown as string, 409)
  }

  @Get('number-response')
  numberResponse(): never {
    throw new HttpException(5 as unknown as string, 409)
  }

  @Get('no-message')
  noMessage(): never {
    throw new HttpException({ error: 'Conflict' }, 409)
  }

  @Get('bad')
  bad(): never {
    throw new BadRequestException('handler says no')
  }
}

/** Module applying the two middlewares to their own paths. */
@Module({ controllers: [ProbeController] })
class ProbeModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(PlainMiddleware).forRoutes('mw-plain')
    consumer.apply(CodedMiddleware).forRoutes('mw-coded')
  }
}

describe('refusals before routing', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [BymaxCoreModule.forRoot(), ProbeModule]
    }).compile()
    app = moduleRef.createNestApplication()
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  const post = (type: string, body: string): request.Test =>
    request(app.getHttpServer()).post('/p/login').set('content-type', type).send(body)

  it('returns a fixed message for a bare-string JSON body, whatever the body holds', async () => {
    /* A bare string is not JSON, and V8's parse error quotes it whole. */
    const res = await post('application/json', 'hunter2-secret')
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ code: 'BYMAX_BAD_REQUEST', message: 'Malformed request' })
    expect(JSON.stringify(res.body)).not.toContain('hunter2')
  })

  it('does not echo the tail of a password out of a malformed login body', async () => {
    /* V8 quotes about ten characters around the failure, which here is the end of the password. */
    const res = await post('application/json', '{"email":"a@b.c","password":"Pass!","x":}')
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Malformed request')
    expect(JSON.stringify(res.body)).not.toContain('ass!')
  })

  it('returns a fixed 415 message for an unsupported charset', async () => {
    /* The parser quotes the charset the client sent. */
    const res = await post('application/json; charset=NOPE', '{}')
    expect(res.status).toBe(415)
    expect(res.body).toMatchObject({
      code: 'BYMAX_UNSUPPORTED_MEDIA_TYPE',
      message: 'Unsupported media type'
    })
    expect(JSON.stringify(res.body)).not.toContain('NOPE')
  })

  it('returns a fixed 415 message for an unsupported content encoding', async () => {
    /* The parser quotes the content-encoding the client sent. */
    const res = await request(app.getHttpServer())
      .post('/p/login')
      .set('content-type', 'application/json')
      .set('content-encoding', 'zzz-enc')
      .send('{}')
    expect(res.status).toBe(415)
    expect(res.body.message).toBe('Unsupported media type')
    expect(JSON.stringify(res.body)).not.toContain('zzz-enc')
  })

  it('returns the fixed 413 message for an oversized body', async () => {
    /* Over the 100 kB default limit. */
    const res = await post('application/json', JSON.stringify({ a: 'x'.repeat(200_000) }))
    expect(res.status).toBe(413)
    expect(res.body.message).toBe('Request entity too large')
  })

  it('returns a fixed 400 message for a form nested past the depth limit', async () => {
    /* A `querystring.parse.rangeError`, a typed error that is not a SyntaxError. */
    const res = await post('application/x-www-form-urlencoded', `a${'[b]'.repeat(300)}=1`)
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Malformed request')
  })

  it('does not echo an undecodable path parameter', async () => {
    /* The router quotes the parameter, which is part of the path. */
    const res = await request(app.getHttpServer()).get('/p/num/%E0%A4%A')
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Malformed request')
    expect(JSON.stringify(res.body.message)).not.toContain('%E0')
  })

  it('keeps the message of a refusal raised once a route matched', async () => {
    /* A pipe and a handler run with the route set; their text is the application's own. */
    const pipe = await request(app.getHttpServer()).get('/p/num/abc')
    expect(pipe.status).toBe(400)
    expect(pipe.body.message).toContain('numeric string is expected')
    const handler = await request(app.getHttpServer()).get('/p/bad')
    expect(handler.body.message).toBe('handler says no')
  })

  it('replaces the message of a plain 400 a middleware throws, and keeps its status', async () => {
    /* Indistinguishable from the router's mapped SyntaxError, so it fails closed. */
    const res = await request(app.getHttpServer()).get('/mw-plain')
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Malformed request')
  })

  it('keeps the message of a coded 400 a middleware throws', async () => {
    /* A `code` marks the message as the application's own. */
    const res = await request(app.getHttpServer()).get('/mw-coded')
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ code: 'TENANT_REQUIRED', message: 'tenant header missing' })
  })

  it('keys the fixed message on the body-pipeline type, not on the message text', async () => {
    /* The same error text with and without a `type`: only the typed one is a parser refusal. */
    const typed = await request(app.getHttpServer()).get('/p/typed')
    expect(typed.status).toBe(415)
    expect(typed.body.message).toBe('Unsupported media type')
    const untyped = await request(app.getHttpServer()).get('/p/untyped')
    expect(untyped.status).toBe(415)
    expect(untyped.body.message).toBe('unsupported charset "OWN"')
  })

  it('keeps the message of a typed 4xx whose status has no fixed message', async () => {
    /* The table names 400, 413 and 415, the statuses the body pipeline produces. */
    const res = await request(app.getHttpServer()).get('/p/typed-other')
    expect(res.status).toBe(422)
    expect(res.body.message).toBe('own text')
  })

  it('falls back to the exception message when the response carries a non-string message', async () => {
    /* Not a refusal before routing: a matched route, a 409, and a `message` that is no string. */
    const res = await request(app.getHttpServer()).get('/p/non-string-message')
    expect(res.status).toBe(409)
    expect(res.body.message).toBe('Http Exception')
  })

  it('falls back to the exception message for a null response and for one without a message', async () => {
    /* Statuses other than 400 reach the message extraction on every route. */
    const nul = await request(app.getHttpServer()).get('/p/null-response')
    expect(nul.status).toBe(409)
    expect(nul.body.message).toBe('Http Exception')
    const num = await request(app.getHttpServer()).get('/p/number-response')
    expect(num.status).toBe(409)
    expect(num.body.message).toBe('Http Exception')
    const none = await request(app.getHttpServer()).get('/p/no-message')
    expect(none.status).toBe(409)
    expect(none.body.message).toBe('Http Exception')
  })
})
