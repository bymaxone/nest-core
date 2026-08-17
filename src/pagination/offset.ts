/**
 * @fileoverview Offset pagination primitives for the `./pagination` subpath.
 * Pure, framework-neutral helpers that clamp untrusted page/limit input into a
 * safe {@link PageQuery} and shape a {@link PageResult}. The package never runs
 * a query: the consumer's repository translates the normalized query into its
 * own persistence call and passes the rows and total back to the builder.
 * @layer Utility
 */
import {
  DEFAULT_LIMIT,
  MINIMUM,
  clampLimit,
  clampPageToLimit,
  clampPageToOffset,
  coercePositiveInt,
  type PaginationLimitOptions
} from './internal'

/** A safe, clamped offset query. `page` is 1-based. */
export interface PageQuery {
  /** 1-based page index, always `>= 1`. */
  page: number
  /** Page size, always within `[1, maxLimit]`. */
  limit: number
}

/** Pagination metadata describing the position within the full result set. */
export interface PageMeta {
  /** The 1-based page this result represents. */
  page: number
  /** The page size used to compute the slice. */
  limit: number
  /** Total number of items across all pages. */
  totalItems: number
  /** Total number of pages, `0` when there are no items. */
  totalPages: number
}

/** A page of items plus its computed {@link PageMeta}. */
export interface PageResult<T> {
  /** The items on this page. */
  items: T[]
  /** Metadata describing this page within the full set. */
  meta: PageMeta
}

/**
 * Clamp raw request input into a safe {@link PageQuery}.
 *
 * `page` floors to `1`; `limit` floors to `1` and caps at `maxLimit`. Absent,
 * non-numeric, negative, or zero fields fall back to defaults. The limit is resolved
 * first so `page` can be capped relative to it: a page is bounded not only to a safe
 * integer but to one whose offset `(page - 1) * limit` also stays a safe integer, so a
 * hostile `page` cannot lose precision before the repository computes its offset.
 * Options are per-call and never retained between calls.
 *
 * @param raw - The untrusted page and limit values from the request.
 * @param options - Per-call `defaultLimit` (default `20`), `maxLimit` (default
 *   `100`) and `maxOffset` (absent by default) overrides. `maxLimit` bounds how
 *   many rows a request reads; `maxOffset` bounds how far in it starts, which is
 *   the half an offset-paginated database pays for.
 * @returns A clamped, safe query ready to hand to a repository.
 */
/**
 * Options for {@link normalizePageQuery}: the shared limit bounds, plus the one
 * that only means anything to offset pagination.
 *
 * Declared here rather than beside the shared bounds so it cannot reach the
 * cursor normalizer, which takes {@link PaginationLimitOptions} and has no
 * offset to bound. An option that type-checks on a function that ignores it is
 * worse than a missing one — it reads as configured and does nothing.
 */
export interface PageQueryOptions extends PaginationLimitOptions {
  /**
   * Hard cap applied to the repository offset the query drives,
   * `(page - 1) * limit`. Absent by default, which bounds nothing beyond
   * arithmetic safety.
   *
   * `maxLimit` bounds how many rows a request reads; this bounds how far in it
   * starts, which is the half that costs on an offset-paginated database — a
   * `SELECT … OFFSET 20000000000` is a twenty-byte request that scans a table.
   * Set it wherever the page index reaches SQL and the dataset has a knowable
   * ceiling. There is deliberately no default: legitimate deep paging exists,
   * and a silent cap would change the rows a working query returns.
   *
   * `0` is meaningful and means "the first page only". Any other value that is
   * not a non-negative safe integer is read as absent.
   */
  maxOffset?: number
}

export function normalizePageQuery(
  raw: { page?: unknown; limit?: unknown },
  options?: PageQueryOptions
): PageQuery {
  const limit = clampLimit(raw.limit, options)
  return {
    page: clampPageToOffset(
      clampPageToLimit(coercePositiveInt(raw.page, MINIMUM), limit),
      limit,
      options?.maxOffset
    ),
    limit
  }
}

/**
 * Assemble a {@link PageResult} from a page of items and the total count.
 *
 * `totalPages` is the ceiling of `totalItems` over the query limit; a total of
 * zero yields zero pages rather than one phantom page. Inputs are defensively
 * normalized so a misused non-positive limit or a negative/non-finite total
 * cannot produce an `Infinity`, `NaN`, or negative page count, and `page` is
 * floored to `1` so the metadata always satisfies the `>= 1` contract.
 *
 * @param items - The items on the current page.
 * @param totalItems - The total number of items across all pages.
 * @param query - The clamped query that produced this page.
 * @returns The page of items with its computed metadata.
 */
export function buildPageResult<T>(
  items: T[],
  totalItems: number,
  query: PageQuery
): PageResult<T> {
  const safePage = coercePositiveInt(query.page, MINIMUM)
  // Stryker disable next-line EqualityOperator: equivalent — only `totalItems === 0` selects a different branch, and both branches yield `0` (`Math.floor(0)` on one side, the literal `0` on the other), so `safeTotal` is identical for every input.
  const safeTotal = Number.isFinite(totalItems) && totalItems > 0 ? Math.floor(totalItems) : 0
  const safeLimit = coercePositiveInt(query.limit, DEFAULT_LIMIT)
  const totalPages = Math.ceil(safeTotal / safeLimit)
  return {
    items,
    meta: { page: safePage, limit: safeLimit, totalItems: safeTotal, totalPages }
  }
}
