/**
 * @fileoverview The schemas this package contributes to a consumer's OpenAPI
 * document, expressed as plain specification objects rather than as decorated
 * classes.
 *
 * The distinction is what keeps `@nestjs/swagger` genuinely optional. A
 * decorator runs when its class is defined, so describing these contracts with
 * `@ApiProperty` would load the peer in every application that imports this
 * package, including the ones that never enable the feature. Data has no such
 * effect: these objects cost one property lookup and are copied into the
 * document only when the bootstrap helper actually runs.
 *
 * The dialect is OpenAPI 3.0, the version `@nestjs/swagger` produces by default,
 * so nullability is expressed with `nullable` rather than a union type.
 * @layer DTO
 */
import {
  BYMAX_BAD_GATEWAY,
  BYMAX_BAD_REQUEST,
  BYMAX_CLIENT_ERROR,
  BYMAX_CONFLICT,
  BYMAX_FORBIDDEN,
  BYMAX_GATEWAY_TIMEOUT,
  BYMAX_INTERNAL_ERROR,
  BYMAX_NOT_FOUND,
  BYMAX_NOT_IMPLEMENTED,
  BYMAX_PAYLOAD_TOO_LARGE,
  BYMAX_SERVICE_UNAVAILABLE,
  BYMAX_TOO_MANY_REQUESTS,
  BYMAX_UNAUTHORIZED,
  BYMAX_UNPROCESSABLE_ENTITY,
  BYMAX_UNSUPPORTED_MEDIA_TYPE,
  BYMAX_VALIDATION_FAILED
} from '../envelope/error-codes'

/**
 * A single OpenAPI schema or parameter object. Kept open rather than modeled
 * field by field: this package copies these objects into a document, it never
 * interprets them, and a partial local model of the specification would be a
 * second contract to keep in sync with the real one.
 */
export type OpenApiObjectLiteral = Readonly<Record<string, unknown>>

/** A named collection of OpenAPI objects, as it appears under `components`. */
export type OpenApiObjectMap = Readonly<Record<string, OpenApiObjectLiteral>>

/**
 * The documented error-code catalogue, derived from the exported constants
 * rather than retyped. Deriving is the point: a code added to the catalogue
 * without being added here would be a silent documentation gap.
 */
const ERROR_CODES: readonly string[] = [
  BYMAX_BAD_REQUEST,
  BYMAX_VALIDATION_FAILED,
  BYMAX_UNAUTHORIZED,
  BYMAX_FORBIDDEN,
  BYMAX_NOT_FOUND,
  BYMAX_CONFLICT,
  BYMAX_PAYLOAD_TOO_LARGE,
  BYMAX_UNSUPPORTED_MEDIA_TYPE,
  BYMAX_UNPROCESSABLE_ENTITY,
  BYMAX_TOO_MANY_REQUESTS,
  BYMAX_CLIENT_ERROR,
  BYMAX_INTERNAL_ERROR,
  BYMAX_NOT_IMPLEMENTED,
  BYMAX_BAD_GATEWAY,
  BYMAX_SERVICE_UNAVAILABLE,
  BYMAX_GATEWAY_TIMEOUT
]

/**
 * The schemas contributed under `components.schemas`. Every name is prefixed so
 * a contributed schema can never collide with a consumer's own model of the
 * same concept.
 */
