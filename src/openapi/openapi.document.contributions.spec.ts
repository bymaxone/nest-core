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
    ).document
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
    ).document

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
    ).document
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
    ).document

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
    ).document
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
      ).document

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
    ).document

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
    ).document

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
    ).document

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
    ).document

    expect(operation(result, '/auth/login', 'post')['summary']).toBe('Alpha')
  })
  /**
   * An empty placeholder does not count as a declaration.
   *
   * The peer emits `{"type":"object","properties":{}}` for every DTO in a
   * package built without its plugin, so the name is never actually missing and
   * a contributed schema under it would never be written. Filling one in is
   * additive: it constrains nothing before and describes a shape after.
   */
  it('fills a schema the document declares with no shape', () => {
    const theirs = { type: 'object', properties: { email: { type: 'string' } } }
    const result = augmentDocument(
      {
        ...withOperation('AuthController_login'),
        components: { schemas: { LoginDto: { type: 'object', properties: {} } } }
      },
      options(),
      [''],
      [contribution('AuthOpenApi', {}, { schemas: { LoginDto: theirs } })]
    )

    expect(components(result.document, 'schemas')['LoginDto']).toEqual(theirs)
    expect(result.discarded).toEqual([])
  })

  /**
   * A schema carrying properties is a real declaration and survives.
   *
   * The consumer authored it on purpose, and a library overwriting it is the
   * worse defect wearing the other sign. The collision is reported rather than
   * dropped in silence, which is the part neither side could otherwise observe.
   */
  it('keeps a schema that describes a shape and reports the discard', () => {
    const mine = { type: 'object', properties: { id: { type: 'string' } } }
    const result = augmentDocument(
      {
        ...withOperation('AuthController_login'),
        components: { schemas: { LoginDto: mine } }
      },
      options(),
      [''],
      [
        contribution(
          'AuthOpenApi',
          {},
          { schemas: { LoginDto: { type: 'object', properties: { email: { type: 'string' } } } } }
        )
      ]
    )

    expect(components(result.document, 'schemas')['LoginDto']).toBe(mine)
    expect(result.discarded).toEqual([
      { contributor: 'AuthOpenApi', member: 'schemas', name: 'LoginDto' }
    ])
  })

  /**
   * A non-object schema is complete without properties.
   *
   * `{"type":"string"}` carries no properties and is nonetheless a full
   * declaration. Reading "no properties" as "no shape" would discard it, which
   * is the failure this path exists to prevent, so the type is checked first.
   */
  it('keeps a primitive schema that declares no properties', () => {
    const mine = { type: 'string', format: 'uuid' }
    const result = augmentDocument(
      { ...withOperation('AuthController_login'), components: { schemas: { UserId: mine } } },
      options(),
      [''],
      [contribution('AuthOpenApi', {}, { schemas: { UserId: { type: 'object' } } })]
    )

    expect(components(result.document, 'schemas')['UserId']).toBe(mine)
    expect(result.discarded).toHaveLength(1)
  })

  /**
   * A bare `$ref` declares a shape by reference.
   *
   * It carries no properties, so a properties-only test would replace it —
   * discarding the reference and describing the name as something else.
   */
  it('keeps a schema that is a reference', () => {
    const mine = { $ref: '#/components/schemas/Other' }
    const result = augmentDocument(
      { ...withOperation('AuthController_login'), components: { schemas: { Alias: mine } } },
      options(),
      [''],
      [contribution('AuthOpenApi', {}, { schemas: { Alias: { type: 'object' } } })]
    )

    expect(components(result.document, 'schemas')['Alias']).toBe(mine)
    expect(result.discarded).toHaveLength(1)
  })

  /**
   * A description on a placeholder is the one part a consumer authored.
   *
   * The shape is filled from the contribution while the prose survives, the
   * same carve-out `mergeResponses` makes for the same reason.
   */
  it('keeps a description the document wrote on an otherwise empty schema', () => {
    const result = augmentDocument(
      {
        ...withOperation('AuthController_login'),
        components: {
          schemas: { LoginDto: { type: 'object', properties: {}, description: 'Ours' } }
        }
      },
      options(),
      [''],
      [
        contribution(
          'AuthOpenApi',
          {},
          {
            schemas: {
              LoginDto: {
                type: 'object',
                properties: { email: { type: 'string' } },
                description: 'Theirs'
              }
            }
          }
        )
      ]
    )

    expect(components(result.document, 'schemas')['LoginDto']).toEqual({
      type: 'object',
      properties: { email: { type: 'string' } },
      description: 'Ours'
    })
  })

  /**
   * A name the document never mentions still lands.
   *
   * The novel case is what already worked; it is asserted beside the collision
   * so a change that reported everything as discarded would fail here too.
   */
  it('places a contributed schema the document does not declare', () => {
    const theirs = { type: 'object', properties: { token: { type: 'string' } } }
    const result = augmentDocument(
      withOperation('AuthController_login'),
      options(),
      [''],
      [contribution('AuthOpenApi', {}, { schemas: { TokenDto: theirs } })]
    )

    expect(components(result.document, 'schemas')['TokenDto']).toEqual(theirs)
    expect(result.discarded).toEqual([])
  })

  /**
   * The report names which contributor lost, not only what was dropped.
   *
   * An application with several contributing libraries would otherwise be told
   * a name collided without being told whose entry it was.
   */
  it('names the contributor and member of every discarded entry', () => {
    const result = augmentDocument(
      {
        ...withOperation('AuthController_login'),
        components: {
          schemas: { Shared: { type: 'string' } },
          parameters: { Page: { name: 'page', in: 'query' } }
        }
      },
      options(),
      [''],
      [
        contribution('AlphaOpenApi', {}, { schemas: { Shared: { type: 'object' } } }),
        contribution('ZuluOpenApi', {}, { parameters: { Page: { name: 'p', in: 'query' } } })
      ]
    )

    expect(result.discarded).toEqual([
      { contributor: 'AlphaOpenApi', member: 'schemas', name: 'Shared' },
      { contributor: 'ZuluOpenApi', member: 'parameters', name: 'Page' }
    ])
  })
  /**
   * The placeholder carve-out never reaches a member that is not `schemas`.
   *
   * A parameter carries `name` and `in` rather than `properties`, so a
   * schema-shaped emptiness test reads every one of them as a placeholder and
   * lets a contributor overwrite one the consumer wrote — the precedence
   * failure inverted, arriving through the fix for the other one. Widening the
   * carve-out past `schemas` fails here rather than in a consumer's document.
   */
  it('never replaces a non-schema member that looks empty to a schema test', () => {
    const mine = { name: 'page', in: 'query' }
    const result = augmentDocument(
      {
        ...withOperation('AuthController_login'),
        components: { parameters: { Page: mine }, headers: { 'X-Trace': { schema: {} } } }
      },
      options(),
      [''],
      [
        contribution(
          'AuthOpenApi',
          {},
          {
            parameters: { Page: { name: 'p', in: 'header' } },
            headers: { 'X-Trace': { schema: { type: 'string' } } }
          }
        )
      ]
    )

    expect(components(result.document, 'parameters')['Page']).toBe(mine)
    expect(result.discarded).toEqual([
      { contributor: 'AuthOpenApi', member: 'parameters', name: 'Page' },
      { contributor: 'AuthOpenApi', member: 'headers', name: 'X-Trace' }
    ])
  })
  /**
   * A placeholder with no `type` is still a placeholder.
   *
   * A test that only ever supplies `type: 'object'` leaves the
   * `type !== undefined` half of the guard unexercised — the schema would then
   * read as typed-and-not-object and be kept, discarding the contribution.
   */
  it('fills a placeholder that omits its type', () => {
    const theirs = { type: 'object', properties: { email: { type: 'string' } } }
    const result = augmentDocument(
      {
        ...withOperation('AuthController_login'),
        components: { schemas: { LoginDto: { properties: {} } } }
      },
      options(),
      [''],
      [contribution('AuthOpenApi', {}, { schemas: { LoginDto: theirs } })]
    )

    expect(components(result.document, 'schemas')['LoginDto']).toEqual(theirs)
    expect(result.discarded).toEqual([])
  })

  /**
   * An unconstrained object or an empty schema is a deliberate declaration.
   *
   * `{"type":"object"}` is the OpenAPI idiom for "any JSON object" and `{}` for
   * "any value"; the peer never emits either, because it always writes
   * `properties` explicitly. Reading an absent `properties` as an empty one
   * would replace both — and, since the merge treats a placeholder as vacant,
   * replace them without reporting it, which is the observability gap this
   * release closes running in the other direction.
   */
  it.each([
    ['an unconstrained object', { type: 'object' }],
    ['an empty schema', {}]
  ])('keeps %s and reports the discard', (_label, mine) => {
    const result = augmentDocument(
      { ...withOperation('AuthController_login'), components: { schemas: { Metadata: mine } } },
      options(),
      [''],
      [
        contribution(
          'AuthOpenApi',
          {},
          { schemas: { Metadata: { type: 'object', properties: { id: { type: 'string' } } } } }
        )
      ]
    )

    expect(components(result.document, 'schemas')['Metadata']).toBe(mine)
    expect(result.discarded).toEqual([
      { contributor: 'AuthOpenApi', member: 'schemas', name: 'Metadata' }
    ])
  })

  /**
   * Every constraining keyword makes a schema a declaration, not just `$ref`.
   *
   * Each of these describes a shape while carrying no `properties`, so a test
   * that checks properties alone would replace them — discarding a real schema,
   * which is the failure this path exists to prevent. Enumerated one per
   * keyword so a keyword dropped from the list fails here by name.
   */
  it.each([
    ['allOf', { allOf: [{ type: 'object' }] }],
    ['oneOf', { oneOf: [{ type: 'string' }] }],
    ['anyOf', { anyOf: [{ type: 'string' }] }],
    ['enum', { enum: ['a', 'b'] }],
    ['items', { type: 'object', items: { type: 'string' } }],
    ['additionalProperties', { type: 'object', additionalProperties: { type: 'string' } }]
  ])('keeps a schema whose shape comes from %s', (_keyword, mine) => {
    const result = augmentDocument(
      { ...withOperation('AuthController_login'), components: { schemas: { Shape: mine } } },
      options(),
      [''],
      [contribution('AuthOpenApi', {}, { schemas: { Shape: { type: 'object' } } })]
    )

    expect(components(result.document, 'schemas')['Shape']).toBe(mine)
    expect(result.discarded).toHaveLength(1)
  })

  /**
   * A placeholder carrying no description takes the contributed one whole.
   *
   * The carve-out preserves prose the consumer wrote; where there is none it
   * must not write an explicit `undefined` over the contributed description,
   * which is what an unconditional merge would do.
   */
  it('takes the contributed description when the placeholder carries none', () => {
    const result = augmentDocument(
      {
        ...withOperation('AuthController_login'),
        components: { schemas: { LoginDto: { type: 'object', properties: {} } } }
      },
      options(),
      [''],
      [
        contribution(
          'AuthOpenApi',
          {},
          { schemas: { LoginDto: { type: 'object', properties: {}, description: 'Theirs' } } }
        )
      ]
    )

    expect(components(result.document, 'schemas')['LoginDto']).toEqual({
      type: 'object',
      properties: {},
      description: 'Theirs'
    })
  })

  /**
   * An empty description is no description.
   *
   * The peer writes one for a DTO with no doc comment, so treating it as prose
   * the consumer authored would pin every such schema to a blank description
   * and hide the contributed one.
   */
  it('replaces an empty description rather than preserving it', () => {
    const result = augmentDocument(
      {
        ...withOperation('AuthController_login'),
        components: { schemas: { LoginDto: { type: 'object', properties: {}, description: '' } } }
      },
      options(),
      [''],
      [
        contribution(
          'AuthOpenApi',
          {},
          { schemas: { LoginDto: { type: 'object', properties: {}, description: 'Theirs' } } }
        )
      ]
    )

    expect(components(result.document, 'schemas')['LoginDto']).toEqual({
      type: 'object',
      properties: {},
      description: 'Theirs'
    })
  })
  /**
   * A constraint without properties is still a contract.
   *
   * `required`, `minProperties`, `not` and `const` each describe validation an
   * application authored, while declaring no `properties` at all. Enumerating
   * the keywords that constrain is a list that goes stale as the vocabulary
   * grows, so the predicate allows only keys that describe nothing and treats
   * everything else as a declaration — including keywords it has never heard of.
   */
  it.each([
    ['required', { type: 'object', required: ['id'] }],
    ['minProperties', { type: 'object', minProperties: 1 }],
    ['maxProperties', { type: 'object', maxProperties: 4 }],
    ['not', { type: 'object', not: { type: 'string' } }],
    ['const', { type: 'object', const: { id: 'x' } }],
    ['patternProperties', { type: 'object', patternProperties: { '^x-': { type: 'string' } } }],
    ['a keyword this predicate does not model', { type: 'object', unevaluatedProperties: false }]
  ])('keeps a schema constrained only by %s', (_keyword, mine) => {
    const result = augmentDocument(
      { ...withOperation('AuthController_login'), components: { schemas: { Shape: mine } } },
      options(),
      [''],
      [contribution('AuthOpenApi', {}, { schemas: { Shape: { type: 'object' } } })]
    )

    expect(components(result.document, 'schemas')['Shape']).toBe(mine)
    expect(result.discarded).toHaveLength(1)
  })

  /**
   * An empty `required` list requires nothing, so it is still a placeholder.
   *
   * The peer emits it for a DTO whose members are all optional. Reading the
   * key's mere presence as a constraint would put every such schema back in the
   * case the carve-out exists to fix.
   */
  it('fills a placeholder whose required list is empty', () => {
    const theirs = { type: 'object', properties: { email: { type: 'string' } } }
    const result = augmentDocument(
      {
        ...withOperation('AuthController_login'),
        components: { schemas: { LoginDto: { type: 'object', properties: {}, required: [] } } }
      },
      options(),
      [''],
      [contribution('AuthOpenApi', {}, { schemas: { LoginDto: theirs } })]
    )

    expect(components(result.document, 'schemas')['LoginDto']).toEqual(theirs)
    expect(result.discarded).toEqual([])
  })

  /**
   * A key the merge would drop in silence is not ignorable.
   *
   * `description` is carried across, so an empty schema carrying one is still
   * fillable. `title` is not carried, so treating it as ignorable would delete
   * a consumer's title with no record — the same silence this release removes,
   * reintroduced by the predicate that removes it.
   */
  it('keeps a schema whose only content is a title', () => {
    const mine = { type: 'object', properties: {}, title: 'Login' }
    const result = augmentDocument(
      { ...withOperation('AuthController_login'), components: { schemas: { LoginDto: mine } } },
      options(),
      [''],
      [
        contribution(
          'AuthOpenApi',
          {},
          { schemas: { LoginDto: { type: 'object', properties: { email: { type: 'string' } } } } }
        )
      ]
    )

    expect(components(result.document, 'schemas')['LoginDto']).toBe(mine)
    expect(result.discarded).toHaveLength(1)
  })
})
