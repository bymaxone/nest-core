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
 * @param value - The raw, untrusted value to coerce.
 * @param fallback - The value returned when coercion yields nothing usable.
 * @returns A positive integer: the truncated coercion, or the fallback.
 */
export function coercePositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' && typeof value !== 'string') {
    return fallback
  }
  const coerced = Number(value)
  if (!Number.isFinite(coerced) || coerced < MINIMUM) {
    return fallback
  }
  return Math.floor(coerced)
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