export const CORE_SCHEMAS: OpenApiObjectMap = {
  BymaxErrorCode: {
    type: 'string',
    enum: ERROR_CODES,
    description:
      'Stable machine-readable error codes emitted by this package. A domain error may pass through its own code, so a response is not restricted to this catalogue.'
  },
  BymaxErrorDetails: {
    description:
      'Structured error context. The array form carries one entry per validation violation; the object form carries the development-only internals dump.',
    oneOf: [
      { type: 'array', items: {} },
      { type: 'object', additionalProperties: true }
    ]
  },
  BymaxErrorEnvelope: {
    type: 'object',
    description: 'The shape of every error response served by this application.',
    required: ['statusCode', 'code', 'message', 'timestamp', 'path'],
    properties: {
      statusCode: { type: 'integer', example: 404 },
      code: {
        type: 'string',
        example: BYMAX_NOT_FOUND,
        description: 'A code from BymaxErrorCode, or a domain code passed through unchanged.'
      },
      message: { type: 'string', description: 'Human-readable and safe to show end users.' },
      details: { $ref: '#/components/schemas/BymaxErrorDetails' },
      correlationId: {
        type: 'string',
        description: 'Present only when a correlation provider resolves an id.'
      },
      timestamp: { type: 'string', format: 'date-time' },
      path: { type: 'string', example: '/invoices/42' }
    }
  },
  BymaxHealthCheckEntry: {
    type: 'object',
    description: "One indicator's result within a readiness response.",
    required: ['name', 'status'],
    properties: {
      name: { type: 'string', example: 'redis' },
      status: { type: 'string', enum: ['up', 'down'] },
      details: {
        type: 'object',
        additionalProperties: true,
        description: 'Safe diagnostic context. Never carries secrets or connection strings.'
      }
    }
  },
  BymaxHealthResponse: {
    type: 'object',
    description: 'The body served by the liveness and readiness endpoints.',
    required: ['status', 'checks'],
    properties: {
      status: {
        type: 'string',
        enum: ['ok', 'error'],
        description: "'ok' only when every check is up. Liveness is always 'ok'."
      },
      checks: {
        type: 'array',
        items: { $ref: '#/components/schemas/BymaxHealthCheckEntry' },
        description: 'Empty for the liveness endpoint.'
      }
    }
  },
  BymaxPageMeta: {
    type: 'object',
    description: 'Offset-pagination metadata.',
    required: ['page', 'limit', 'totalItems', 'totalPages'],
    properties: {
      page: { type: 'integer', minimum: 1, example: 1 },
      limit: { type: 'integer', minimum: 1, example: 20 },
      totalItems: { type: 'integer', minimum: 0, example: 137 },
      totalPages: { type: 'integer', minimum: 0, example: 7 }
    }
  },
  BymaxPageResult: {
    type: 'object',
    description:
      'An offset-paginated page. Compose it with a concrete item schema by overriding `items`.',
    required: ['items', 'meta'],
    properties: {
      items: { type: 'array', items: {} },
      meta: { $ref: '#/components/schemas/BymaxPageMeta' }
    }
  },
  BymaxCursorResult: {
    type: 'object',
    description:
      'A cursor-paginated page. Compose it with a concrete item schema by overriding `items`.',
    required: ['items', 'nextCursor'],
    properties: {
      items: { type: 'array', items: {} },
      nextCursor: {
        type: 'string',
        nullable: true,
        description: 'Opaque cursor for the next page, or null when the last page was reached.'
      }
    }
  }
}

/**
 * The query parameters contributed under `components.parameters`, referenced by
 * an operation with a `$ref` rather than redeclared per endpoint.
 *
 * The limit bounds are per-call overridable by the consumer, so the parameters
 * document the defaults and deliberately declare no maximum: a hard `maximum`
 * here would describe a rule the application may not actually enforce.
 */
export const CORE_PARAMETERS: OpenApiObjectMap = {
  BymaxPageQueryPage: {
    name: 'page',
    in: 'query',
    required: false,
    description: '1-based page number. Out-of-range and non-numeric input is clamped.',
    schema: { type: 'integer', minimum: 1, default: 1 }
  },
  BymaxPageQueryLimit: {
    name: 'limit',
    in: 'query',
    required: false,
    description: 'Items per page. Clamped to the range this application configures.',
    schema: { type: 'integer', minimum: 1, default: 20 }
  },
  BymaxCursorQueryCursor: {
    name: 'cursor',
    in: 'query',
    required: false,
    description: 'Opaque cursor from a previous response. Omit to request the first page.',
    schema: { type: 'string' }
  }
}
