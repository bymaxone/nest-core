/**
 * @fileoverview Offset pagination primitives for the `./pagination` subpath.
 * Pure, framework-neutral helpers that clamp untrusted page/limit input into a
 * safe {@link PageQuery} and shape a {@link PageResult}. The package never runs
 * a query: the consumer's repository translates the normalized query into its
 * own persistence call and passes the rows and total back to the builder.
 * @layer Utility
 */

/** Fallback page size applied when the raw limit is absent or invalid. */
const DEFAULT_LIMIT = 20

/** Upper bound applied to the page size when no per-call `maxLimit` is given. */
const DEFAULT_MAX_LIMIT = 100

/** The smallest legal page number and page size. */
const MINIMUM = 1

/** A safe, clamped offset query. `page` is 1-based. */
export interface PageQuery {
  /** 1-based page index, always `>= 1`. */
  page: number
  /** Page size, always within `[1, maxLimit]`. */
  limit: number
}

/** Per-call overrides for the clamping bounds. Never module state. */
export interface PageQueryOptions {
  /** Page size used when the raw limit is absent or invalid. Default `20`. */
  defaultLimit?: number
  /** Hard cap applied to the page size. Default `100`. */
  maxLimit?: number
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
 * Coerce an unknown value into a positive integer, falling back when the value
 * is not a finite number of at least one.
 *
 * `Number('')` and `Number(null)` collapse to `0`, so a bare finiteness check
 * is not enough: values below the minimum also fall back to keep non-numeric,
 * negative, and zero input from producing an out-of-range result.
 *
 * @param value - The raw, untrusted value to coerce.
 * @param fallback - The value returned when coercion yields nothing usable.
 * @returns A positive integer: the truncated coercion, or the fallback.
 */
function coercePositiveInt(value: unknown, fallback: number): number {
  const coerced = Number(value)
  if (!Number.isFinite(coerced) || coerced < MINIMUM) {
    return fallback
  }
  return Math.floor(coerced)
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
  options?: PageQueryOptions
): PageQuery {
  const defaultLimit = options?.defaultLimit ?? DEFAULT_LIMIT
  const maxLimit = options?.maxLimit ?? DEFAULT_MAX_LIMIT
  const page = coercePositiveInt(raw.page, MINIMUM)
  const limit = Math.min(coercePositiveInt(raw.limit, defaultLimit), maxLimit)
  return { page, limit }
}

/**
 * Assemble a {@link PageResult} from a page of items and the total count.
 *
 * `totalPages` is the ceiling of `totalItems` over the query limit; a total of
 * zero yields zero pages rather than one phantom page.
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
  const totalPages = Math.ceil(totalItems / query.limit)
  return {
    items,
    meta: { page: query.page, limit: query.limit, totalItems, totalPages }
  }
}
