/**
 * Unit tests for the contributed OpenAPI schema catalogue.
 *
 * Layer: unit.
 * Goal: prove the catalogue describes the contracts this package actually
 * serves — the error envelope, the health response, the pagination shapes — and
 * that the error-code enum is derived from the exported constants rather than
 * retyped, so a code added to the catalogue cannot silently go undocumented.
 * Mocks: none (static data).
 */
import * as errorCodes from '../envelope/error-codes'
import { CORE_PARAMETERS, CORE_SCHEMAS } from './openapi.schemas'

/** Read a nested member without assuming the specification's own types. */
function member(source: Record<string, unknown>, ...path: readonly string[]): unknown {
  let current: unknown = source
  for (const key of path) {
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/** One node of the catalogue, paired with the path that reaches it. */
type CatalogueNode = readonly [path: string, node: Record<string, unknown>]

/**
 * Collect every object node in a catalogue, depth-first, so the invariants below
 * can be asserted over the whole tree rather than over a hand-picked sample.
 * Asserting the tree is what makes these tests describe rules — "no schema is
 * untyped", "no `$ref` dangles" — instead of restating the data.
 */
function collectNodes(value: unknown, path: string, into: CatalogueNode[]): void {
  if (typeof value !== 'object' || value === null) {
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectNodes(entry, `${path}[${index}]`, into))
    return
  }
  const node = value as Record<string, unknown>
  into.push([path, node])
  for (const [key, child] of Object.entries(node)) {
    collectNodes(child, `${path}.${key}`, into)
  }
}

/** Every object node across both contributed catalogues. */
const ALL_NODES: CatalogueNode[] = []
collectNodes(CORE_SCHEMAS, 'schemas', ALL_NODES)
collectNodes(CORE_PARAMETERS, 'parameters', ALL_NODES)

/** The nodes declaring `key`, as `[path, value]` pairs. */
function nodesDeclaring(key: string): ReadonlyArray<readonly [string, unknown]> {
  return ALL_NODES.filter(([, node]) => key in node).map(([path, node]) => [path, node[key]])
}

describe('CORE_SCHEMAS', () => {
  /**
   * The catalogue covers every contract the package serves.
   *
   * A missing entry is a silent documentation gap: the endpoint still works,
   * but its response shape is undescribed, which is the failure this feature
   * exists to prevent.
   */
  it('describes the envelope, health, and pagination contracts', () => {
    expect(Object.keys(CORE_SCHEMAS).sort()).toEqual([
      'BymaxCursorResult',
      'BymaxErrorCode',
      'BymaxErrorDetails',
      'BymaxErrorEnvelope',
      'BymaxHealthCheckEntry',
      'BymaxHealthResponse',
      'BymaxPageMeta',
      'BymaxPageResult'
    ])
  })

  /**
   * The error-code enum is derived, not retyped.
   *
   * Every `BYMAX_*` constant the package exports must appear in the documented
   * enum. This is the assertion that fails when someone adds a code to the
   * catalogue and forgets the documentation.
   */
  it('lists every exported BYMAX_* error code', () => {
    const exported = Object.entries(errorCodes)
      .filter(([name, value]) => name.startsWith('BYMAX_') && typeof value === 'string')
      .map(([, value]) => value)
      .sort()

    const documented = [...(member(CORE_SCHEMAS, 'BymaxErrorCode', 'enum') as string[])].sort()

    expect(documented).toEqual(exported)
    expect(documented.length).toBeGreaterThan(0)
  })

  /**
   * The envelope's always-present fields are required.
   *
   * The envelope contract states which fields are always present; the schema
   * must mark exactly those as required, and must not require the two that are
   * conditional (`details`, `correlationId`).
   */
  it('requires exactly the envelope fields that are always present', () => {
    expect(member(CORE_SCHEMAS, 'BymaxErrorEnvelope', 'required')).toEqual([
      'statusCode',
      'code',
      'message',
      'timestamp',
      'path'
    ])
  })

  /**
   * The readiness response references the entry schema by name.
   *
   * A `$ref` rather than an inlined copy is what makes the entry shape appear
   * once in the document and stay consistent wherever it is used.
   */
  it('references the check-entry schema from the health response', () => {
    expect(member(CORE_SCHEMAS, 'BymaxHealthResponse', 'properties', 'checks', 'items')).toEqual({
      $ref: '#/components/schemas/BymaxHealthCheckEntry'
    })
  })

  /**
   * Cursor exhaustion is expressible. Edge case: last page.
   *
   * `nextCursor` is null on the last page, and the 3.0 dialect expresses that
   * with `nullable` rather than a union type; without it, a generated client
   * would reject the final page of every cursor-paginated list.
   */
  it('marks nextCursor as nullable', () => {
    expect(member(CORE_SCHEMAS, 'BymaxCursorResult', 'properties', 'nextCursor')).toMatchObject({
      type: 'string',
      nullable: true
    })
  })
})

describe('catalogue invariants', () => {
  /**
   * Nothing in the catalogue is untyped or unlabelled.
   *
   * A document is only useful if every node it publishes carries meaning: an
   * empty `type`, `description`, `format`, `name`, `in` or `example` is not a
   * cosmetic slip, it is a field that reaches a consumer's generated client and
   * their generated documentation as a blank.
   */
  it.each(['type', 'description', 'format', 'name', 'in', 'example', '$ref'])(
    'declares a non-empty value wherever it declares "%s"',
    (key) => {
      const declarations = nodesDeclaring(key)

      expect(declarations.length).toBeGreaterThan(0)
      for (const [path, value] of declarations) {
        expect(typeof value === 'string' ? value.trim() : value).not.toBe('')
        expect(`${path}: ${String(value)}`).not.toMatch(/: (undefined|null)$/)
      }
    }
  )

  /**
   * Every `$ref` resolves inside the contributed catalogue.
   *
   * A dangling reference produces a document that fails validation in every
   * OpenAPI tool a consumer might run, and the failure surfaces in their
   * repository rather than in this one.
   */
  it('references only schemas the catalogue defines', () => {
    const refs = nodesDeclaring('$ref').map(([, value]) => String(value))

    expect(refs.length).toBeGreaterThan(0)
    for (const ref of refs) {
      expect(ref.startsWith('#/components/schemas/')).toBe(true)
      expect(Object.keys(CORE_SCHEMAS)).toContain(ref.replace('#/components/schemas/', ''))
    }
  })

  /**
   * Every required field is a field the schema actually declares.
   *
   * `required` naming a property that does not exist in `properties` is the
   * classic hand-edited-schema defect: generators emit a mandatory field with no
   * type, and validators reject payloads that are in fact correct.
   */
  it('requires only properties it declares', () => {
    const requirements = nodesDeclaring('required').filter(([, value]) => Array.isArray(value))

    expect(requirements.length).toBeGreaterThan(0)
    for (const [path, value] of requirements) {
      const owner = ALL_NODES.find(([nodePath]) => nodePath === path)?.[1] ?? {}
      const properties = Object.keys((owner['properties'] ?? {}) as Record<string, unknown>)
      const required = value as readonly string[]

      expect(required.length).toBeGreaterThan(0)
      for (const field of required) {
        expect(properties).toContain(field)
      }
    }
  })

  /**
   * Every object schema declares at least one property.
   *
   * An object schema with an emptied `properties` map still validates as a
   * schema and still renders in the UI — as an object with no fields, silently
   * describing nothing.
   */
  it('declares properties on every object schema', () => {
    const objects = ALL_NODES.filter(
      ([, node]) => node['type'] === 'object' && 'properties' in node
    )

    expect(objects.length).toBeGreaterThan(0)
    for (const [, node] of objects) {
      expect(Object.keys(node['properties'] as Record<string, unknown>).length).toBeGreaterThan(0)
    }
  })

  /**
   * Every enumeration lists usable values.
   *
   * An emptied `enum` accepts nothing, so a client generated from the document
   * cannot express any valid value for that field; an enum carrying a blank
   * member is worse, because it validates and means nothing.
   */
  it('lists non-empty values in every enum', () => {
    const enums = nodesDeclaring('enum')

    expect(enums.length).toBeGreaterThan(0)
    for (const [, value] of enums) {
      expect(Array.isArray(value)).toBe(true)
      const values = value as readonly unknown[]
      expect(values.length).toBeGreaterThan(0)
      for (const entry of values) {
        expect(entry).not.toBe('')
      }
    }
  })

  /**
   * Every published schema is a schema, not an empty object.
   *
   * A top-level entry emptied to `{}` still appears in the document under its
   * name, so a consumer sees the schema listed and referenced while it describes
   * nothing at all — the failure mode a reader is least likely to notice.
   */
  it('gives every published schema a type or a variant list, and a description', () => {
    for (const [name, schema] of Object.entries(CORE_SCHEMAS)) {
      expect(`${name}: ${typeof schema['type']}/${typeof schema['oneOf']}`).not.toBe(
        `${name}: undefined/undefined`
      )
      expect(schema['description']).toEqual(expect.any(String))
      expect(schema['description']).not.toBe('')
    }
  })

  /**
   * Every property of every object schema is typed.
   *
   * A property emptied to `{}` is untyped: generators emit `unknown`/`any` for
   * it and validators accept anything, silently widening the contract this
   * package publishes.
   */
  it('types every property of every object schema', () => {
    const propertyMaps = nodesDeclaring('properties')

    expect(propertyMaps.length).toBeGreaterThan(0)
    for (const [path, map] of propertyMaps) {
      for (const [field, schema] of Object.entries(map as Record<string, unknown>)) {
        const property = schema as Record<string, unknown>
        const described =
          property['type'] !== undefined ||
          property['$ref'] !== undefined ||
          property['oneOf'] !== undefined

        expect(`${path}.${field} typed: ${String(described)}`).toBe(`${path}.${field} typed: true`)
      }
    }
  })

  /**
   * Every variant list offers typed alternatives.
   *
   * `oneOf` is how this catalogue expresses "either of these shapes"; emptied,
   * it matches nothing, and with an emptied variant it matches everything.
   */
  it('lists typed variants in every oneOf', () => {
    const variantLists = nodesDeclaring('oneOf')

    expect(variantLists.length).toBeGreaterThan(0)
    for (const [, value] of variantLists) {
      const variants = value as ReadonlyArray<Record<string, unknown>>
      expect(variants.length).toBeGreaterThan(0)
      for (const variant of variants) {
        expect(variant['type'] ?? variant['$ref']).toEqual(expect.any(String))
      }
    }
  })

  /**
   * The health status vocabularies match the served contract exactly.
   *
   * These two enums mirror the `HealthResponse` union types this package serves
   * at runtime. They are pinned by value, not by shape, because a document that
   * advertises a status the endpoint never returns — or omits one it does — is
   * wrong in a way no structural rule can catch.
   */
  it('publishes exactly the health status values the endpoints return', () => {
    expect(member(CORE_SCHEMAS, 'BymaxHealthCheckEntry', 'properties', 'status', 'enum')).toEqual([
      'up',
      'down'
    ])
    expect(member(CORE_SCHEMAS, 'BymaxHealthResponse', 'properties', 'status', 'enum')).toEqual([
      'ok',
      'error'
    ])
  })

  /**
   * The free-form detail carriers stay open. Edge case: closed by mistake.
   *
   * `BymaxErrorDetails` and a health check's `details` exist precisely to carry
   * shapes this package cannot predict. Flipping them closed would make every
   * real payload fail validation in a strict consumer.
   */
  it('keeps the free-form detail schemas open to additional properties', () => {
    const open = nodesDeclaring('additionalProperties')

    expect(open.length).toBeGreaterThan(0)
    for (const [, value] of open) {
      expect(value).toBe(true)
    }
  })
})

describe('CORE_PARAMETERS', () => {
  /**
   * The pagination query parameters are contributed by name.
   *
   * They are referenced from operations with a `$ref`, so the names are part of
   * the contract and cannot drift.
   */
  it('describes the offset and cursor query parameters', () => {
    expect(Object.keys(CORE_PARAMETERS).sort()).toEqual([
      'BymaxCursorQueryCursor',
      'BymaxPageQueryLimit',
      'BymaxPageQueryPage'
    ])
  })

  /**
   * Every parameter is an optional query parameter.
   *
   * All three are clamped rather than validated, so declaring any of them
   * required would document a rejection the application never performs.
   */
  it('declares every parameter as an optional query parameter', () => {
    for (const parameter of Object.values(CORE_PARAMETERS)) {
      expect(parameter).toMatchObject({ in: 'query', required: false })
    }
  })

  /**
   * Every parameter carries a typed schema.
   *
   * A parameter whose `schema` is emptied still appears in the document and in
   * the UI, as an input with no type: a generated client cannot serialize it,
   * and a reader cannot tell what to send.
   */
  it('gives every parameter a typed schema', () => {
    for (const [name, parameter] of Object.entries(CORE_PARAMETERS)) {
      const schema = (parameter['schema'] ?? {}) as Record<string, unknown>

      expect(`${name}: ${String(schema['type'])}`).not.toMatch(/: undefined$/)
      expect(schema['type']).not.toBe('')
    }
  })

  /**
   * The limit parameter documents the default and declares no maximum.
   *
   * The upper bound is per-call configurable by the consumer, so publishing a
   * fixed `maximum` would describe a rule the application may not enforce.
   */
  it('documents the limit default without asserting a maximum', () => {
    const schema = member(CORE_PARAMETERS, 'BymaxPageQueryLimit', 'schema') as Record<
      string,
      unknown
    >

    expect(schema).toMatchObject({ type: 'integer', minimum: 1, default: 20 })
    expect(schema).not.toHaveProperty('maximum')
  })
})
