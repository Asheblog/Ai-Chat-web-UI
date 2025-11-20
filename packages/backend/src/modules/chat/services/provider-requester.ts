import { BACKOFF_429_MS, BACKOFF_5XX_MS } from '../chat-common'

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

export type LogTrafficFn = (input: {
  category: string
  route: string
  direction: 'inbound' | 'outbound'
  context: Record<string, unknown>
  payload?: any
}) => Promise<void> | void

export interface ProviderRequesterDeps {
  fetchImpl?: typeof fetch
  logTraffic?: LogTrafficFn
  logger?: Pick<typeof console, 'warn'>
}

export interface RequestWithBackoffParams {
  request: ProviderRequest
  context: ProviderRequestContext
  onControllerReady?: (controller: AbortController | null) => void
  onControllerClear?: () => void
}

export class ProviderRequester {
  private fetchImpl: typeof fetch
  private logTraffic?: LogTrafficFn
  private logger?: Pick<typeof console, 'warn'>

  constructor(deps: ProviderRequesterDeps = {}) {
    this.fetchImpl = deps.fetchImpl ?? fetch
    this.logTraffic = deps.logTraffic
    this.logger = deps.logger ?? console
  }

  async requestWithBackoff(params: RequestWithBackoffParams): Promise<Response> {
    const ac = new AbortController()
    params.onControllerReady?.(ac)
    const timeout = setTimeout(
      () => ac.abort(new Error('provider request timeout')),
      params.context.timeoutMs,
    )
    try {
      let response = await this.providerRequestOnce(params.request, params.context, ac.signal)
      if (response.status === 429) {
        this.logger?.warn?.('Provider rate limited (429), backing off...', { backoffMs: BACKOFF_429_MS })
        await new Promise((r) => setTimeout(r, BACKOFF_429_MS))
        response = await this.providerRequestOnce(params.request, params.context, ac.signal)
      } else if (response.status >= 500) {
        this.logger?.warn?.('Provider 5xx, backing off...', {
          status: response.status,
          backoffMs: BACKOFF_5XX_MS,
        })
        await new Promise((r) => setTimeout(r, BACKOFF_5XX_MS))
        response = await this.providerRequestOnce(params.request, params.context, ac.signal)
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
  ): Promise<Response> {
    const serializedBody = JSON.stringify(request.body)

    await this.logTraffic?.({
      category: 'upstream-request',
      route: context.route,
      direction: 'outbound',
      context: {
        sessionId: context.sessionId,
        provider: context.provider,
        url: request.url,
      },
      payload: {
        headers: request.headers,
        body: request.body,
      },
    })

    try {
      const response = await this.fetchImpl(request.url, {
        method: 'POST',
        headers: request.headers,
        body: serializedBody,
        signal,
      })

      await this.logTraffic?.({
        category: 'upstream-response',
        route: context.route,
        direction: 'outbound',
        context: {
          sessionId: context.sessionId,
          provider: context.provider,
          url: request.url,
        },
        payload: {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
        },
      })

      return response
    } catch (error: any) {
      await this.logTraffic?.({
        category: 'upstream-error',
        route: context.route,
        direction: 'outbound',
        context: {
          sessionId: context.sessionId,
          provider: context.provider,
          url: request.url,
        },
        payload: {
          message: error?.message || String(error),
        },
      })
      throw error
    }
  }
}

export const providerRequester = new ProviderRequester()
