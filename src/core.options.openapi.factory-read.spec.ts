/**
 * Unit tests for the one read of `openapi.operationIdFactory`.
 *
 * Layer: unit.
 * Goal: the factory the options check is the one they keep, whatever a getter answers the second time.
 * Mocks: none.
 */
import { resolveOpenApi } from './core.options.openapi'

describe('openapi.operationIdFactory behind a getter that answers twice', () => {
  it('is read once, so what was checked is what is kept', () => {
    let reads = 0
    const factory = (): string => 'id'
    const given = {
      enabled: true,
      get operationIdFactory(): unknown {
        reads += 1
        return reads === 1 ? factory : 'not a function'
      }
    }

    const resolved = resolveOpenApi(given)

    expect(reads).toBe(1)
    expect(resolved.operationIdFactory).toBe(factory)
  })
})
