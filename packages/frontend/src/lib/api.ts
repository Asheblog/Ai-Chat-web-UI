import axios, {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig
} from 'axios'
import type {
  AuthResponse,
  RegisterResponse,
  User,
  ApiResponse,
  ActorContextDTO,
  ActorQuota,
  Message,
  TaskTraceSummary,
  TaskTraceEventRecord,
  LatexTraceSummary,
  LatexTraceEventRecord,
  SystemSettings,
  ChatShare,
  ChatShareSummary,
  ShareListResponse,
} from '@/types'
import { FrontendLogger as log } from '@/lib/logger'

// API基础配置（统一使用 NEXT_PUBLIC_API_URL，默认使用相对路径 /api，避免浏览器直连 localhost）
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '/api'

type ImageUploadPayload = {
  data: string
  mime: string
}

class ApiClient {
  private client: AxiosInstance
  private streamControllers = new Map<string, AbortController>()
  // 标记避免重复重定向
  private isRedirecting = false

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
      // 允许跨域时携带 Cookie（当 NEXT_PUBLIC_API_URL 为绝对地址且后端已开启 credentials）
      withCredentials: true,
    })

    // 请求拦截器 - 添加认证token & 记录日志
    this.client.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        ;(config as any).metadata = { start: Date.now() }
        // 基于 Cookie 的会话：不再附加 Authorization 头
        log.debug('HTTP Request', config.method?.toUpperCase(), config.baseURL + (config.url || ''), {
          headers: config.headers,
          params: config.params,
        })
        return config
      },
      (error) => {
        return Promise.reject(error)
      }
    )

    // 响应拦截器 - 处理错误 & 记录日志
    this.client.interceptors.response.use(
      (response: AxiosResponse) => {
        const start = (response.config as any).metadata?.start || Date.now()
        log.debug('HTTP Response', response.status, response.statusText, 'in', `${Date.now() - start}ms`, {
          url: response.config.baseURL + (response.config.url || ''),
        })
        return response
      },
      (error) => {
        try {
          const cfg = error.config || {}
          const start = (cfg as any).metadata?.start || Date.now()
          log.error('HTTP Error', error.message, 'in', `${Date.now() - start}ms`, {
            url: (cfg.baseURL || '') + (cfg.url || ''),
            status: error.response?.status,
            data: error.response?.data,
          })
        } catch {}
        if (error.response?.status === 401) this.handleUnauthorized()
        return Promise.reject(error)
      }
    )
  }

  // 统一处理 401：清理凭证与持久化，并跳转登录
  private handleUnauthorized() {
    try {
      if (typeof window !== 'undefined') {
        // 清理 zustand 的持久化存储（仅用户信息）
        try { window.localStorage.removeItem('auth-storage') } catch {}
        if (!this.isRedirecting) {
          this.isRedirecting = true
          window.location.href = '/auth/login'
        }
      }
    } catch {
      // ignore
    }
  }

  // 读取记住登录偏好，决定存储介质（localStorage / sessionStorage）
  // Cookie 会话下无需本地存储 token
  private getPreferredStorage(): Storage | null { return null }
  private getToken(): string | null { return null }
  private clearToken(): void { /* no-op */ }

  // 认证相关API
  async login(username: string, password: string): Promise<AuthResponse> {
    const response = await this.client.post<ApiResponse<AuthResponse>>('/auth/login', {
      username,
      password,
    })
    const { data } = response.data
    if (!data) {
      throw new Error('Invalid login response')
    }
    // token 已通过 Set-Cookie 下发，无需前端存储
    return data
  }

  async register(username: string, password: string): Promise<RegisterResponse> {
    const response = await this.client.post<ApiResponse<RegisterResponse>>('/auth/register', {
      username,
      password,
    })
    const { data } = response.data
    if (!data) {
      throw new Error('Invalid register response')
    }
    // token 已通过 Set-Cookie 下发
    return data
  }

  async getCurrentUser(): Promise<User> {
    const response = await this.client.get<ApiResponse<User>>('/auth/me')
    return response.data.data!
  }

  async getActorContext(): Promise<ActorContextDTO> {
    const response = await this.client.get<ApiResponse<ActorContextDTO>>('/auth/actor')
    return response.data.data!
  }

  async logout(): Promise<void> {
    try { await this.client.post('/auth/logout') } catch {}
    if (typeof window !== 'undefined') {
      window.location.href = '/auth/login'
    }
  }

  // 聊天会话相关API
  async getSessions() {
    const response = await this.client.get<ApiResponse<{ sessions: any[] }>>('/sessions')
    const { data } = response.data
    return { data: data?.sessions || [] }
  }

  async getSession(sessionId: number) {
    const response = await this.client.get<ApiResponse<any>>(`/sessions/${sessionId}`)
    return response.data
  }

  async createSessionByModelId(modelId: string, title?: string, connectionId?: number, rawId?: string, systemPrompt?: string | null) {
    const payload: any = { modelId }
    if (title) payload.title = title
    if (connectionId && rawId) {
      payload.connectionId = connectionId
      payload.rawId = rawId
    }
    if (typeof systemPrompt === 'string') {
      payload.systemPrompt = systemPrompt
    }
    const response = await this.client.post<ApiResponse<any>>('/sessions', payload)
    return response.data
  }

  async getAggregatedModels() {
    const response = await this.client.get<ApiResponse<any[]>>('/catalog/models')
    return response.data
  }

  async updateModelTags(
    connectionId: number,
    rawId: string,
    payload: {
      tags?: Array<{ name: string }>
      capabilities?: Record<string, boolean>
      maxOutputTokens?: number | null
      accessPolicy?: { anonymous?: 'allow' | 'deny' | 'inherit'; user?: 'allow' | 'deny' | 'inherit' } | null
    }
  ) {
    const body: Record<string, any> = { connectionId, rawId }
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'tags')) {
      body.tags = payload.tags
    }
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'capabilities')) {
      body.capabilities = payload.capabilities
    }
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'maxOutputTokens')) {
      body.max_output_tokens = payload.maxOutputTokens
    }
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'accessPolicy')) {
      body.access_policy = payload.accessPolicy
    }
    const response = await this.client.put<ApiResponse<any>>('/catalog/models/tags', body)
    return response.data
  }

  async refreshModelCatalog() {
    const response = await this.client.post<ApiResponse<any>>('/catalog/models/refresh')
    return response.data
  }

  async deleteModelOverrides(items: Array<{ connectionId: number; rawId: string }>) {
    const response = await this.client.delete<ApiResponse<any>>('/catalog/models/tags', { data: { items } })
    return response.data
  }

  async deleteAllModelOverrides() {
    const response = await this.client.delete<ApiResponse<any>>('/catalog/models/tags', { data: { all: true } })
    return response.data
  }

  async getOverrideItems() {
    const response = await this.client.get<ApiResponse<any[]>>('/catalog/models/overrides')
    return response.data
  }

  async getSystemConnections() {
    const response = await this.client.get<ApiResponse<any[]>>('/connections')
    return response.data
  }

  async createSystemConnection(data: any) {
    const response = await this.client.post<ApiResponse<any>>('/connections', data)
    return response.data
  }

  async updateSystemConnection(id: number, data: any) {
    const response = await this.client.put<ApiResponse<any>>(`/connections/${id}`, data)
    return response.data
  }

  async deleteSystemConnection(id: number) {
    const response = await this.client.delete<ApiResponse<any>>(`/connections/${id}`)
    return response.data
  }

  async verifySystemConnection(data: any) {
    const response = await this.client.post<ApiResponse<any>>('/connections/verify', data)
    return response.data
  }

  async deleteSession(sessionId: number) {
    await this.client.delete(`/sessions/${sessionId}`)
  }

  async updateSession(sessionId: number, updates: Partial<{ title: string; reasoningEnabled: boolean; reasoningEffort: 'low'|'medium'|'high'; ollamaThink: boolean; systemPrompt: string | null }>) {
    const response = await this.client.put(`/sessions/${sessionId}`, updates)
    return response.data
  }

  async updateSessionModel(sessionId: number, payload: { modelId: string; connectionId?: number; rawId?: string }) {
    const response = await this.client.put<ApiResponse<any>>(`/sessions/${sessionId}/model`, payload)
    return response.data
  }

  async listChatShares(params?: { sessionId?: number; status?: 'active' | 'all'; page?: number; limit?: number }) {
    const response = await this.client.get<ApiResponse<ShareListResponse>>('/shares', {
      params,
    })
    return response.data
  }

  async createChatShare(payload: { sessionId: number; messageIds: number[]; title?: string; expiresInHours?: number | null }) {
    const response = await this.client.post<ApiResponse<ChatShare>>('/shares', payload)
    return response.data
  }

  async updateChatShare(shareId: number, payload: { title?: string; expiresInHours?: number | null }) {
    const response = await this.client.patch<ApiResponse<ChatShareSummary>>(`/shares/${shareId}`, payload)
    return response.data
  }

  async revokeChatShare(shareId: number) {
    const response = await this.client.post<ApiResponse<ChatShareSummary>>(`/shares/${shareId}/revoke`)
    return response.data
  }

  // 消息相关API
  async getMessages(sessionId: number) {
    const response = await this.client.get<ApiResponse<{ messages: any[] }>>(`/chat/sessions/${sessionId}/messages`)
    const { data } = response.data
    return { data: data?.messages || [] }
  }

  async getMessageProgress(sessionId: number, messageId: number) {
    const response = await this.client.get<ApiResponse<{ message: Message }>>(
      `/chat/sessions/${sessionId}/messages/${messageId}/progress`
    )
    return response.data
  }

  async getMessageByClientId(sessionId: number, clientMessageId: string) {
    const encoded = encodeURIComponent(clientMessageId.trim())
    const response = await this.client.get<ApiResponse<{ message: Message }>>(
      `/chat/sessions/${sessionId}/messages/by-client/${encoded}`
    )
    return response.data
  }

  async sendMessage(sessionId: number, content: string) {
    // 非流式发送后端未提供，推荐使用 streamChat。此函数保留占位，抛出错误以避免误用。
    throw new Error('sendMessage is not supported. Use streamChat instead.')
  }

  // 流式聊天API
  // 流式聊天（带退避+可取消）。429 退避 15s、5xx/超时 退避 2s，最多重试 1 次
  async *streamChat(
    sessionId: number,
    content: string,
    images?: Array<{ data: string; mime: string }>,
    options?: {
      reasoningEnabled?: boolean
      reasoningEffort?: 'low' | 'medium' | 'high'
      ollamaThink?: boolean
      saveReasoning?: boolean
      contextEnabled?: boolean
      clientMessageId?: string
      traceEnabled?: boolean
      replyToMessageId?: number | string
      replyToClientMessageId?: string
      customBody?: Record<string, any>
      customHeaders?: Array<{ name: string; value: string }>
      streamKey?: string
    }
  ): AsyncGenerator<import('@/types').ChatStreamChunk, void, unknown> {
    // API_BASE_URL 已包含 /api 前缀
    const doOnce = async (signal: AbortSignal) => {
      const { replyToMessageId, replyToClientMessageId, ...rest } = options || {}
      const payload: Record<string, any> = {
        sessionId,
        content,
        ...(images ? { images } : {}),
        ...rest,
      }
      if (rest?.customBody) {
        payload.custom_body = rest.customBody
        delete payload.customBody
      }
      if (Array.isArray(rest?.customHeaders)) {
        payload.custom_headers = rest.customHeaders
        delete payload.customHeaders
      }
      if (typeof replyToMessageId === 'number') {
        payload.replyToMessageId = replyToMessageId
      }
      if (typeof replyToClientMessageId === 'string' && replyToClientMessageId.trim().length > 0) {
        payload.replyToClientMessageId = replyToClientMessageId.trim()
      }
      return fetch(`${API_BASE_URL}/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // 明确声明期望 SSE，有助于代理/中间层正确处理为流式
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify(payload),
        signal,
        credentials: 'include',
      })
    }

    const streamKey =
      typeof options?.streamKey === 'string' && options.streamKey.trim().length > 0
        ? options.streamKey.trim()
        : `session:${sessionId}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`
    const controller = new AbortController()
    this.streamControllers.set(streamKey, controller)

    // 建立带退避的请求
    let response = await doOnce(controller.signal)
    if (response.status === 401) {
      this.handleUnauthorized()
      throw new Error('Unauthorized')
    }
    if (response.status === 429) {
      let payload: any = null
      try { payload = await response.json() } catch {}
      const error: any = new Error('Quota exceeded')
      error.status = 429
      error.payload = payload
      throw error
    }
    if (response.status >= 500) {
      await new Promise(r => setTimeout(r, 2000))
      response = await doOnce(controller.signal)
      if (response.status === 401) {
        this.handleUnauthorized()
        throw new Error('Unauthorized')
      }
    }

    if (!response.ok) {
      let payload: any = null
      try { payload = await response.json() } catch {}
      const error: any = new Error(`HTTP error ${response.status}`)
      error.status = response.status
      error.payload = payload
      throw error
    }

    const reader = response.body?.getReader()
    const decoder = new TextDecoder()

    if (!reader) {
      throw new Error('Response body is not readable')
    }

    let buffer = ''
    let completed = false

    try {
      let terminated = false
      while (!terminated) {
        const { done, value } = await reader.read()
        if (value) {
          const decoded = decoder.decode(value, { stream: true })
          buffer += decoded
          if (process.env.NODE_ENV !== 'production') {
            // eslint-disable-next-line no-console
            console.debug('[streamChat] chunk', decoded.slice(0, 120))
          }
          while (true) {
            const newlineIndex = buffer.indexOf('\n')
            if (newlineIndex === -1) break
            const rawLine = buffer.slice(0, newlineIndex)
            buffer = buffer.slice(newlineIndex + 1)
            const line = rawLine.replace(/\r$/, '')
            if (!line || line.startsWith(':')) continue
            if (!line.startsWith('data:')) continue
            const payload = line.slice(5).trimStart()
            if (!payload) continue
            if (payload === '[DONE]') {
              completed = true
              terminated = true
              break
            }
            try {
              const parsed = JSON.parse(payload)
              if (parsed.type === 'content' && parsed.content) {
                yield { type: 'content', content: parsed.content }
              } else if (parsed.type === 'usage' && parsed.usage) {
                yield { type: 'usage', usage: parsed.usage }
              } else if (parsed.type === 'reasoning') {
                const chunk: import('@/types').ChatStreamChunk = { type: 'reasoning', meta: parsed.meta }
                if (parsed.done) {
                  chunk.done = true
                  if (typeof parsed.duration === 'number') chunk.duration = parsed.duration
                } else if (parsed.keepalive) {
                  chunk.keepalive = true
                  if (typeof parsed.idle_ms === 'number') {
                    chunk.idleMs = parsed.idle_ms
                  }
                } else if (typeof parsed.content === 'string') {
                  chunk.content = parsed.content
                }
                if (chunk.done || chunk.keepalive || chunk.content) {
                  yield chunk
                }
              } else if (parsed.type === 'tool') {
                yield {
                  type: 'tool',
                  tool: parsed.tool,
                  stage: parsed.stage,
                  id: parsed.id,
                  query: parsed.query,
                  hits: parsed.hits,
                  error: parsed.error,
                  meta: parsed.meta,
                }
              } else if (parsed.type === 'start') {
                const normalizedMessageId =
                  typeof parsed.messageId === 'number'
                    ? parsed.messageId
                    : typeof parsed.message_id === 'number'
                      ? parsed.message_id
                      : null
                const normalizedAssistantId =
                  typeof parsed.assistantMessageId === 'number'
                    ? parsed.assistantMessageId
                    : typeof parsed.assistant_message_id === 'number'
                      ? parsed.assistant_message_id
                      : null
                const normalizedAssistantClientId =
                  typeof parsed.assistantClientMessageId === 'string'
                    ? parsed.assistantClientMessageId
                    : typeof parsed.assistant_client_message_id === 'string'
                      ? parsed.assistant_client_message_id
                      : undefined
                yield {
                  type: 'start',
                  messageId: normalizedMessageId,
                  assistantMessageId: normalizedAssistantId,
                  assistantClientMessageId: normalizedAssistantClientId ?? null,
                }
              } else if (parsed.type === 'end') {
                yield { type: 'end' }
              } else if (parsed.type === 'stop') {
                // ignore
              } else if (parsed.type === 'complete') {
                completed = true
                yield { type: 'complete' }
              } else if (parsed.type === 'quota' && parsed.quota) {
                yield { type: 'quota', quota: parsed.quota }
              } else if (parsed.type === 'error') {
                const message =
                  typeof parsed.error === 'string' && parsed.error.trim()
                    ? parsed.error
                    : '联网搜索失败，请稍后重试'
                yield { type: 'error', error: message }
              } else if (parsed.error) {
                throw new Error(parsed.error)
              }
            } catch (e) {
              if (process.env.NODE_ENV !== 'production') {
                // eslint-disable-next-line no-console
                console.debug('[streamChat] JSON parse ignore:', e)
              }
            }
          }
        }
        if (done) break
      }
    } finally {
      reader.releaseLock()
      this.streamControllers.delete(streamKey)
    }

    if (!completed) {
      const error: any = new Error('Stream closed before completion')
      error.code = 'STREAM_INCOMPLETE'
      throw error
    }
  }

  cancelStream(streamKey?: string) {
    if (streamKey) {
      const controller = this.streamControllers.get(streamKey)
      if (controller) {
        try { controller.abort() } catch {}
        this.streamControllers.delete(streamKey)
      }
      return
    }
    this.streamControllers.forEach((controller) => {
      try { controller.abort() } catch {}
    })
    this.streamControllers.clear()
  }

  async cancelAgentStream(
    sessionId: number,
    options?: { clientMessageId?: string | null; messageId?: number | string | null },
  ) {
    const payload: Record<string, unknown> = { sessionId }
    const clientMessageId = options?.clientMessageId
    const messageIdRaw = options?.messageId
    if (clientMessageId) {
      payload.clientMessageId = clientMessageId
    }
    if (typeof messageIdRaw === 'number' && Number.isFinite(messageIdRaw)) {
      payload.messageId = messageIdRaw
    } else if (typeof messageIdRaw === 'string' && messageIdRaw.trim()) {
      const numeric = Number(messageIdRaw)
      if (Number.isFinite(numeric)) {
        payload.messageId = numeric
      }
    }
    if (!payload.clientMessageId && typeof payload.messageId !== 'number') {
      return
    }
    try {
      await this.client.post('/chat/stream/cancel', payload)
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.debug('[cancelAgentStream] ignore error', (error as any)?.message || error)
      }
    }
  }

  // 非流式接口：失败退避策略同上
  async chatCompletion(sessionId: number, content: string, images?: Array<{ data: string; mime: string }>, options?: { reasoningEnabled?: boolean; reasoningEffort?: 'low'|'medium'|'high'; ollamaThink?: boolean; saveReasoning?: boolean; contextEnabled?: boolean; clientMessageId?: string; customBody?: Record<string, any>; customHeaders?: Array<{ name: string; value: string }> }): Promise<ApiResponse<{ content: string; usage: any; quota?: ActorQuota }>> {
    const buildPayload = () => {
      const payload: Record<string, any> = { sessionId, content, images, ...(options || {}) }
      if (options?.customBody) {
        payload.custom_body = options.customBody
        delete payload.customBody
      }
      if (Array.isArray(options?.customHeaders)) {
        payload.custom_headers = options.customHeaders
        delete payload.customHeaders
      }
      return payload
    }
    const doOnce = () => this.client.post<ApiResponse<{ content: string; usage: any; quota?: ActorQuota }>>('/chat/completion', buildPayload())
    try {
      let res = await doOnce()
      if (res.status === 429) {
        const error: any = new Error('Quota exceeded')
        error.status = 429
        error.response = res
        throw error
      } else if (res.status >= 500) {
        await new Promise(r => setTimeout(r, 2000))
        res = await doOnce()
      }
      return res.data
    } catch (e) {
      throw e
    }
  }

  async getUsage(sessionId: number) {
    const response = await this.client.get<import('@/types').ApiResponse<any>>(`/chat/usage`, { params: { sessionId } })
    return response.data
  }

  async getSessionsUsage() {
    const response = await this.client.get<import('@/types').ApiResponse<import('@/types').SessionUsageTotalsItem[]>>(`/chat/sessions/usage`)
    return response.data
  }

  // 按日统计导出（JSON）接口仅用于 CSV 导出；现已移除对应前端功能，保留后端接口以兼容其他潜在用途。

  // 旧的模型配置接口已移除：请改用连接 + 聚合模型

  // 系统设置相关API (仅管理员)
  async getSystemSettings() {
    // 仅获取系统设置；系统模型改用聚合模型（/catalog/models）
    const settingsRes = await this.client.get<ApiResponse<{ 
        registration_enabled?: boolean;
        brand_text?: string;
        sse_heartbeat_interval_ms?: number;
        provider_max_idle_ms?: number;
        provider_timeout_ms?: number;
        provider_initial_grace_ms?: number;
        provider_reasoning_idle_ms?: number;
        reasoning_keepalive_interval_ms?: number;
        usage_emit?: boolean;
        usage_provider_only?: boolean;
        reasoning_enabled?: boolean;
        reasoning_default_expand?: boolean;
        reasoning_save_to_db?: boolean;
        reasoning_tags_mode?: 'default' | 'custom' | 'off';
        reasoning_custom_tags?: string;
        stream_delta_chunk_size?: number;
        openai_reasoning_effort?: 'low' | 'medium' | 'high',
        ollama_think?: boolean,
        chat_image_retention_days?: number | string,
        site_base_url?: string,
        anonymous_retention_days?: number | string,
        anonymous_daily_quota?: number | string,
        default_user_daily_quota?: number | string,
        web_search_agent_enable?: boolean,
        web_search_default_engine?: string,
        web_search_result_limit?: number | string,
        web_search_domain_filter?: string[] | string,
        web_search_has_api_key?: boolean,
      }>>('/settings/system')
    const parseOptionalInt = (value: unknown): number | undefined => {
      if (value === null || typeof value === 'undefined') return undefined
      if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
      if (typeof value === 'string') {
        const trimmed = value.trim()
        if (trimmed === '') return undefined
        const parsed = Number.parseInt(trimmed, 10)
        if (Number.isFinite(parsed)) return parsed
      }
      return undefined
    }
    const raw: any = settingsRes.data.data || {}
    const allowRegistration = !!raw.registration_enabled
    const brandText = raw.brand_text || 'AIChat'
    const systemModels: any[] = []
    const sseHeartbeatIntervalMs = Number(raw.sse_heartbeat_interval_ms ?? 15000)
    const providerMaxIdleMs = Number(raw.provider_max_idle_ms ?? 60000)
    const providerTimeoutMs = Number(raw.provider_timeout_ms ?? 300000)
    const providerInitialGraceMs = Number(raw.provider_initial_grace_ms ?? 120000)
    const providerReasoningIdleMs = Number(raw.provider_reasoning_idle_ms ?? 300000)
    const reasoningKeepaliveIntervalMs = Number(raw.reasoning_keepalive_interval_ms ?? 0)
    const usageEmit = (raw.usage_emit ?? true) as boolean
    const usageProviderOnly = (raw.usage_provider_only ?? false) as boolean
    const reasoningEnabled = (raw.reasoning_enabled ?? true) as boolean
    const reasoningDefaultExpand = (raw.reasoning_default_expand ?? false) as boolean
    const reasoningSaveToDb = (raw.reasoning_save_to_db ?? true) as boolean
    const reasoningTagsMode = (raw.reasoning_tags_mode ?? 'default') as any
    const reasoningCustomTags = (raw.reasoning_custom_tags ?? '') as string
    const streamDeltaChunkSize = Number(raw.stream_delta_chunk_size ?? 1)
    const streamDeltaFlushIntervalMs = (() => {
      const parsed = parseOptionalInt(raw.stream_delta_flush_interval_ms)
      return typeof parsed === 'number' ? Math.max(0, parsed) : undefined
    })()
    const streamReasoningFlushIntervalMs = (() => {
      const parsed = parseOptionalInt(raw.stream_reasoning_flush_interval_ms)
      return typeof parsed === 'number' ? Math.max(0, parsed) : undefined
    })()
    const streamKeepaliveIntervalMs = (() => {
      const parsed = parseOptionalInt(raw.stream_keepalive_interval_ms)
      return typeof parsed === 'number' ? Math.max(0, parsed) : undefined
    })()
    const openaiReasoningEffort = (raw.openai_reasoning_effort ?? '') as any
    const reasoningMaxOutputTokensDefault = (() => {
      const parsed = parseOptionalInt(raw.reasoning_max_output_tokens_default as any)
      if (typeof parsed === 'number' && parsed > 0) {
        return Math.min(256000, parsed)
      }
      return undefined
    })()
    const ollamaThink = Boolean(raw.ollama_think ?? false)
    const chatImageRetentionDays = (() => {
      const v = raw.chat_image_retention_days
      if (typeof v === 'number') return v
      if (typeof v === 'string' && v.trim() !== '') {
        const parsed = Number.parseInt(v, 10)
        if (Number.isFinite(parsed) && parsed >= 0) return parsed
      }
      return 30
    })()
    const anonymousRetentionDays = (() => {
      const v = raw.anonymous_retention_days
      if (typeof v === 'number') return Math.max(0, Math.min(15, v))
      if (typeof v === 'string' && v.trim() !== '') {
        const parsed = Number.parseInt(v, 10)
        if (Number.isFinite(parsed)) {
          return Math.max(0, Math.min(15, parsed))
        }
      }
      return 15
    })()
    const anonymousDailyQuota = (() => {
      const v = raw.anonymous_daily_quota
      if (typeof v === 'number') return Math.max(0, v)
      if (typeof v === 'string' && v.trim() !== '') {
        const parsed = Number.parseInt(v, 10)
        if (Number.isFinite(parsed)) return Math.max(0, parsed)
      }
      return 20
    })()
    const defaultUserDailyQuota = (() => {
      const v = raw.default_user_daily_quota
      if (typeof v === 'number') return Math.max(0, v)
      if (typeof v === 'string' && v.trim() !== '') {
        const parsed = Number.parseInt(v, 10)
        if (Number.isFinite(parsed)) return Math.max(0, parsed)
      }
      return 200
    })()
    const modelAccessDefaultAnonymous: 'allow' | 'deny' =
      raw.model_access_default_anonymous === 'allow' ? 'allow' : 'deny'
    const modelAccessDefaultUser: 'allow' | 'deny' =
      raw.model_access_default_user === 'deny' ? 'deny' : 'allow'
    const siteBaseUrl = typeof raw.site_base_url === 'string' ? raw.site_base_url : ''
    const webSearchAgentEnable = Boolean(raw.web_search_agent_enable ?? false)
    const webSearchDefaultEngine = raw.web_search_default_engine || 'tavily'
    const webSearchResultLimit = Number(raw.web_search_result_limit ?? 4)
    const webSearchDomainFilter = Array.isArray(raw.web_search_domain_filter)
      ? (raw.web_search_domain_filter as string[])
      : []
    const webSearchHasApiKey = Boolean(raw.web_search_has_api_key ?? false)
    const webSearchHasApiKeyTavily = Boolean(raw.web_search_has_api_key_tavily ?? webSearchHasApiKey)
    const webSearchHasApiKeyBrave = Boolean(raw.web_search_has_api_key_brave ?? webSearchHasApiKey)
    const webSearchHasApiKeyMetaso = Boolean(raw.web_search_has_api_key_metaso ?? webSearchHasApiKey)
    const aggregatedHasKey =
      webSearchHasApiKeyTavily || webSearchHasApiKeyBrave || webSearchHasApiKeyMetaso || webSearchHasApiKey
    const webSearchScope =
      typeof raw.web_search_scope === 'string'
        ? raw.web_search_scope
        : 'webpage'
    const webSearchIncludeSummary = Boolean(raw.web_search_include_summary ?? false)
    const webSearchIncludeRaw = Boolean(raw.web_search_include_raw ?? false)
    const assistantAvatarUrl = (() => {
      const value = raw.assistant_avatar_url
      if (typeof value === 'string' && value.trim().length > 0) return value
      if (value === null) return null
      return null
    })()
    const chatSystemPrompt = typeof raw.chat_system_prompt === 'string' ? raw.chat_system_prompt : ''
    const taskTraceEnabled = Boolean(raw.task_trace_enabled ?? false)
    const taskTraceDefaultOn = Boolean(raw.task_trace_default_on ?? false)
    const taskTraceAdminOnly = (raw.task_trace_admin_only ?? true) as boolean
    const rawEnv = (raw.task_trace_env || '').toLowerCase()
    const taskTraceEnv: 'dev' | 'prod' | 'both' = rawEnv === 'prod' || rawEnv === 'both' ? (rawEnv as 'prod' | 'both') : 'dev'
    const taskTraceRetentionDays = (() => {
      const v = raw.task_trace_retention_days
      if (typeof v === 'number') return Math.max(1, Math.min(365, v))
      if (typeof v === 'string' && v.trim() !== '') {
        const parsed = Number.parseInt(v, 10)
        if (Number.isFinite(parsed)) return Math.max(1, Math.min(365, parsed))
      }
      return 7
    })()
    const taskTraceMaxEvents = (() => {
      const v = raw.task_trace_max_events
      if (typeof v === 'number') return Math.max(100, Math.min(200000, v))
      if (typeof v === 'string' && v.trim() !== '') {
        const parsed = Number.parseInt(v, 10)
        if (Number.isFinite(parsed)) return Math.max(100, Math.min(200000, parsed))
      }
      return 2000
    })()
    const taskTraceIdleTimeoutMs = (() => {
      const v = raw.task_trace_idle_timeout_ms
      if (typeof v === 'number') return Math.max(1000, Math.min(600000, v))
      if (typeof v === 'string' && v.trim() !== '') {
        const parsed = Number.parseInt(v, 10)
        if (Number.isFinite(parsed)) return Math.max(1000, Math.min(600000, parsed))
      }
      return 30000
    })()
    const chatMaxConcurrentStreams = (() => {
      const v = raw.chat_max_concurrent_streams
      if (typeof v === 'number') return Math.max(1, Math.min(8, v))
      if (typeof v === 'string' && v.trim() !== '') {
        const parsed = Number.parseInt(v, 10)
        if (Number.isFinite(parsed)) return Math.max(1, Math.min(8, parsed))
      }
      return 1
    })()
    return {
      data: {
        allowRegistration,
        brandText,
        systemModels,
        sseHeartbeatIntervalMs,
        providerMaxIdleMs,
        providerTimeoutMs,
        providerInitialGraceMs,
        providerReasoningIdleMs,
        reasoningKeepaliveIntervalMs,
        usageEmit,
        usageProviderOnly,
        reasoningEnabled,
        reasoningDefaultExpand,
        reasoningSaveToDb,
        reasoningTagsMode,
        reasoningCustomTags,
        streamDeltaChunkSize,
        streamDeltaFlushIntervalMs,
        streamReasoningFlushIntervalMs,
        streamKeepaliveIntervalMs,
        openaiReasoningEffort,
        reasoningMaxOutputTokensDefault,
        ollamaThink,
        chatImageRetentionDays,
        assistantReplyHistoryLimit: Number(raw.assistant_reply_history_limit ?? 5),
        siteBaseUrl,
        anonymousRetentionDays,
        anonymousDailyQuota,
        defaultUserDailyQuota,
        modelAccessDefaultAnonymous,
        modelAccessDefaultUser,
        webSearchAgentEnable,
        webSearchDefaultEngine,
        webSearchResultLimit,
        webSearchDomainFilter,
        webSearchHasApiKey: aggregatedHasKey,
        webSearchHasApiKeyTavily,
        webSearchHasApiKeyBrave,
        webSearchHasApiKeyMetaso,
        webSearchScope,
        webSearchIncludeSummary,
        webSearchIncludeRaw,
        assistantAvatarUrl,
        chatSystemPrompt,
        taskTraceEnabled,
        taskTraceDefaultOn,
        taskTraceAdminOnly,
        taskTraceEnv,
        taskTraceRetentionDays,
        taskTraceMaxEvents,
        taskTraceIdleTimeoutMs,
        chatMaxConcurrentStreams,
      } as any,
    }
  }

  async getPublicBranding() {
    const response = await this.client.get<ApiResponse<{ brand_text?: string }>>('/settings/branding')
    return response.data
  }

  async updateSystemSettings(
    settings: Partial<SystemSettings> & {
      assistantAvatarUpload?: ImageUploadPayload | null
      assistantAvatarRemove?: boolean
    },
  ) {
    const { assistantAvatarUpload, assistantAvatarRemove, ...rest } = settings
    const payload: any = {}
    if (typeof rest.allowRegistration === 'boolean') payload.registration_enabled = !!rest.allowRegistration
    if (typeof rest.brandText === 'string') payload.brand_text = rest.brandText
    if (typeof rest.sseHeartbeatIntervalMs === 'number') payload.sse_heartbeat_interval_ms = rest.sseHeartbeatIntervalMs
    if (typeof rest.providerMaxIdleMs === 'number') payload.provider_max_idle_ms = rest.providerMaxIdleMs
    if (typeof rest.providerTimeoutMs === 'number') payload.provider_timeout_ms = rest.providerTimeoutMs
    if (typeof rest.providerInitialGraceMs === 'number') payload.provider_initial_grace_ms = rest.providerInitialGraceMs
    if (typeof rest.providerReasoningIdleMs === 'number') payload.provider_reasoning_idle_ms = rest.providerReasoningIdleMs
    if (typeof rest.reasoningKeepaliveIntervalMs === 'number') payload.reasoning_keepalive_interval_ms = rest.reasoningKeepaliveIntervalMs
    if (typeof rest.usageEmit === 'boolean') payload.usage_emit = !!rest.usageEmit
    if (typeof rest.usageProviderOnly === 'boolean') payload.usage_provider_only = !!rest.usageProviderOnly
    if (typeof rest.chatSystemPrompt === 'string') payload.chat_system_prompt = rest.chatSystemPrompt
    if (typeof rest.reasoningEnabled === 'boolean') payload.reasoning_enabled = !!rest.reasoningEnabled
    if (typeof rest.reasoningDefaultExpand === 'boolean') payload.reasoning_default_expand = !!rest.reasoningDefaultExpand
    if (typeof rest.reasoningSaveToDb === 'boolean') payload.reasoning_save_to_db = !!rest.reasoningSaveToDb
    if (typeof rest.reasoningTagsMode === 'string') payload.reasoning_tags_mode = rest.reasoningTagsMode
    if (typeof rest.reasoningCustomTags === 'string') payload.reasoning_custom_tags = rest.reasoningCustomTags
    if (typeof rest.streamDeltaChunkSize === 'number') payload.stream_delta_chunk_size = rest.streamDeltaChunkSize
    if (typeof rest.streamDeltaFlushIntervalMs === 'number') payload.stream_delta_flush_interval_ms = rest.streamDeltaFlushIntervalMs
    if (typeof rest.streamReasoningFlushIntervalMs === 'number') payload.stream_reasoning_flush_interval_ms = rest.streamReasoningFlushIntervalMs
    if (typeof rest.streamKeepaliveIntervalMs === 'number') payload.stream_keepalive_interval_ms = rest.streamKeepaliveIntervalMs
    if (typeof rest.openaiReasoningEffort === 'string') payload.openai_reasoning_effort = rest.openaiReasoningEffort
    if (Object.prototype.hasOwnProperty.call(rest, 'reasoningMaxOutputTokensDefault')) {
      if (typeof rest.reasoningMaxOutputTokensDefault === 'number') {
        payload.reasoning_max_output_tokens_default = rest.reasoningMaxOutputTokensDefault
      } else if (rest.reasoningMaxOutputTokensDefault === null) {
        payload.reasoning_max_output_tokens_default = null
      }
    }
    if (typeof rest.ollamaThink === 'boolean') payload.ollama_think = !!rest.ollamaThink
    if (typeof rest.chatImageRetentionDays === 'number') payload.chat_image_retention_days = rest.chatImageRetentionDays
    if (typeof rest.assistantReplyHistoryLimit === 'number') payload.assistant_reply_history_limit = rest.assistantReplyHistoryLimit
    if (typeof rest.siteBaseUrl === 'string') payload.site_base_url = rest.siteBaseUrl
    if (typeof rest.anonymousRetentionDays === 'number') payload.anonymous_retention_days = rest.anonymousRetentionDays
    if (typeof rest.anonymousDailyQuota === 'number') payload.anonymous_daily_quota = rest.anonymousDailyQuota
    if (typeof rest.defaultUserDailyQuota === 'number') payload.default_user_daily_quota = rest.defaultUserDailyQuota
    if (typeof rest.modelAccessDefaultAnonymous === 'string')
      payload.model_access_default_anonymous = rest.modelAccessDefaultAnonymous
    if (typeof rest.modelAccessDefaultUser === 'string') payload.model_access_default_user = rest.modelAccessDefaultUser
    if (typeof rest.webSearchAgentEnable === 'boolean') payload.web_search_agent_enable = rest.webSearchAgentEnable
    if (typeof rest.webSearchDefaultEngine === 'string') payload.web_search_default_engine = rest.webSearchDefaultEngine
    if (typeof rest.webSearchResultLimit === 'number') payload.web_search_result_limit = rest.webSearchResultLimit
    if (Array.isArray(rest.webSearchDomainFilter)) payload.web_search_domain_filter = rest.webSearchDomainFilter
    if (typeof rest.webSearchScope === 'string') payload.web_search_scope = rest.webSearchScope
    if (typeof rest.webSearchIncludeSummary === 'boolean') payload.web_search_include_summary = rest.webSearchIncludeSummary
    if (typeof rest.webSearchIncludeRaw === 'boolean') payload.web_search_include_raw = rest.webSearchIncludeRaw
    if (typeof rest.webSearchApiKeyTavily === 'string') payload.web_search_api_key_tavily = rest.webSearchApiKeyTavily
    if (typeof rest.webSearchApiKeyBrave === 'string') payload.web_search_api_key_brave = rest.webSearchApiKeyBrave
    if (typeof rest.webSearchApiKeyMetaso === 'string') payload.web_search_api_key_metaso = rest.webSearchApiKeyMetaso
    if (typeof rest.webSearchApiKeyTavily === 'string') payload.web_search_api_key_tavily = rest.webSearchApiKeyTavily
    if (typeof rest.webSearchApiKeyBrave === 'string') payload.web_search_api_key_brave = rest.webSearchApiKeyBrave
    if (typeof rest.webSearchApiKeyMetaso === 'string') payload.web_search_api_key_metaso = rest.webSearchApiKeyMetaso
    if (typeof (rest as any).webSearchApiKey === 'string') payload.web_search_api_key = (rest as any).webSearchApiKey
    if (typeof rest.taskTraceEnabled === 'boolean') payload.task_trace_enabled = rest.taskTraceEnabled
    if (typeof rest.taskTraceDefaultOn === 'boolean') payload.task_trace_default_on = rest.taskTraceDefaultOn
    if (typeof rest.taskTraceAdminOnly === 'boolean') payload.task_trace_admin_only = rest.taskTraceAdminOnly
    if (typeof rest.taskTraceEnv === 'string') payload.task_trace_env = rest.taskTraceEnv
    if (typeof rest.taskTraceRetentionDays === 'number') payload.task_trace_retention_days = rest.taskTraceRetentionDays
    if (typeof rest.taskTraceMaxEvents === 'number') payload.task_trace_max_events = rest.taskTraceMaxEvents
    if (typeof rest.taskTraceIdleTimeoutMs === 'number') payload.task_trace_idle_timeout_ms = rest.taskTraceIdleTimeoutMs
    if (typeof rest.chatMaxConcurrentStreams === 'number') {
      payload.chat_max_concurrent_streams = Math.max(1, Math.min(8, Math.floor(rest.chatMaxConcurrentStreams)))
    }
    if (assistantAvatarUpload) {
      payload.assistant_avatar = assistantAvatarUpload
    } else if (assistantAvatarRemove) {
      payload.assistant_avatar = null
    }
    await this.client.put<ApiResponse<any>>('/settings/system', payload)
    // 返回更新后的设置（与 getSystemSettings 保持一致）
    const current = await this.getSystemSettings()
    return current
  }

  async updatePersonalSettings(
    settings: {
      preferredModel?: { modelId: string; connectionId: number | null; rawId: string | null } | null
      avatar?: ImageUploadPayload | null
      username?: string
    },
    signal?: AbortSignal,
  ) {
    const payload: any = {}
    if (Object.prototype.hasOwnProperty.call(settings, 'preferredModel')) {
      const pref = settings.preferredModel
      payload.preferred_model = pref
        ? {
            modelId: pref.modelId,
            connectionId: pref.connectionId,
            rawId: pref.rawId,
          }
        : null
    }
    if (Object.prototype.hasOwnProperty.call(settings, 'avatar')) {
      payload.avatar = settings.avatar ?? null
    }
    if (Object.prototype.hasOwnProperty.call(settings, 'username')) {
      payload.username = settings.username
    }
    const response = await this.client.put<ApiResponse<any>>('/settings/personal', payload, { signal })
    return response.data?.data
  }

  async syncAnonymousQuota(options?: { resetUsed?: boolean }) {
    const response = await this.client.post<ApiResponse<any>>('/settings/system/anonymous-quota/reset', {
      resetUsed: options?.resetUsed ?? false,
    })
    return response.data
  }

  async refreshImageAttachments() {
    const res = await this.client.post<ApiResponse<{ baseUrl: string; attachments: number; samples: Array<{ id: number; messageId: number; url: string }>; refreshedAt: string }>>('/chat/admin/attachments/refresh')
    return res.data
  }

  async getUsers(params?: { page?: number; limit?: number; search?: string; status?: 'PENDING' | 'ACTIVE' | 'DISABLED' }) {
    const response = await this.client.get<ApiResponse<{ users: Array<{ id: number; username: string; role: 'ADMIN'|'USER'; status: 'PENDING'|'ACTIVE'|'DISABLED'; createdAt: string; approvedAt: string | null; approvedById: number | null; rejectedAt: string | null; rejectedById: number | null; rejectionReason: string | null; _count?: { chatSessions: number; connections: number } }>; pagination: { page: number; limit: number; total: number; totalPages: number } }>>('/users', { params })
    return response.data
  }

  async updateUserRole(userId: number, role: 'ADMIN' | 'USER') {
    const response = await this.client.put(`/users/${userId}/role`, { role })
    return response.data
  }

  async approveUser(userId: number) {
    const response = await this.client.post<ApiResponse<any>>(`/users/${userId}/approve`)
    return response.data
  }

  async rejectUser(userId: number, reason?: string) {
    const payload: { reason?: string } = {}
    if (reason && reason.trim()) {
      payload.reason = reason.trim()
    }
    const response = await this.client.post<ApiResponse<any>>(`/users/${userId}/reject`, payload)
    return response.data
  }

  async updateUserStatus(userId: number, status: 'ACTIVE' | 'DISABLED', reason?: string) {
    const payload: { status: 'ACTIVE' | 'DISABLED'; reason?: string } = { status }
    if (reason && reason.trim()) {
      payload.reason = reason.trim()
    }
    const response = await this.client.post<ApiResponse<any>>(`/users/${userId}/status`, payload)
    return response.data
  }

  async deleteUser(userId: number) {
    await this.client.delete(`/users/${userId}`)
  }

  async getUserQuota(userId: number) {
    const response = await this.client.get<ApiResponse<{ quota: ActorQuota }>>(`/users/${userId}/quota`)
    return response.data
  }

  async updateUserQuota(userId: number, options: { dailyLimit: number | null; resetUsed?: boolean }) {
    const response = await this.client.put<ApiResponse<{ quota: ActorQuota }>>(`/users/${userId}/quota`, options)
    return response.data
  }

  async getTaskTraces(params?: { page?: number; pageSize?: number; sessionId?: number; status?: string; keyword?: string }) {
    const response = await this.client.get<ApiResponse<{ items: TaskTraceSummary[]; total: number; page: number; pageSize: number }>>('/task-trace', {
      params,
    })
    return response.data
  }

  async getTaskTrace(id: number) {
    const response = await this.client.get<ApiResponse<{ trace: TaskTraceSummary; latexTrace: LatexTraceSummary | null; events: TaskTraceEventRecord[]; truncated: boolean }>>(
      `/task-trace/${id}`
    )
    return response.data
  }

  async exportTaskTrace(id: number) {
    const response = await this.client.get(`/task-trace/${id}/export`, { responseType: 'blob' })
    return response.data as Blob
  }

  async cleanupTaskTraces(retentionDays?: number) {
    const payload = typeof retentionDays === 'number' ? { retentionDays } : {}
    const response = await this.client.post<ApiResponse<{ deleted: number; retentionDays: number }>>('/task-trace/cleanup', payload)
    return response.data
  }

  async deleteAllTaskTraces() {
    const response = await this.client.delete<ApiResponse<{ deleted: number }>>('/task-trace/all')
    return response.data
  }

  async deleteTaskTrace(id: number) {
    const response = await this.client.delete<ApiResponse<any>>(`/task-trace/${id}`)
    return response.data
  }

  async getLatexTrace(taskTraceId: number) {
    const response = await this.client.get<ApiResponse<{ latexTrace: LatexTraceSummary }>>(`/task-trace/${taskTraceId}/latex`)
    return response.data
  }

  async getLatexTraceEvents(taskTraceId: number) {
    const response = await this.client.get<ApiResponse<{ events: LatexTraceEventRecord[]; truncated: boolean }>>(`/task-trace/${taskTraceId}/latex/events`)
    return response.data
  }

  async exportLatexTrace(taskTraceId: number) {
    const response = await this.client.get(`/task-trace/${taskTraceId}/latex/export`, { responseType: 'blob' })
    return response.data as Blob
  }

  async deleteLatexTrace(taskTraceId: number) {
    const response = await this.client.delete<ApiResponse<any>>(`/task-trace/${taskTraceId}/latex`)
    return response.data
  }

  // 修改密码
  async changePassword(currentPassword: string, newPassword: string) {
    const response = await this.client.put<ApiResponse<any>>('/auth/password', { currentPassword, newPassword })
    return response.data
  }

  // 旧系统模型接口已移除
}

export const apiClient = new ApiClient()
export default apiClient
