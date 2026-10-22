/**
 * Unit tests for component placement during document augmentation.
 *
 * Layer: unit.
 * Goal: prove that a contributed component lands beneath whatever already holds
 * its name, that a name held only by the peer's empty placeholder is filled
 * rather than defended, that the placeholder test admits nothing that carries a
 * shape, and that every entry the existing side kept is reported with its
 * contributor and member.
 * Mocks: none; the optional peer is not involved.
 */
import type { ResolvedContribution } from './openapi.contribution'
import { augmentDocument } from './openapi.document'
import { CORE_SCHEMAS } from './openapi.schemas'
import { components, generated, options } from './__tests__/document.fixtures'

describe('augmentDocument — component placement', () => {
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
   * Asserted beside the collision cases so that a merge reporting every
   * contributed entry as discarded fails here too.
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
   * replace them without reporting it.
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
   * The predicate's later checks hold on an entry that passes its early ones.
   *
   * Every case carries an empty `properties`, which is what the peer emits and
   * what gets an entry past the presence check — so these reach the `type` and
   * `required` tests that a schema without `properties` never does. A
   * non-empty `required` is a constraint; an empty array under any other key is
   * a keyword the predicate does not know, not an empty `required`; and a
   * primitive `type` is a declaration whatever else it carries.
   */
  it.each([
    ['a non-empty required list', { type: 'object', properties: {}, required: ['id'] }],
    ['an empty array under another keyword', { type: 'object', properties: {}, enum: [] }],
    ['a primitive type', { type: 'string', properties: {} }]
  ])('keeps a placeholder-shaped schema carrying %s', (_label, mine) => {
    const result = augmentDocument(
      { ...withOperation('AuthController_login'), components: { schemas: { Shape: mine } } },
      options(),
      [''],
      [
        contribution(
          'AuthOpenApi',
          {},
          { schemas: { Shape: { type: 'object', properties: { id: { type: 'string' } } } } }
        )
      ]
    )

    expect(components(result.document, 'schemas')['Shape']).toBe(mine)
    expect(result.discarded).toEqual([
      { contributor: 'AuthOpenApi', member: 'schemas', name: 'Shape' }
    ])
  })

  /**
   * A `properties` that is not an object is not an empty one.
   *
   * The placeholder is `properties: {}`. A `null`, an array or a scalar there
   * is a malformed schema the document authored, not the peer's placeholder,
   * and unmodelled input counts as a declaration — so it is kept and reported
   * rather than overwritten in silence.
   */
  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'none']
  ])('keeps a schema whose properties is %s', (_label, properties) => {
    const mine = { type: 'object', properties }
    const result = augmentDocument(
      { ...withOperation('AuthController_login'), components: { schemas: { Shape: mine } } },
      options(),
      [''],
      [
        contribution(
          'AuthOpenApi',
          {},
          { schemas: { Shape: { type: 'object', properties: { id: { type: 'string' } } } } }
        )
      ]
    )

    expect(components(result.document, 'schemas')['Shape']).toBe(mine)
    expect(result.discarded).toEqual([
      { contributor: 'AuthOpenApi', member: 'schemas', name: 'Shape' }
    ])
  })

  /**
   * A contributed member that holds no entries contributes nothing.
   *
   * A JavaScript contributor, or one assembling its fragment from JSON, can
   * hand over a member whose value is `null` or a scalar. That member carries
   * no entries; it must not stop the boot, and the members beside it still
   * merge.
   */
  it('ignores a contributed member that is not an object and merges the rest', () => {
    const theirs = { type: 'object', properties: { id: { type: 'string' } } }
    const malformed: Record<string, Record<string, Record<string, unknown>>> = JSON.parse(
      '{"parameters": null, "headers": 5, "responses": []}'
    )
    const result = augmentDocument(
      withOperation('AuthController_login'),
      options(),
      [''],
      [contribution('AuthOpenApi', {}, { ...malformed, schemas: { Session: theirs } })]
    )
    const wellFormed = augmentDocument(
      withOperation('AuthController_login'),
      options(),
      [''],
      [contribution('AuthOpenApi', {}, { schemas: { Session: theirs } })]
    )

    expect(components(result.document, 'schemas')['Session']).toEqual(theirs)
    expect(components(result.document, 'parameters')).toEqual(
      components(wellFormed.document, 'parameters')
    )
    expect(result.discarded).toEqual([])
  })

  /**
   * The placeholder rule belongs to `schemas` alone.
   *
   * An entry in another member that happens to look exactly like the peer's
   * placeholder is still that member's own declaration, and is kept.
   */
  it('keeps a placeholder-shaped entry outside schemas', () => {
    const mine = { type: 'object', properties: {} }
    const result = augmentDocument(
      { ...withOperation('AuthController_login'), components: { requestBodies: { Login: mine } } },
      options(),
      [''],
      [
        contribution(
          'AuthOpenApi',
          {},
          { requestBodies: { Login: { content: { 'application/json': { schema: {} } } } } }
        )
      ]
    )

    expect(components(result.document, 'requestBodies')['Login']).toBe(mine)
    expect(result.discarded).toEqual([
      { contributor: 'AuthOpenApi', member: 'requestBodies', name: 'Login' }
    ])
  })

  /**
   * A key the merge would drop in silence is not ignorable.
   *
   * `description` is carried across, so an empty schema carrying one is still
   * fillable. `title` is not carried, so treating it as ignorable would delete
   * a consumer's title with no record.
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

  /**
   * The package's catalogue outranks a library, placeholder or not.
   *
   * The precedence is document over this package over a library. A name the
   * document holds only as the peer's placeholder is not a declaration, so the
   * catalogue fills it — and a library offering the same name afterwards meets
   * the package's definition and is reported, rather than slipping in through
   * the placeholder the catalogue was kept out of.
   */
  it('fills a placeholder under a catalogue name from the catalogue, not the library', () => {
    const result = augmentDocument(
      {
        ...withOperation('AuthController_login'),
        components: { schemas: { BymaxErrorEnvelope: { type: 'object', properties: {} } } }
      },
      options(),
      [''],
      [contribution('AuthOpenApi', {}, { schemas: { BymaxErrorEnvelope: { type: 'string' } } })]
    )

    expect(components(result.document, 'schemas')['BymaxErrorEnvelope']).toEqual(
      CORE_SCHEMAS['BymaxErrorEnvelope']
    )
    expect(result.discarded).toEqual([
      { contributor: 'AuthOpenApi', member: 'schemas', name: 'BymaxErrorEnvelope' }
    ])
  })

  /**
   * A catalogue name the document declared with a shape stays the document's.
   *
   * Filling placeholders from the catalogue must not turn into the catalogue
   * overwriting a consumer's own definition under the same name.
   */
  it('keeps a document definition under a catalogue name', () => {
    const mine = { type: 'object', properties: { code: { type: 'string' } } }
    const result = augmentDocument(
      {
        ...withOperation('AuthController_login'),
        components: { schemas: { BymaxErrorEnvelope: mine } }
      },
      options(),
      [''],
      []
    )

    expect(components(result.document, 'schemas')['BymaxErrorEnvelope']).toBe(mine)
    expect(result.discarded).toEqual([])
  })
})
