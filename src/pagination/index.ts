/**
 * @fileoverview Public barrel for the `./pagination` subpath. Ships the offset
 * and cursor pagination DTOs, result builders, and the opaque cursor codec.
 * Framework-neutral: no NestJS provider or ORM import in this subpath. The
 * shared internal clamp helpers stay private and are never re-exported here.
 * @layer public-api
 */

export { buildPageResult, normalizePageQuery } from './offset'
export type { PageMeta, PageQuery, PageResult } from './offset'

export { buildCursorResult, decodeCursor, encodeCursor, normalizeCursorQuery } from './cursor'
export type { CursorQuery, CursorResult } from './cursor'
