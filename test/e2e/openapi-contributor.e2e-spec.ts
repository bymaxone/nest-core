/**
 * End-to-end suite: a library describing its own routes in the document.
 *
 * Layer: e2e.
 * Goal: prove the contributor lane over real HTTP against a real scan — a
 * library marks a provider, returns fragments keyed by handler identity, and
 * the served document carries them on the operations that handler produced,
 * with the consumer still outranking the library and the published operation
 * ids unchanged.
 * Mocks: none; a real Express Nest application driven with supertest, reached
 * only through the published specifiers.
 */
import { Controller, Get, Injectable, Module, Post } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { BymaxCoreModule } from '@bymax-one/nest-core'
import type { BymaxCoreModuleOptions } from '@bymax-one/nest-core'
import { applyBymaxOpenApi, BymaxOpenApiContributor } from '@bymax-one/nest-core/openapi'
import type { IOpenApiContributor, OpenApiFragment } from '@bymax-one/nest-core/openapi'

/** The library's own controller, mounted by the application rather than by itself. */
@Controller('auth')
class AuthController {
  /** Public: the caller has no credential yet. */
  @Post('login')
  login(): Record<string, never> {
    return {}
  }

  /** Authenticates with a different credential than everything else. */
  @Post('refresh')
  refresh(): Record<string, never> {
    return {}
  }

  /** Authenticated by the document's default requirement. */
  @Get('me')
  me(): Record<string, never> {
    return {}
  }
}

/**
 * The library's contribution, derived from configuration it alone holds — which
 * is the case that makes the lane necessary rather than convenient.
 */
@BymaxOpenApiContributor()
@Injectable()
class AuthOpenApi implements IOpenApiContributor {
  /** Cookie names a deployment can rename, so no static map could state them. */
  private readonly accessCookie = 'my_access'

  /** Produce the fragments this library's resolved options imply. */
  contributeOpenApi(): OpenApiFragment {
    return {
      components: {
        securitySchemes: {
          authCookie: { type: 'apiKey', in: 'cookie', name: this.accessCookie },
          refreshCookie: { type: 'apiKey', in: 'cookie', name: 'my_refresh' }
        }
      },
      operations: {
        'AuthController.login': { security: [], summary: 'Sign in' },
        'AuthController.refresh': { security: [{ refreshCookie: [] }] }
      }
    }
  }
}

@Module({ controllers: [AuthController], providers: [AuthOpenApi] })
class LibraryModule {}

/** Boot an application importing the library, with the document enabled. */
async function bootApp(options: BymaxCoreModuleOptions): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [BymaxCoreModule.forRoot(options), LibraryModule]
  }).compile()
  return moduleRef.createNestApplication()
}

describe('OpenAPI contributor lane', () => {
  const originalNodeEnv = process.env['NODE_ENV']
  let app: INestApplication | undefined

  beforeEach(() => {
    process.env['NODE_ENV'] = 'test'
  })

  afterEach(async () => {
    await app?.close()
    app = undefined
    process.env['NODE_ENV'] = originalNodeEnv
  })

  /** Serve the document and return it. */
  async function servedDocument(options: BymaxCoreModuleOptions): Promise<Record<string, unknown>> {
    app = await bootApp(options)
    await applyBymaxOpenApi(app)
    await app.init()
    return (await request(app.getHttpServer()).get('/docs-json')).body
  }

  /**
   * The library's description reaches the operations it addressed.
   *
   * All three cases at once: an operation marked public against a document
   * default, one carrying a different credential — the case a single default
   * cannot express — and one left to inherit. The library named handlers; it
   * never named a path, which is the point, since it does not know its own.
   */
  it('carries a library fragment onto the operations its handlers produced', async () => {
    const document = await servedDocument({
      openapi: { enabled: true, security: [{ authCookie: [] }] }
    })
    const paths = document['paths'] as Record<string, Record<string, Record<string, unknown>>>

    expect(paths['/auth/login']?.['post']?.['security']).toEqual([])
    expect(paths['/auth/login']?.['post']?.['summary']).toBe('Sign in')
    expect(paths['/auth/refresh']?.['post']?.['security']).toEqual([{ refreshCookie: [] }])
    expect(paths['/auth/me']?.['get']).not.toHaveProperty('security')
  })

  /**
   * The schemes the library supplied are in the document it contributed to.
   *
   * And a document-level requirement may name one: the consumer configured
   * `authCookie` without declaring it, because their library does.
   */
  it('merges the library security schemes and accepts a requirement naming one', async () => {
    const document = await servedDocument({
      openapi: { enabled: true, security: [{ authCookie: [] }] }
    })
    const components = document['components'] as Record<string, Record<string, unknown>>

    expect(Object.keys(components['securitySchemes'] ?? {}).sort()).toEqual([
      'authCookie',
      'refreshCookie'
    ])
  })

  /**
   * The consumer outranks the library.
   *
   * `operationSecurity` is the consumer's lane and it is applied after the
   * library's, so a deployment can always overrule what a dependency says about
   * its own routes.
   */
  it('lets a consumer override what the library said', async () => {
    const document = await servedDocument({
      openapi: {
        enabled: true,
        securitySchemes: { mine: { type: 'http', scheme: 'basic' } },
        operationSecurity: { 'POST /auth/login': [{ mine: [] }] }
      }
    })
    const paths = document['paths'] as Record<string, Record<string, Record<string, unknown>>>

    expect(paths['/auth/login']?.['post']?.['security']).toEqual([{ mine: [] }])
  })

  /**
   * The published ids are untouched by the lane. Regression guard.
   *
   * The factory this package installs exists to learn the handler mapping, not
   * to rename anything; a client generated from this document before the lane
   * existed must keep working after it.
   */
  it('leaves the published operation ids in the peer format', async () => {
    const document = await servedDocument({ openapi: { enabled: true } })
    const paths = document['paths'] as Record<string, Record<string, Record<string, unknown>>>

    expect(paths['/auth/login']?.['post']?.['operationId']).toBe('AuthController_login')
  })
})
