/**
 * Unit tests for document augmentation.
 *
 * Layer: unit.
 * Goal: prove a library's fragments reach the operations its handlers produced,
 * that precedence holds at every edge — document over consumer over library —
 * and that two contributors colliding resolve by a stated order rather than by
 * the container's traversal.
 * Mocks: none; the optional peer is not involved, which is the point of keeping
 * this module pure.
 */
import type { ResolvedContribution } from './openapi.contribution'
import { augmentDocument } from './openapi.document'
import { components, generated, operation, options, SCHEMES } from './__tests__/document.fixtures'

describe('augmentDocument — library contributions', () => {
  /** A contribution as `collectContributions` would have resolved it. */
  function contribution(
    label: string,
    operations: Record<string, Record<string, unknown>> = {},
    components: Record<string, Record<string, Record<string, unknown>>> = {}
  ): ResolvedContribution {
    return { label, operations, components }
  }

  /** A document whose single operation carries the given id. */
  function withOperation(id: string, operation: Record<string, unknown> = {}) {
    return generated({ '/auth/login': { post: { operationId: id, ...operation } } })
  }

  /**
   * A fragment reaches the operation its handler produced.
   *
   * The whole lane in one assertion: a library addresses a handler, the scan
   * named the operation, and the fragment lands on it without either side
   * reconstructing a path.
   */
  it('applies a fragment to the operation carrying its id', () => {
    const result = augmentDocument(
      withOperation('AuthController_login'),
      options(),
      [''],
      [contribution('AuthOpenApi', { AuthController_login: { summary: 'Sign in', security: [] } })]
    )
    const login = operation(result, '/auth/login', 'post')

    expect(login['summary']).toBe('Sign in')
    expect(login['security']).toEqual([])
  })

  /**
   * The document outranks the library.
   *
   * A consumer who decorated their handler said something deliberate about it,
   * and a library shipping the same member must not overwrite it — that
   * precedence is what makes the lane safe to adopt.
   */
  it('keeps a member the operation already declares', () => {
    const result = augmentDocument(
      withOperation('AuthController_login', { summary: 'Mine' }),
      options(),
      [''],
      [contribution('AuthOpenApi', { AuthController_login: { summary: 'Theirs' } })]
    )

    expect(operation(result, '/auth/login', 'post')['summary']).toBe('Mine')
  })

  /**
   * Contributed responses go through the shape-aware rule.
   *
   * A library filling in the peer's placeholder is additive; one overwriting a
   * response that declares content is not. Reusing the rule rather than writing
   * a second one is what keeps the two lanes consistent.
   */
  it('merges contributed responses by shape rather than by presence', () => {
    const mine = { description: 'mine', content: { 'application/json': { schema: {} } } }
    const result = augmentDocument(
      withOperation('AuthController_login', {
        responses: { 200: { description: '' }, 409: mine }
      }),
      options(),
      [''],
      [
        contribution('AuthOpenApi', {
          AuthController_login: {
            responses: {
              200: { description: 'Signed in', content: { 'application/json': { schema: {} } } },
              409: { description: 'theirs', content: { 'application/json': { schema: {} } } }
            }
          }
        })
      ]
    )
    const responses = operation(result, '/auth/login', 'post')['responses'] as Record<
      string,
      Record<string, unknown>
    >

    expect(responses['200']?.['description']).toBe('Signed in')
    expect(responses['409']).toBe(mine)
  })

  /**
   * An operation with no id receives nothing. Edge case.
   *
   * `operationId` is optional in the specification, and a document assembled by
   * hand may omit it. Reading a fragment map with a non-string key would be a
   * lookup on a value this package did not produce.
   */
  it('leaves an operation without an id alone', () => {
    const result = augmentDocument(
      generated({ '/auth/login': { post: {} } }),
      options(),
      [''],
      [contribution('AuthOpenApi', { AuthController_login: { summary: 'Sign in' } })]
    )

    expect(operation(result, '/auth/login', 'post')).not.toHaveProperty('summary')
  })

  /**
   * Contributed components land beneath what the document defines.
   *
   * Same non-destructive rule as everywhere else, applied to a source the
   * consumer did not write, which is precisely when it matters most.
   */
  it('merges contributed components and keeps existing definitions', () => {
    const mine = { type: 'apiKey', in: 'header', name: 'X-Mine' }
    const result = augmentDocument(
      {
        ...withOperation('AuthController_login'),
        components: { securitySchemes: { shared: mine } }
      },
      options(),
      [''],
      [
        contribution(
          'AuthOpenApi',
          {},
          {
            securitySchemes: {
              shared: { type: 'apiKey', in: 'cookie', name: 'theirs' },
              authCookie: { type: 'apiKey', in: 'cookie', name: 'access' }
            }
          }
        )
      ]
    )
    const schemes = components(result, 'securitySchemes')

    expect(schemes['shared']).toBe(mine)
    expect(schemes['authCookie']).toEqual({ type: 'apiKey', in: 'cookie', name: 'access' })
  })

  /**
   * A requirement may name a scheme a library supplied.
   *
   * Validating before the contributed components landed would reject a consumer
   * for naming a scheme their own library provides — the arrangement this lane
   * exists to enable, failing on the lane itself.
   */
  it('accepts a document requirement naming a contributed scheme', () => {
    const build = () =>
      augmentDocument(
        withOperation('AuthController_login'),
        options({ security: [{ authCookie: [] }] }),
        [''],
        [
          contribution(
            'AuthOpenApi',
            {},
            { securitySchemes: { authCookie: { type: 'apiKey', in: 'cookie', name: 'access' } } }
          )
        ]
      )

    expect(build).not.toThrow()
  })

  /**
   * A fragment reaches its operation and no other.
   *
   * The id is the whole address. A merge that ignored it would apply every
   * library's description to every operation in the document — the loudest
   * possible way to be wrong, and one a single-operation fixture cannot see.
   */
  it('applies a fragment only to the operation it names', () => {
    const result = augmentDocument(
      generated({
        '/auth/login': { post: { operationId: 'AuthController_login' } },
        '/auth/logout': { post: { operationId: 'AuthController_logout' } }
      }),
      options(),
      [''],
      [contribution('AuthOpenApi', { AuthController_login: { summary: 'Sign in' } })]
    )

    expect(operation(result, '/auth/login', 'post')['summary']).toBe('Sign in')
    expect(operation(result, '/auth/logout', 'post')).not.toHaveProperty('summary')
  })

  /**
   * A fragment with no responses adds no responses member.
   *
   * Writing an empty one would put a member on an operation that documents
   * nothing, and `responses` is the one place a reader expects meaning.
   */
  it('adds no responses member for a fragment that carries none', () => {
    const result = augmentDocument(
      generated({ '/auth/login': { post: { operationId: 'AuthController_login' } } }),
      options({ includeCoreSchemas: false }),
      [''],
      [contribution('AuthOpenApi', { AuthController_login: { summary: 'Sign in' } })]
    )

    expect(operation(result, '/auth/login', 'post')).not.toHaveProperty('responses')
  })

  /**
   * A library describing one of this package's own routes outranks its policy.
   *
   * The precedence is derived < library < consumer, so what this package infers
   * about its own health probe is the weakest claim in the document: a library
   * that says something specific about that operation knows more than a default
   * does. Unusual, but the rule has to hold at its edge or it is not a rule.
   */
  it('lets a library override this package own-route policy', () => {
    const result = augmentDocument(
      generated({ '/health/live': { get: { operationId: 'HealthController_live' } } }),
      options({ security: [{ cookieAuth: [] }], securitySchemes: SCHEMES }),
      [''],
      [contribution('ProbeOpenApi', { HealthController_live: { security: [{ cookieAuth: [] }] } })]
    )

    expect(operation(result, '/health/live')['security']).toEqual([{ cookieAuth: [] }])
  })

  /**
   * Earlier contributors win over later ones.
   *
   * Two libraries describing the same operation resolve by the stable order the
   * collector imposes; without a rule the answer would depend on the container.
   */
  it('keeps the first contributor member when two collide', () => {
    const result = augmentDocument(
      withOperation('AuthController_login'),
      options(),
      [''],
      [
        contribution('AlphaOpenApi', { AuthController_login: { summary: 'Alpha' } }),
        contribution('ZuluOpenApi', { AuthController_login: { summary: 'Zulu' } })
      ]
    )

    expect(operation(result, '/auth/login', 'post')['summary']).toBe('Alpha')
  })
})
