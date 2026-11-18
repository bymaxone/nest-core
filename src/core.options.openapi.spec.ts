/**
 * Unit tests for the shape checks on the OpenAPI options.
 *
 * Layer: unit.
 * Goal: a malformed server, security scheme, requirement, operation key, route or id factory fails at
 * boot with a message that names the option and the type of the value, instead of when the document is
 * first built, and a well-formed declaration is carried through unchanged.
 * Mocks: none; the resolver is real.
 */
import { normalizeCoreOptions } from './core.options'
import type { BymaxCoreModuleOptions } from './core.options'

/** What a hostile value must never leak into a message. */
const SECRET = 'SECRET-sentinel-7f3a'

/** The message of what `normalizeCoreOptions` throws for an OpenAPI block, or `undefined`. */
function refusal(openapi: unknown): string | undefined {
  try {
    normalizeCoreOptions({ openapi } as BymaxCoreModuleOptions)
    return undefined
  } catch (error) {
    return (error as Error).message
  }
}

describe('openapi declarations that are refused', () => {
  it.each([
    ['servers that are not a list', { servers: SECRET }, 'openapi.servers must be an array'],
    [
      'a server that is not an object',
      { servers: [SECRET] },
      'openapi.servers[0] must be an object'
    ],
    [
      'a server with no url',
      { servers: [{}] },
      'openapi.servers[0].url must be a non-empty string'
    ],
    ['a server with an empty url', { servers: [{ url: '' }] }, 'openapi.servers[0].url'],
    ['a server url that is a number', { servers: [{ url: 5 }] }, 'received 5'],
    [
      'a server description that is not a string',
      { servers: [{ url: '/api', description: 3 }] },
      'openapi.servers[0].description must be a string'
    ],
    [
      'a server with an option it does not have',
      { servers: [{ url: '/api', label: 'x' }] },
      'openapi.servers[0] has an unknown option "label"'
    ],
    [
      'schemes that are a list',
      { securitySchemes: [] },
      'openapi.securitySchemes must be an object'
    ],
    [
      'a scheme that is not an object',
      { securitySchemes: { a: SECRET } },
      'openapi.securitySchemes.a must be an object'
    ],
    [
      'a scheme with no type',
      { securitySchemes: { a: {} } },
      'openapi.securitySchemes.a.type must be one of apiKey, http, oauth2, openIdConnect, mutualTLS'
    ],
    [
      'a scheme with a type that is not one of the specification',
      { securitySchemes: { a: { type: 'bearer' } } },
      'openapi.securitySchemes.a.type must be one of'
    ],
    [
      'an http scheme with no scheme',
      { securitySchemes: { a: { type: 'http' } } },
      'openapi.securitySchemes.a.scheme must be a non-empty string'
    ],
    [
      'an http scheme with an empty scheme',
      { securitySchemes: { a: { type: 'http', scheme: '' } } },
      'openapi.securitySchemes.a.scheme'
    ],
    [
      'an api key with no location',
      { securitySchemes: { a: { type: 'apiKey', name: 'k' } } },
      'openapi.securitySchemes.a.in must be one of header, query, cookie'
    ],
    [
      'an api key with a location that is not one of the three',
      { securitySchemes: { a: { type: 'apiKey', name: 'k', in: 'body' } } },
      'openapi.securitySchemes.a.in must be one of'
    ],
    [
      'an api key with no name',
      { securitySchemes: { a: { type: 'apiKey', in: 'header' } } },
      'openapi.securitySchemes.a.name must be a non-empty string'
    ],
    ['security that is not a list', { security: {} }, 'openapi.security must be an array'],
    [
      'a requirement that is not an object',
      { security: [SECRET] },
      'openapi.security[0] must be an object'
    ],
    [
      'scopes that are not a list',
      { security: [{ a: SECRET }] },
      'openapi.security[0].a must be a list of strings'
    ],
    [
      'a scope that is not a string',
      { security: [{ a: [1] }] },
      'openapi.security[0].a must be a list of strings'
    ],
    [
      'operationSecurity that is a list',
      { operationSecurity: [] },
      'openapi.operationSecurity must be an object'
    ],
    [
      'an operation key that is not "<METHOD> /path"',
      { operationSecurity: { [`get /x ${SECRET}`]: [] } },
      'openapi.operationSecurity key number 1 must be "<METHOD> /path"'
    ],
    [
      'operation requirements that are not a list',
      { operationSecurity: { 'GET /x': SECRET } },
      'openapi.operationSecurity entry 1 must be an array'
    ],
    [
      'an id factory that is not a function',
      { operationIdFactory: SECRET },
      'openapi.operationIdFactory must be a function'
    ],
    ['a path with a space', { path: 'my docs' }, 'openapi.path must be a route'],
    ['an empty json path', { jsonPath: '' }, 'openapi.jsonPath must be a route'],
    ['a path with a query', { path: 'docs?x=1' }, 'openapi.path must be a route'],
    ['a title that is not a string', { title: 1 }, 'openapi.title must be a string'],
    [
      'a description that is not a string',
      { description: {} },
      'openapi.description must be a string'
    ],
    ['a version that is not a string', { version: [] }, 'openapi.version must be a string']
  ])('%s', (_name, openapi, expected) => {
    const message = refusal(openapi)
    expect(message).toContain(expected)
    expect(message).not.toContain(SECRET)
  })
})

