/**
 * @fileoverview Private clamping helpers shared by the offset and cursor paths.
 * Not part of the public surface: the `./pagination` barrel never re-exports
 * these. Centralizing the limit clamp keeps the offset and cursor query
 * normalizers behaving identically at their boundaries.
 * @layer Utility
 */

/** Fallback page size applied when the raw limit is absent or invalid. */
export const DEFAULT_LIMIT = 20

/** Upper bound applied to the page size when no per-call `maxLimit` is given. */
export const DEFAULT_MAX_LIMIT = 100

/** The smallest legal page number and page size. */
export const MINIMUM = 1

/** Per-call overrides for the clamping bounds. Never module state. */
export interface PaginationLimitOptions {
  /** Page size used when the raw limit is absent or invalid. Default `20`. */
  defaultLimit?: number
  /** Hard cap applied to the page size. Default `100`. */
  maxLimit?: number
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

/**
 * Coerce an unknown value into a positive integer, falling back when the value
 * is not a finite number of at least one.
 *
 * Only numbers and strings are coerced: `Number` would otherwise map `true` to
 * `1` and `[3]` to `3`, letting unexpected request shapes pass clamping, so
 * booleans, arrays, objects, and `null` fall back without coercion. Among the
 * coerced values, `Number('')` collapses to `0`, so a bare finiteness check is
 * not enough: values below the minimum also fall back, keeping non-numeric,
 * negative, and zero input from producing an out-of-range result.
 *
 * The result is capped at {@link Number.MAX_SAFE_INTEGER}. Above that boundary a
 * finite `Number` is no longer a precise integer — `1e308` floors to itself — so a
 * value handed back would already have lost integer precision. Capping keeps every
 * result a safe integer. A `page` needs one more bound to be offset-safe: even a
 * safe-integer page can drive `(page - 1) * limit` past the safe range, which
 * {@link clampPageToLimit} closes once the limit is known.
 *
 * @param value - The raw, untrusted value to coerce.
 * @param fallback - The value returned when coercion yields nothing usable.
 * @returns A positive, safe integer: the truncated coercion capped at
 *   {@link Number.MAX_SAFE_INTEGER}, or the fallback.
 */
export function coercePositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' && typeof value !== 'string') {
    return fallback
  }
  const coerced = Number(value)
  if (!Number.isFinite(coerced) || coerced < MINIMUM) {
    return fallback
  }
  return Math.min(Math.floor(coerced), Number.MAX_SAFE_INTEGER)
}

/**
 * Cap a page index so the repository offset it drives, `(page - 1) * limit`, stays a
 * safe integer. {@link coercePositiveInt} keeps `page` itself safe, but the offset is
 * a product and can still exceed {@link Number.MAX_SAFE_INTEGER} and lose precision
 * before a repository ever sees it. The largest page whose offset is exact is
 * `floor(MAX_SAFE_INTEGER / limit) + 1` — its offset is `floor(MAX / limit) * limit`,
 * which is `<= MAX` by construction. `page` is already `<= MAX` from coercion, so a
 * plain `min` of the two is enough (for `limit === 1` the bound is `MAX + 1`, and the
 * already-capped page wins).
 *
 * @param page - A positive, safe-integer page index.
 * @param limit - The resolved page size, always `>= 1`.
 * @returns `page` capped so `(page - 1) * limit` stays a safe integer.
 */
export function clampPageToLimit(page: number, limit: number): number {
  return Math.min(page, Math.floor(Number.MAX_SAFE_INTEGER / limit) + 1)
}

/**
 * Cap a page index so the offset it drives stays within a configured ceiling.
 *
 * Separate from {@link clampPageToLimit}, which is an arithmetic guard: that one
 * keeps `(page - 1) * limit` an exact integer and bounds nothing a database
 * would feel. This one is the resource bound, and it is the counterpart to
 * `maxLimit` — a request already cannot read more than `maxLimit` rows, and with
 * this set it cannot start further in than `maxOffset` either.
 *
 * The highest page whose offset fits is `floor(maxOffset / limit) + 1`: its
 * offset is `floor(maxOffset / limit) * limit`, which is `<= maxOffset` by
 * construction. Clamping rather than rejecting matches how `maxLimit` already
 * behaves — the resolved values are reported back in the page meta, so a caller
 * that cares can compare what it asked for against what it got.
 *
 * @param page - A positive, safe-integer page index.
 * @param limit - The resolved page size, always `>= 1`.
 * @param maxOffset - The configured ceiling, or `undefined` to bound nothing.
 *   Read as absent unless it is a non-negative safe integer; `0` is honoured and
 *   pins every query to the first page.
 * @returns `page` capped so `(page - 1) * limit` stays within `maxOffset`.
 */
export function clampPageToOffset(page: number, limit: number, maxOffset?: number): number {
  // Validated rather than coerced: every other option here has a documented
  // fallback, and this one has none — absent is a distinct, meaningful state,
  // so a malformed value must resolve to it rather than to some invented cap.
  //
  // `undefined` is tested by identity rather than by `typeof`, which narrows the
  // type for the comparison below and leaves `Number.isSafeInteger` to reject
  // everything else a caller can produce: a string from an untyped config, a
  // fraction, `NaN`, an infinity. A `typeof` guard beside it would be dead
  // weight — `isSafeInteger` already answers `false` for every non-number, so
  // the only value the two would disagree about does not exist.
  if (maxOffset === undefined || !Number.isSafeInteger(maxOffset) || maxOffset < 0) {
    return page
  }
  return Math.min(page, Math.floor(maxOffset / limit) + 1)
}

/**
 * Clamp a raw limit into `[1, maxLimit]`, applying the per-call default when the
 * raw value is absent or invalid.
 *
 * @param rawLimit - The untrusted limit value from the request.
 * @param options - Per-call `defaultLimit` (default `20`) and `maxLimit`
 *   (default `100`) overrides. Non-positive or non-finite overrides are
 *   themselves coerced to those defaults so the result stays within `[1, maxLimit]`.
 * @returns A safe page size within the resolved bounds.
 */
export function clampLimit(rawLimit: unknown, options?: PaginationLimitOptions): number {
  const defaultLimit = coercePositiveInt(options?.defaultLimit, DEFAULT_LIMIT)
  const maxLimit = coercePositiveInt(options?.maxLimit, DEFAULT_MAX_LIMIT)
  return Math.min(coercePositiveInt(rawLimit, defaultLimit), maxLimit)
}
