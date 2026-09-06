import { getAppConfig, type RetryConfig } from '../config/app-config'
import { redactHeadersForTrace, summarizeBodyForTrace, summarizeErrorForTrace } from '../utils/trace-helpers'
import type { TaskTraceRecorder } from '../utils/task-trace'

export interface ProviderRequest {
  url: string
  headers: Record<string, string>
  body: any
}

export interface ProviderRequestContext {
  sessionId: number
  provider: string
  route: string
  timeoutMs: number
}

export interface ProviderRequesterDeps {
  fetchImpl?: typeof fetch
  logger?: Pick<typeof console, 'warn'>
  retry?: RetryConfig
}

export interface RequestWithBackoffParams {
  request: ProviderRequest
  context: ProviderRequestContext
  onControllerReady?: (controller: AbortController | null) => void
  onControllerClear?: () => void
  traceRecorder?: TaskTraceRecorder | null
  traceContext?: Record<string, unknown>
}

export class ProviderRequester {
  private fetchImpl: typeof fetch
  private logger?: Pick<typeof console, 'warn'>
  private readonly retry: RetryConfig

  constructor(deps: ProviderRequesterDeps = {}) {
    this.fetchImpl = deps.fetchImpl ?? fetch
    this.logger = deps.logger ?? console
    this.retry = { ...(deps.retry ?? getAppConfig().retry) }
  }

  async requestWithBackoff(params: RequestWithBackoffParams): Promise<Response> {
    const ac = new AbortController()
    params.onControllerReady?.(ac)
    const timeout = setTimeout(
      () => ac.abort(new Error('provider request timeout')),
      params.context.timeoutMs,
    )
    const traceRecorder = params.traceRecorder
    const traceContext = params.traceContext || {}
    const logTrace = (eventType: string, payload: Record<string, unknown>) => {
      traceRecorder?.log(eventType, { ...traceContext, ...payload })
    }
    try {
      let attempt = 1
      let response = await this.providerRequestOnce(
        params.request,
        params.context,
        ac.signal,
        logTrace,
        attempt,
      )
      if (response.status === 429) {
        this.logger?.warn?.('Provider rate limited (429), backing off...', { backoffMs: this.retry.upstream429Ms })
        logTrace('http:provider_retry', {
          route: params.context.route,
          attempt,
          status: response.status,
          backoffMs: this.retry.upstream429Ms,
        })
        await new Promise((r) => setTimeout(r, this.retry.upstream429Ms))
        attempt += 1
        response = await this.providerRequestOnce(
          params.request,
          params.context,
          ac.signal,
          logTrace,
          attempt,
        )
      } else if (response.status >= 500) {
        this.logger?.warn?.('Provider 5xx, backing off...', {
          status: response.status,
          backoffMs: this.retry.upstream5xxMs,
        })
        logTrace('http:provider_retry', {
          route: params.context.route,
          attempt,
          status: response.status,
          backoffMs: this.retry.upstream5xxMs,
        })
        await new Promise((r) => setTimeout(r, this.retry.upstream5xxMs))
        attempt += 1
        response = await this.providerRequestOnce(
          params.request,
          params.context,
          ac.signal,
          logTrace,
          attempt,
        )
      }
      return response
    } finally {
      clearTimeout(timeout)
      params.onControllerReady?.(null)
      params.onControllerClear?.()
    }
  }

  private async providerRequestOnce(
    request: ProviderRequest,
    context: ProviderRequestContext,
    signal: AbortSignal,
    logTrace: (eventType: string, payload: Record<string, unknown>) => void,
    attempt: number,
  ): Promise<Response> {
    const serializedBody = JSON.stringify(request.body)

    logTrace('http:provider_request', {
      route: context.route,
      attempt,
      provider: context.provider,
      sessionId: context.sessionId,
      url: request.url,
      timeoutMs: context.timeoutMs,
      headers: redactHeadersForTrace(request.headers),
      body: summarizeBodyForTrace(request.body),
    })

    const startedAt = Date.now()
    try {
      const response = await this.fetchImpl(request.url, {
        method: 'POST',
        headers: request.headers,
        body: serializedBody,
        signal,
      })

      logTrace('http:provider_response', {
        route: context.route,
        attempt,
        provider: context.provider,
        sessionId: context.sessionId,
        url: request.url,
        durationMs: Date.now() - startedAt,
        status: response.status,
        statusText: response.statusText,
        headers: redactHeadersForTrace(response.headers),
      })

      return response
    } catch (error: any) {
      logTrace('http:provider_error', {
        route: context.route,
        attempt,
        provider: context.provider,
        sessionId: context.sessionId,
        url: request.url,
        durationMs: Date.now() - startedAt,
        error: summarizeErrorForTrace(error),
      })
      throw error
    }
  }
}
