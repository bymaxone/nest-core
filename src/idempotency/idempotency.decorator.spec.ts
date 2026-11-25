/**
 * Unit tests of the OpenAPI metadata `@Idempotent` leaves on a handler.
 *
 * Layer: unit.
 * Goal: the header is documented with its schema and the four refusals with their text, and a status the
 * route already documents keeps its own description.
 * Mocks: none; the handler is a plain function carrying `@nestjs/swagger`'s metadata keys.
 */
import 'reflect-metadata'

import { Idempotent } from './idempotency.decorator'

/** Apply `@Idempotent` to a fresh handler that already carries `parameters` and `responses`. */
function documented(
  declared: Parameters<typeof Idempotent>[0],
  parameters?: unknown[],
  responses?: Record<number, unknown>
): { parameters: unknown; responses: unknown } {
  class Target {}
  const handler = (): void => undefined
  if (parameters !== undefined) Reflect.defineMetadata('swagger/apiParameters', parameters, handler)
  if (responses !== undefined) Reflect.defineMetadata('swagger/apiResponse', responses, handler)
  Idempotent(declared)(Target.prototype, 'handler', { value: handler })
  return {
    parameters: Reflect.getMetadata('swagger/apiParameters', handler) as unknown,
    responses: Reflect.getMetadata('swagger/apiResponse', handler) as unknown
  }
}

const refusals = {
  400: { description: 'The Idempotency-Key header is invalid or, on a required route, missing' },
  409: { description: 'A request with this key is in progress, or its answer cannot be replayed' },
  422: { description: 'The Idempotency-Key was used by a different request' },
  503: { description: 'The idempotency store is unavailable' }
}

const header = (required: boolean): object => ({
  name: 'Idempotency-Key',
  in: 'header',
  required,
  schema: { type: 'string', minLength: 1, maxLength: 255 }
})

describe('@Idempotent, the OpenAPI document', () => {
  it.each([true, false])('documents the header and the refusals, required %p', (required) => {
    const { parameters, responses } = documented({ unscoped: true, required })

    expect(parameters).toEqual([header(required)])
    expect(responses).toEqual(refusals)
  })

  it('keeps what the route documents already, a status of its own included', () => {
    const own = { name: 'x', in: 'query' }
    const { parameters, responses } = documented({ unscoped: true }, [own], {
      200: { description: 'ok' },
      409: { description: 'taken' }
    })

    expect(parameters).toEqual([own, header(false)])
    expect(responses).toEqual({
      200: { description: 'ok' },
      ...refusals,
      409: { description: 'taken' }
    })
  })
})
