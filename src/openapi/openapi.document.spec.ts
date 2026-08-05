/**
 * Unit tests for document augmentation.
 *
 * Layer: unit.
 * Goal: prove the merge is additive and non-destructive — contributed entries
 * appear, a consumer's own entry of the same name always wins, the input
 * document is never mutated, and a malformed or absent `components` member
 * cannot make the merge throw.
 * Mocks: none; the optional peer is not involved, which is the point of keeping
 * this module pure.
 */
import { normalizeCoreOptions } from '../core.options'
import type { ResolvedOpenApiOptions } from '../core.options'
import { augmentDocument } from './openapi.document'
import { CORE_PARAMETERS, CORE_SCHEMAS } from './openapi.schemas'

/** Resolved OpenAPI options with the given overrides applied. */
function options(overrides: Partial<ResolvedOpenApiOptions> = {}): ResolvedOpenApiOptions {
  return { ...normalizeCoreOptions().openapi, ...overrides }
}

/** Read a nested member without assuming the specification's own types. */
function components(document: { components: Readonly<Record<string, unknown>> }, key: string) {
  return document.components[key] as Record<string, unknown>
}

describe('augmentDocument', () => {
  /**
   * The contributed catalogue reaches the document.
   *
   * With the default `includeCoreSchemas`, every schema and parameter this
   * package owns must appear under `components`, which is what makes an error
   * response or a paginated list describable by a consumer's operations.
   */
  it('contributes the core schemas and parameters', () => {
    const generated = { openapi: '3.0.0', components: {} }

    const result = augmentDocument(generated, options())

    expect(components(result, 'schemas')).toMatchObject(CORE_SCHEMAS)
    expect(components(result, 'parameters')).toMatchObject(CORE_PARAMETERS)
  })

  /**
   * The consumer's definition wins a name collision.
   *
   * A consumer who documents their own `BymaxErrorEnvelope` means it; silently
   * replacing it with this package's would be a surprise a documentation tool
   * must never spring.
   */
  it('keeps the consumer definition when a name collides', () => {
    const mine = { type: 'object', description: 'my own envelope' }

    const result = augmentDocument(
      { components: { schemas: { BymaxErrorEnvelope: mine } } },
      options()
    )

    expect(components(result, 'schemas')['BymaxErrorEnvelope']).toBe(mine)
    expect(components(result, 'schemas')['BymaxHealthResponse']).toBeDefined()
  })

  /**
   * An existing parameter definition survives the merge.
   *
   * Parameters follow the same non-destructive rule as schemas, and they are
   * read from a different member of `components`: a merge that read the wrong
   * member would still contribute this package's parameters correctly while
   * silently dropping every parameter the document already had.
   */
  it('keeps parameters the document already defines', () => {
    const existing = { InvoiceId: { name: 'invoiceId', in: 'path', required: true } }

    const result = augmentDocument({ components: { parameters: existing } }, options())

    expect(components(result, 'parameters')['InvoiceId']).toEqual(existing.InvoiceId)
    expect(components(result, 'parameters')['BymaxPageQueryPage']).toBeDefined()
  })

  /**
   * Opting out contributes nothing.
   *
   * With `includeCoreSchemas` false, the document must be left exactly as
   * generated, so a consumer who documents these shapes themselves gets no
   * duplicate entries.
   */
  it('contributes no schemas when includeCoreSchemas is false', () => {
    const result = augmentDocument(
      { components: { schemas: { Invoice: { type: 'object' } } } },
      options({ includeCoreSchemas: false })
    )

    expect(components(result, 'schemas')).toEqual({ Invoice: { type: 'object' } })
    expect(result.components).not.toHaveProperty('parameters')
  })

  /**
   * Security schemes are copied only when declared.
   *
   * An empty map must not create an empty `securitySchemes` member, because a
   * document that declares the key with nothing in it reads as "authentication
   * was considered and there is none".
   */
  it('omits securitySchemes when none are configured', () => {
    const result = augmentDocument({}, options())

    expect(result.components).not.toHaveProperty('securitySchemes')
  })

  /**
   * Declared security schemes reach the document.
   *
   * This is the consumer's own contribution channel, and it follows the same
   * non-destructive rule as the package's own entries.
   */
  it('copies declared security schemes and keeps existing ones', () => {
    const existing = { legacy: { type: 'apiKey' } }

    const result = augmentDocument(
      { components: { securitySchemes: existing } },
      options({ securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } })
    )

    expect(components(result, 'securitySchemes')).toEqual({
      legacy: { type: 'apiKey' },
      bearer: { type: 'http', scheme: 'bearer' }
    })
  })

  /**
   * The input document is never mutated.
   *
   * The caller keeps the document the peer generated; augmentation returns a
   * new one so a retry or a second mount cannot accumulate state.
   */
  it('returns a new document and leaves the input untouched', () => {
    const input = { openapi: '3.0.0', components: { schemas: {} } }

    const result = augmentDocument(input, options())

    expect(result).not.toBe(input)
    expect(input.components.schemas).toEqual({})
    expect(result.openapi).toBe('3.0.0')
  })

  /**
   * A document with no components at all. Edge case.
   *
   * The peer always emits a `components` object, but the merge must be total:
   * an absent member yields the contributed catalogue rather than a crash at
   * bootstrap, when the application is already half-started.
   */
  it('creates components when the document has none', () => {
    const result = augmentDocument({}, options())

    expect(Object.keys(components(result, 'schemas'))).toEqual(Object.keys(CORE_SCHEMAS))
  })

  /**
   * A malformed components member. Edge case: wrong type.
   *
   * Nothing enforces the shape of a document handed to this function, and a
   * null, array, or primitive member must degrade to "no existing entries"
   * rather than throw.
   */
  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'nope']
  ])('tolerates a components member that is %s', (_label, value) => {
    const result = augmentDocument({ components: value }, options())

    expect(Object.keys(components(result, 'schemas'))).toEqual(Object.keys(CORE_SCHEMAS))
  })
})
