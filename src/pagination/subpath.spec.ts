/**
 * Integration tests for the `./pagination` public barrel.
 *
 * Layer: integration.
 * Goal: prove the subpath is consumable standalone through its barrel, with no
 * NestJS module, provider, or testing harness in scope, and that a realistic
 * offset and cursor flow works end to end using only the exported surface.
 * Mocks: none; an in-memory array stands in for a repository.
 */
import {
  buildCursorResult,
  buildPageResult,
  decodeCursor,
  encodeCursor,
  normalizeCursorQuery,
  normalizePageQuery,
  type CursorQuery,
  type PageQuery,
  type PageResult
} from './index'

describe('pagination subpath barrel', () => {
  /**
   * Barrel surface completeness.
   *
   * Every documented §7 export must resolve to a callable through the barrel so
   * consumers can import the whole surface from one specifier.
   */
  it('exposes the full offset and cursor surface as callables', () => {
    const surface = [
      normalizePageQuery,
      buildPageResult,
      normalizeCursorQuery,
      buildCursorResult,
      encodeCursor,
      decodeCursor
    ]

    for (const fn of surface) {
      expect(typeof fn).toBe('function')
    }
  })

  /**
   * End-to-end offset flow with zero providers.
   *
   * Exercises raw-query normalization, a simulated repository slice, and result
   * assembly using only the barrel, proving no Nest container is required.
   */
  it('runs an offset flow end to end from raw query to page result', () => {
    // Arrange: a raw query as it would arrive from a controller.
    const query: PageQuery = normalizePageQuery({ page: '2', limit: '5' }, { maxLimit: 50 })

    // Act: the "repository" returns a slice and the total count.
    const rows = [{ id: 6 }, { id: 7 }, { id: 8 }, { id: 9 }, { id: 10 }]
    const result: PageResult<{ id: number }> = buildPageResult(rows, 42, query)

    // Assert: meta reflects the clamped query and computed page count.
    expect(query).toEqual({ page: 2, limit: 5 })
    expect(result.meta).toEqual({ page: 2, limit: 5, totalItems: 42, totalPages: 9 })
  })

  /**
   * End-to-end cursor flow with a decodable next page.
   *
   * Simulates the fetch-one-extra convention: the repository returns limit + 1
   * rows, the builder trims and emits a cursor, and that cursor decodes back to
   * the boundary key, all without a NestJS provider.
   */
  it('runs a cursor flow end to end and decodes the next cursor', () => {
    // Arrange: normalize a raw cursor query for a page size of two.
    const query: CursorQuery = normalizeCursorQuery({ limit: 2 })

    // Act: fetch limit + 1 rows and build the trimmed result.
    const fetched = [{ id: 1 }, { id: 2 }, { id: 3 }]
    const result = buildCursorResult(fetched, query.limit, (row) => ({ id: row.id }))

    // Assert: the page is trimmed and the next cursor decodes to the boundary.
    expect(result.items).toEqual([{ id: 1 }, { id: 2 }])
    expect(result.nextCursor).not.toBeNull()
    expect(decodeCursor(result.nextCursor as string)).toEqual({ id: 2 })
  })

  /**
   * Codec round-trip through the barrel.
   *
   * Confirms `encodeCursor`/`decodeCursor` are the same contract when reached via
   * the public specifier, guarding against a barrel that leaks a divergent copy.
   */
  it('round-trips a cursor through the barrel exports', () => {
    const payload = { createdAt: '2026-07-16', id: 99 }

    expect(decodeCursor(encodeCursor(payload))).toEqual(payload)
  })
})
