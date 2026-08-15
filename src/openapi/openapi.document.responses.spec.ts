/**
 * Unit tests for document augmentation.
 *
 * Layer: unit.
 * Goal: prove the responses this package can describe reference the schemas it
 * contributed, and that the shape-aware merge fills in the peer's placeholder
 * without ever overwriting a response that declares content of its own.
 * Mocks: none; the optional peer is not involved, which is the point of keeping
 * this module pure.
 */
import { normalizeCoreOptions } from '../core.options'
import type { ResolvedCoreOptions } from '../core.options'
import { augmentDocument } from './openapi.document'
import { generated, health, operation, options, OWN_ROUTES } from './__tests__/document.fixtures'

describe('augmentDocument — responses', () => {
  /**
   * Every operation gains the error envelope as its default response.
   *
   * Every error path in this package answers with the envelope, so it is
   * attached as `default` rather than guessed per status: this package knows
   * what an error looks like and does not know which statuses a consumer's
   * handler can produce.
   */
  it('attaches the error envelope to every operation, whatever its method', () => {
    const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']
    const item = Object.fromEntries(methods.map((method) => [method, {}]))

    const result = augmentDocument(
      generated({ '/invoices': item }),
      options({}, { health: health({ enabled: false }) })
    )

    for (const method of methods) {
      const responses = operation(result, '/invoices', method)['responses'] as Record<
        string,
        Record<string, unknown>
      >
      expect(responses['default']).toEqual({
        description: 'Error envelope returned by every failing request.',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/BymaxErrorEnvelope' } }
        }
      })
      // The health payload belongs to the health endpoints alone; contributing
      // it everywhere would document an invoice list as a health report.
      expect(responses).not.toHaveProperty('200')
    }
  })

  /**
   * The health endpoints document the payload they return.
   *
   * This package registered them, so unlike a consumer's operation it knows the
   * success shape precisely.
   */
  it('attaches the health response to the health operations', () => {
    const result = augmentDocument(generated({ ...OWN_ROUTES }), options())
    const responses = operation(result, '/health/ready')['responses'] as Record<string, unknown>

    expect(responses['200']).toMatchObject({
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/BymaxHealthResponse' } }
      }
    })
  })

  /**
   * A response that declares a shape survives untouched.
   *
   * Carrying `content` is what makes a response a real declaration rather than
   * the peer's placeholder, and a consumer who wrote one means it.
   */
  it('keeps a response that already declares content', () => {
    const mine = {
      description: 'my own error',
      content: { 'application/json': { schema: { type: 'object' } } }
    }

    const result = augmentDocument(
      generated({ '/invoices': { get: { responses: { default: mine } } } }),
      options()
    )
    const responses = operation(result, '/invoices')['responses'] as Record<string, unknown>

    expect(responses['default']).toBe(mine)
  })

  /**
   * A response that is only a reference is a declaration too.
   *
   * A response object may legally be nothing but `$ref`. It carries no
   * `content`, so a rule keyed on content alone would overwrite it — discarding
   * the reference and leaving `$ref` beside sibling keys, which is not a valid
   * response object.
   */
  it('keeps a response that is a bare reference', () => {
    const mine = { $ref: '#/components/responses/MyError' }

    const result = augmentDocument(
      generated({ '/invoices': { get: { responses: { default: mine } } } }),
      options()
    )
    const responses = operation(result, '/invoices')['responses'] as Record<string, unknown>

    expect(responses['default']).toBe(mine)
  })

  /**
   * The envelope is documented only while the filter that produces it is on.
   *
   * With `envelope.enabled` false the runtime shapes errors through Nest or the
   * consumer's own handler, so documenting this package's envelope would
   * describe a body the deployment never sends. The health payload is a
   * different feature and is unaffected.
   */
  it('documents the envelope only while the envelope feature is enabled', () => {
    const base = normalizeCoreOptions()
    const off: ResolvedCoreOptions = {
      ...base,
      envelope: { ...base.envelope, enabled: false },
      health: { ...base.health, enabled: true }
    }

    const result = augmentDocument(generated({ ...OWN_ROUTES }), off)
    const invoices = operation(result, '/health/ready')['responses'] as Record<string, unknown>

    expect(invoices).not.toHaveProperty('default')
    expect(invoices).toHaveProperty('200')
  })

  /**
   * The peer's placeholder gets filled in. Regression guard.
   *
   * `@nestjs/swagger` emits a `200` with a description and no `content` for
   * every handler, so an operation is never literally missing its success
   * status. A plain "existing always wins" rule therefore never writes the
   * contributed schema, and every response stays shapeless — which is exactly
   * the orphaned-schemas symptom this work exists to fix.
   */
  it('fills in a placeholder response that declares no shape', () => {
    const result = augmentDocument(
      generated({ '/health/live': { get: { responses: { 200: { description: '' } } } } }),
      options()
    )
    const responses = operation(result, '/health/live')['responses'] as Record<
      string,
      Record<string, unknown>
    >

    expect(responses['200']).toMatchObject({
      description: 'Aggregated health report.',
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/BymaxHealthResponse' } }
      }
    })
  })

  /**
   * A description the document already carries is preserved.
   *
   * The shape is what was missing; the prose may have been written by whoever
   * decorated the handler, and replacing it would discard the one part of the
   * placeholder that can hold real intent.
   */
  it('keeps a non-empty description while filling in the shape', () => {
    const result = augmentDocument(
      generated({ '/health/live': { get: { responses: { 200: { description: 'Alive.' } } } } }),
      options()
    )
    const responses = operation(result, '/health/live')['responses'] as Record<
      string,
      Record<string, unknown>
    >

    expect(responses['200']?.['description']).toBe('Alive.')
    expect(responses['200']).toHaveProperty('content')
  })

  /**
   * Opting out of the schemas opts out of the references to them.
   *
   * Referencing a schema this package did not contribute would leave a dangling
   * `$ref`, and a document that resolves nowhere is worse than one saying less.
   */
  /**
   * Opting out leaves no reference to anything. Regression guard.
   *
   * The narrow assertion below covers one operation; this one covers the whole
   * served document, including the health endpoints whose success response is
   * the one place a reference could be emitted after the catalogue was skipped.
   * A dangling `$ref` is worse than saying less: the document stops resolving.
   */
  it('emits no reference anywhere when includeCoreSchemas is false', () => {
    const result = augmentDocument(
      generated({
        '/health/live': { get: { responses: { 200: { description: '' } } } },
        '/invoices': { get: {} }
      }),
      options({ includeCoreSchemas: false })
    )

    expect(JSON.stringify(result)).not.toContain('$ref')
    expect(result.components).not.toHaveProperty('schemas')
  })

  it('adds no responses when includeCoreSchemas is false', () => {
    const result = augmentDocument(
      generated({ '/invoices': { get: {} } }),
      options({ includeCoreSchemas: false })
    )

    expect(operation(result, '/invoices')).not.toHaveProperty('responses')
  })

  /**
   * Path-item members that are not operations are carried through untouched.
   *
   * A path item may hold `parameters`, `summary` or `$ref` beside its
   * operations; treating one of those as an operation would attach responses to
   * a shared parameter list and corrupt the document.
   */
  it('leaves non-operation members of a path item alone', () => {
    const parameters = [{ name: 'tenant', in: 'header' }]

    const result = augmentDocument(
      generated({ '/invoices': { parameters, get: {} } }),
      options({}, { health: health({ enabled: false }) })
    )
    const item = (result.paths as Record<string, Record<string, unknown>>)['/invoices']

    expect(item?.['parameters']).toBe(parameters)
    expect(operation(result, '/invoices')).toHaveProperty('responses')
  })

  /**
   * A malformed path item. Edge case: wrong type.
   *
   * Nothing enforces the shape of the document handed in, so a non-object path
   * item must degrade to an empty one rather than throw at bootstrap.
   */
  it('tolerates a path item that is not an object', () => {
    const result = augmentDocument(generated({ '/invoices': null }), options())

    expect((result.paths as Record<string, unknown>)['/invoices']).toEqual({})
  })
})
