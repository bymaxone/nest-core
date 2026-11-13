/**
 * @fileoverview `BymaxBodyDepthMiddleware`, which refuses a parsed request body nested deeper than
 * the configured limit before the application's validation sees it.
 *
 * A body of a few thousand nested arrays is a few kilobytes, and a recursive validator or
 * transformer overflows the stack on it; the exception filter then answers `500` for a request
 * that was only malformed. This package ships no validation of its own, so the floor sits in front
 * of the consumer's: Nest registers its body parsers before module middleware, so `req.body` is
 * already parsed here. When the application parses bodies itself and later, or the adapter parses
 * after middleware (Fastify), `req.body` is absent and this does nothing.
 *
 * The walk is iterative: the check must not overflow on the body it exists to refuse.
 * @layer Middleware
 */
import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import type { NestMiddleware } from '@nestjs/common'

import type { ResolvedCoreOptions } from '../core.options'
import { BYMAX_CORE_OPTIONS } from '../core.tokens'
import { BYMAX_BAD_REQUEST } from '../envelope/error-codes'

/** Fixed message of the refusal; it quotes nothing from the request. */
const BODY_TOO_DEEP_MESSAGE = 'Request body is nested too deeply'

/**
 * Whether a parsed value can nest: an array or a plain object. A Buffer or typed array (a raw body),
 * a Map or a class instance is a leaf, because `Object.values` on a Buffer allocates one element
 * per byte on the event loop.
 */
function isContainer(node: unknown): node is object {
  if (typeof node !== 'object' || node === null) {
    return false
  }
  const proto = Object.getPrototypeOf(node) as unknown
  return Array.isArray(node) || proto === Object.prototype || proto === null
}

/**
 * Whether a value nests objects or arrays deeper than the limit.
 *
 * @param value - A parsed body.
 * @param maxDepth - The deepest nesting allowed; a flat object or array is depth 1.
 * @returns `true` when the value is nested deeper than `maxDepth`.
 */
export function exceedsDepth(value: unknown, maxDepth: number): boolean {
  let level: unknown[] = [value]
  for (let depth = 0; level.length > 0; depth += 1) {
    const next: unknown[] = []
    for (const node of level) {
      if (isContainer(node)) {
        if (depth >= maxDepth) {
          return true
        }
        for (const child of Object.values(node)) {
          next.push(child)
        }
      }
    }
    level = next
  }
  return false
}

/** Refuses a body nested deeper than `bodyDepth.maxDepth` with a coded `400`. */
@Injectable()
export class BymaxBodyDepthMiddleware implements NestMiddleware {
  constructor(@Inject(BYMAX_CORE_OPTIONS) private readonly options: ResolvedCoreOptions) {}

  /**
   * @param req - The request, whose `body` the parser has already filled.
   * @param _res - Unused.
   * @param next - Continues the chain.
   * @throws BadRequestException When the body is nested too deeply.
   */
  use(req: { body?: unknown }, _res: unknown, next: () => void): void {
    if (exceedsDepth(req.body, this.options.bodyDepth.maxDepth)) {
      throw new BadRequestException({ code: BYMAX_BAD_REQUEST, message: BODY_TOO_DEEP_MESSAGE })
    }
    next()
  }
}
