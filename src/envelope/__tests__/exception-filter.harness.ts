/**
 * @fileoverview The filter, host and reply capture the BymaxExceptionFilter specs share: a
 * hand-built ArgumentsHost and HttpAdapter, and stub correlation and trace providers.
 * @layer test support
 */
import type { ArgumentsHost } from '@nestjs/common'
import type { HttpAdapterHost } from '@nestjs/core'

import { normalizeCoreOptions } from '../../core.options'
import type { ResolvedCoreOptions } from '../../core.options'

import type { ICorrelationIdProvider } from '../correlation.interfaces'
import type { ITraceContextProvider, TraceContext } from '../../telemetry/trace-context'
import { BymaxExceptionFilter } from '../exception.filter'
import type { ErrorEnvelope } from '../error-envelope'

/** Captured arguments of the adapter's `reply` call. */
export interface Captured {
  body: ErrorEnvelope | undefined
  status: number | undefined
}

/** A stub correlation provider that resolves the given id (default: none). */
export function stubCorrelation(id?: string): ICorrelationIdProvider {
  return { getCorrelationId: (): string | undefined => id }
}

/** Build a trace-context provider resolving the given trace, or nothing. */
export function stubTraceContext(traceId?: string): ITraceContextProvider {
  return {
    getTraceContext: (): TraceContext | undefined =>
      traceId === undefined ? undefined : { traceId, spanId: 'b'.repeat(16) }
  }
}

/** Build a filter plus an HTTP host wired to capture the reply. */
export function buildHarness(params?: {
  options?: ResolvedCoreOptions
  correlation?: ICorrelationIdProvider
  /** Trace-context provider; omitted leaves the filter's own no-op fallback. */
  traceContext?: ITraceContextProvider
  /** Pass `undefined` for the correlation provider instead of the default stub. */
  noCorrelation?: boolean
  contextType?: string
  url?: string
  method?: string
  filterCtor?: new (
    options: ResolvedCoreOptions,
    correlation: ICorrelationIdProvider | undefined,
    adapterHost: HttpAdapterHost,
    traceContext?: ITraceContextProvider
  ) => BymaxExceptionFilter
}): {
  filter: BymaxExceptionFilter
  host: ArgumentsHost
  captured: Captured
  adapterHost: HttpAdapterHost
} {
  const captured: Captured = { body: undefined, status: undefined }
  const request = { url: params?.url ?? '/invoices/inv_123', method: params?.method ?? 'GET' }
  const httpAdapter = {
    getRequestUrl: (req: { url: string }): string => req.url,
    getRequestMethod: (req: { method: string }): string => req.method,
    reply: (_response: unknown, body: ErrorEnvelope, status: number): void => {
      captured.body = body
      captured.status = status
    }
  }
  const adapterHost = { httpAdapter } as unknown as HttpAdapterHost
  const host = {
    getType: (): string => params?.contextType ?? 'http',
    switchToHttp: () => ({
      getRequest: (): unknown => request,
      getResponse: (): unknown => ({})
    })
  } as unknown as ArgumentsHost
  const FilterCtor = params?.filterCtor ?? BymaxExceptionFilter
  const correlation = params?.noCorrelation ? undefined : (params?.correlation ?? stubCorrelation())
  const filter = new FilterCtor(
    params?.options ?? normalizeCoreOptions(),
    correlation,
    adapterHost,
    params?.traceContext
  )
  return { filter, host, captured, adapterHost }
}
