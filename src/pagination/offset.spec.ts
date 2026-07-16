/**
 * Unit tests for the offset pagination primitives.
 *
 * Layer: unit.
 * Goal: prove `normalizePageQuery` clamps untrusted input into a safe
 * `PageQuery` (page floor, limit floor and cap, per-call defaults) and that
 * `buildPageResult` computes `totalPages` correctly, including the zero-items
 * boundary. These clamping boundaries are the contract that protects consumers
 * from oversized or nonsensical queries reaching their repositories.
 * Mocks: none; the helpers are pure.
 */
import { buildPageResult, normalizePageQuery } from './offset'

describe('normalizePageQuery', () => {
  // Each row is a raw input, per-call options, and the expected normalized
  // query. Table-driven to keep every clamping boundary visible at a glance.
  const cases: ReadonlyArray<{
    readonly name: string
    readonly raw: { page?: unknown; limit?: unknown }
    readonly options?: { defaultLimit?: number; maxLimit?: number }
    readonly expected: { page: number; limit: number }
  }> = [
    {
      name: 'applies defaults when both fields are absent',
      raw: {},
      expected: { page: 1, limit: 20 }
    },
    {
      name: 'floors page 0 up to the minimum of 1',
      raw: { page: 0, limit: 10 },
      expected: { page: 1, limit: 10 }
    },
    {
      name: 'falls back to page 1 on a negative page',
      raw: { page: -5, limit: 10 },
      expected: { page: 1, limit: 10 }
    },
    {
      name: 'falls back to page 1 on a non-numeric page',
      raw: { page: 'abc', limit: 10 },
      expected: { page: 1, limit: 10 }
    },
    {
      name: 'coerces string numerics to their numeric value',
      raw: { page: '3', limit: '15' },
      expected: { page: 3, limit: 15 }
    },
    {
      name: 'truncates fractional page and limit toward zero',
      raw: { page: 2.9, limit: 7.9 },
      expected: { page: 2, limit: 7 }
    },
    {
      name: 'caps a limit above the default maximum at 100',
      raw: { page: 1, limit: 500 },
      expected: { page: 1, limit: 100 }
    },
    {
      name: 'passes a limit exactly at the cap unchanged',
      raw: { page: 1, limit: 100 },
      expected: { page: 1, limit: 100 }
    },
    {
      name: 'floors limit 0 up to the default limit',
      raw: { page: 1, limit: 0 },
      expected: { page: 1, limit: 20 }
    },
    {
      name: 'falls back to the default limit on a negative limit',
      raw: { page: 1, limit: -3 },
      expected: { page: 1, limit: 20 }
    },
    {
      name: 'falls back to the default limit on a non-numeric limit',
      raw: { page: 1, limit: {} },
      expected: { page: 1, limit: 20 }
    },
    {
      name: 'honors a per-call defaultLimit override',
      raw: { page: 1 },
      options: { defaultLimit: 5 },
      expected: { page: 1, limit: 5 }
    },
    {
      name: 'honors a per-call maxLimit override as the cap',
      raw: { page: 1, limit: 999 },
      options: { maxLimit: 50 },
      expected: { page: 1, limit: 50 }
    },
    {
      name: 'falls back to the default cap when maxLimit is zero',
      raw: { page: 1, limit: 999 },
      options: { maxLimit: 0 },
      expected: { page: 1, limit: 100 }
    },
    {
      name: 'falls back to the default page size when defaultLimit is negative',
      raw: { page: 1 },
      options: { defaultLimit: -1 },
      expected: { page: 1, limit: 20 }
    }
  ]

  it.each(cases)('$name', ({ raw, options, expected }) => {
    /**
     * Clamping boundary matrix.
     *
     * Every row exercises one floor, cap, default, or coercion rule so a
     * regression in any single boundary surfaces as a focused failure.
     */
    expect(normalizePageQuery(raw, options)).toEqual(expected)
  })

  /**
   * Options object is per-call, never module state.
   *
   * Two calls with different maxLimit options must not influence each other:
   * proves the helper holds no cross-call state, an invariant of a pure helper.
   */
  it('does not leak options between calls', () => {
    const first = normalizePageQuery({ limit: 999 }, { maxLimit: 30 })
    const second = normalizePageQuery({ limit: 999 })

    expect(first.limit).toBe(30)
    expect(second.limit).toBe(100)
  })
})

describe('buildPageResult', () => {
  /**
   * Standard multi-page count.
   *
   * `totalPages` is the ceiling of totalItems over the page limit so a partial
   * final page still counts as a page.
   */
  it('computes totalPages as the ceiling of totalItems over limit', () => {
    const result = buildPageResult([{ id: 1 }], 45, { page: 2, limit: 20 })

    expect(result.items).toEqual([{ id: 1 }])
    expect(result.meta).toEqual({ page: 2, limit: 20, totalItems: 45, totalPages: 3 })
  })

  /**
   * Zero-items boundary.
   *
   * An empty result set must report zero total pages, not one, so consumers
   * render an empty state rather than a phantom first page.
   */
  it('yields zero total pages when there are no items', () => {
    const result = buildPageResult<{ id: number }>([], 0, { page: 1, limit: 20 })

    expect(result.items).toEqual([])
    expect(result.meta).toEqual({ page: 1, limit: 20, totalItems: 0, totalPages: 0 })
  })

  /**
   * Exact multiple boundary.
   *
   * When totalItems divides evenly by the limit the ceiling must not add a
   * spurious extra page.
   */
  it('does not add an extra page when totalItems divides evenly', () => {
    const result = buildPageResult([{ id: 1 }], 40, { page: 1, limit: 20 })

    expect(result.meta.totalPages).toBe(2)
  })

  /**
   * Non-finite total defensive case.
   *
   * A NaN or Infinity total would otherwise poison totalPages; it is normalized
   * to zero so the metadata stays within the non-negative contract.
   */
  it('normalizes a non-finite totalItems to zero', () => {
    const result = buildPageResult<{ id: number }>([], Number.NaN, { page: 1, limit: 20 })

    expect(result.meta.totalItems).toBe(0)
    expect(result.meta.totalPages).toBe(0)
  })

  /**
   * Negative total defensive case.
   *
   * A negative total (e.g. from a buggy count) must not yield a negative page
   * count; it is floored to zero.
   */
  it('normalizes a negative totalItems to zero', () => {
    const result = buildPageResult<{ id: number }>([], -5, { page: 1, limit: 20 })

    expect(result.meta.totalItems).toBe(0)
    expect(result.meta.totalPages).toBe(0)
  })

  /**
   * Non-positive limit defensive case.
   *
   * A misused zero limit would divide to Infinity; the builder falls back to the
   * default page size so totalPages stays finite.
   */
  it('falls back to the default page size when the limit is non-positive', () => {
    const result = buildPageResult([{ id: 1 }], 45, { page: 1, limit: 0 })

    expect(result.meta.limit).toBe(20)
    expect(result.meta.totalPages).toBe(3)
    expect(Number.isFinite(result.meta.totalPages)).toBe(true)
  })

  /**
   * Non-positive page defensive case.
   *
   * A misused page below 1 must not surface in the metadata; it is floored to 1
   * so `meta.page` always satisfies the documented 1-based contract.
   */
  it('floors a non-positive page to one', () => {
    const result = buildPageResult([{ id: 1 }], 45, { page: 0, limit: 20 })

    expect(result.meta.page).toBe(1)
  })
})
