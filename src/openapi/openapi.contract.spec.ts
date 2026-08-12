/**
 * Unit tests for the OpenAPI contributor contract.
 *
 * Layer: unit.
 * Goal: prove the marker is readable by the same scan the other two contracts
 * use, and that its metadata key is the literal string that survives this
 * package shipping one bundle per subpath.
 * Mocks: none; `Reflector` reads the real metadata the decorator wrote.
 */
import { Reflector } from '@nestjs/core'

import { BymaxOpenApiContributor, BYMAX_OPENAPI_CONTRIBUTOR_METADATA } from './openapi.contract'

describe('BymaxOpenApiContributor', () => {
  /**
   * The marker is readable through the reader the scan uses.
   *
   * Discovery matches this metadata and nothing else, so a decorator that
   * writes a key `Reflector` cannot read would leave every contributor silently
   * undiscovered — the failure mode that produces a document missing exactly
   * the operations someone took the trouble to describe.
   */
  it('marks a class so the shared scan can find it', () => {
    @BymaxOpenApiContributor()
    class Marked {}
    class Unmarked {}

    const reflector = new Reflector()

    expect(reflector.get(BYMAX_OPENAPI_CONTRIBUTOR_METADATA, Marked)).toBe(true)
    expect(reflector.get(BYMAX_OPENAPI_CONTRIBUTOR_METADATA, Unmarked)).toBeUndefined()
  })

  /**
   * The key is a namespaced literal.
   *
   * Not a value from `DiscoveryService.createDecorator()`, which mints a random
   * key per module load: this package ships one bundle per published subpath, so
   * a library decorating its class through `./openapi` would hold a different
   * key than the scan running from the package root and nothing would ever
   * match. A literal is identical in every copy. Asserted on the exact string
   * because it is the contract a conformance test in another repository pins.
   */
  it('uses the namespaced literal key the other markers use', () => {
    expect(BYMAX_OPENAPI_CONTRIBUTOR_METADATA).toBe('bymax-one:openapi-contributor')
  })
})