describe('openapi declarations that are accepted', () => {
  it('carries a complete declaration through', () => {
    const given = {
      enabled: true,
      path: '/docs',
      jsonPath: 'docs-json',
      title: 'T',
      description: 'D',
      version: '2',
      servers: [{ url: '/api' }, { url: 'https://x.example.com', description: 'x' }],
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer' },
        key: { type: 'apiKey', in: 'cookie', name: 's' },
        oauth: { type: 'oauth2', flows: {} },
        oidc: { type: 'openIdConnect', openIdConnectUrl: 'https://x.example.com' },
        mtls: { type: 'mutualTLS' }
      },
      security: [{ bearer: [] }],
      operationSecurity: { 'POST /auth/login': [], 'GET /users/{id}': [{ key: ['read'] }] },
      operationIdFactory: (controller: string, method: string) => `${controller}.${method}`
    }
    const resolved = normalizeCoreOptions({ openapi: given }).openapi
    expect(resolved.servers).toEqual(given.servers)
    expect(resolved.securitySchemes).toEqual(given.securitySchemes)
    expect(resolved.operationSecurity).toEqual(given.operationSecurity)
    expect(resolved.operationIdFactory).toBe(given.operationIdFactory)
    expect(resolved.path).toBe('/docs')
  })

  it('reads null as unset on every declaration', () => {
    const resolved = normalizeCoreOptions({
      openapi: {
        servers: null,
        securitySchemes: null,
        security: null,
        operationSecurity: null,
        operationIdFactory: null,
        path: null
      }
    } as never).openapi
    expect(resolved.servers).toEqual([])
    expect(resolved.securitySchemes).toEqual({})
    expect(resolved.security).toEqual([])
    expect(resolved.operationSecurity).toEqual({})
    expect(resolved.operationIdFactory).toBeUndefined()
    expect(resolved.path).toBe('docs')
  })

  it('keeps an absent server description absent, and reads a null one as absent', () => {
    const { servers } = normalizeCoreOptions({
      openapi: { servers: [{ url: '/a' }, { url: '/b', description: null }] }
    } as never).openapi
    expect(servers).toEqual([{ url: '/a' }, { url: '/b' }])
  })

  it('refuses a sparse server list as a server that is not an object', () => {
    const sparse = [{ url: '/a' }]
    sparse[2] = { url: '/c' }
    expect(refusal({ servers: sparse })).toContain('openapi.servers[1] must be an object')
  })
})

describe('openapi refusals carry exact messages', () => {
  it.each([
    [
      'a scheme that is null',
      { securitySchemes: { a: null } },
      'openapi.securitySchemes.a must be an object, received null'
    ],
    [
      'an http scheme with no scheme',
      { securitySchemes: { a: { type: 'http' } } },
      'openapi.securitySchemes.a.scheme must be a non-empty string, received undefined'
    ],
    [
      'an http scheme that is empty',
      { securitySchemes: { a: { type: 'http', scheme: '' } } },
      'openapi.securitySchemes.a.scheme must be a non-empty string, received a string'
    ],
    [
      'an api key with no name',
      { securitySchemes: { a: { type: 'apiKey', in: 'header' } } },
      'openapi.securitySchemes.a.name must be a non-empty string, received undefined'
    ],
    [
      'an api key with an empty name',
      { securitySchemes: { a: { type: 'apiKey', in: 'header', name: '' } } },
      'openapi.securitySchemes.a.name must be a non-empty string, received a string'
    ],
    [
      'an operation key with something before the method',
      { operationSecurity: { 'xGET /a': [] } },
      'openapi.operationSecurity key number 1 must be "<METHOD> /path"'
    ],
    [
      'an operation key with a space in the path',
      { operationSecurity: { 'GET /a b': [] } },
      'openapi.operationSecurity key number 1 must be "<METHOD> /path"'
    ]
  ])('%s', (_name, openapi, message) => {
    expect(refusal(openapi)).toBe(message)
  })
})

describe('openapi schemes that the specification requires more of', () => {
  it.each([
    [
      'oauth2 with no flows',
      { type: 'oauth2' },
      'openapi.securitySchemes.a.flows must be an object, received undefined'
    ],
    [
      'oauth2 with flows that are a number',
      { type: 'oauth2', flows: 5 },
      'openapi.securitySchemes.a.flows must be an object, received 5'
    ],
    [
      'oauth2 with flows that are a list',
      { type: 'oauth2', flows: [] },
      'openapi.securitySchemes.a.flows must be an object, received an array'
    ],
    [
      'openIdConnect with no url',
      { type: 'openIdConnect' },
      'openapi.securitySchemes.a.openIdConnectUrl must be a non-empty string, received undefined'
    ],
    [
      'openIdConnect with an empty url',
      { type: 'openIdConnect', openIdConnectUrl: '' },
      'openapi.securitySchemes.a.openIdConnectUrl must be a non-empty string, received a string'
    ]
  ])('refuses %s', (_name, scheme, message) => {
    expect(refusal({ securitySchemes: { a: scheme } })).toBe(message)
  })

  it('accepts mutualTLS, which the specification gives no more fields', () => {
    expect(refusal({ securitySchemes: { a: { type: 'mutualTLS' } } })).toBeUndefined()
  })
})
