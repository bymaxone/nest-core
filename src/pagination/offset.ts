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
 * non-numeric, negative, or zero fields fall back to defaults. Options are
 * per-call and never retained between calls.
 *
 * @param raw - The untrusted page and limit values from the request.
 * @param options - Per-call `defaultLimit` (default `20`) and `maxLimit`
 *   (default `100`) overrides.
 * @returns A clamped, safe query ready to hand to a repository.
 */
export function normalizePageQuery(
  raw: { page?: unknown; limit?: unknown },
  options?: PaginationLimitOptions
): PageQuery {
  return {
    page: coercePositiveInt(raw.page, MINIMUM),
    limit: clampLimit(raw.limit, options)
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
  // Stryker disable next-line EqualityOperator: equivalent — the arms agree at zero, which is the only value the operator separates: `Math.floor(0)` is the same 0 the else branch produces
  const safeTotal = Number.isFinite(totalItems) && totalItems > 0 ? Math.floor(totalItems) : 0
  const safeLimit = coercePositiveInt(query.limit, DEFAULT_LIMIT)
  const totalPages = Math.ceil(safeTotal / safeLimit)
  return {
    items,
    meta: { page: safePage, limit: safeLimit, totalItems: safeTotal, totalPages }
  }
}
