import axios, {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig
} from 'axios'
import { AuthResponse, User, ApiResponse } from '@/types'
import { FrontendLogger as log } from '@/lib/logger'

// API基础配置（统一使用 NEXT_PUBLIC_API_URL，默认使用相对路径 /api，避免浏览器直连 localhost）
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '/api'

class ApiClient {
  private client: AxiosInstance
  private currentStreamController: AbortController | null = null
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

  async register(username: string, password: string): Promise<AuthResponse> {
    const response = await this.client.post<ApiResponse<AuthResponse>>('/auth/register', {
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

  async createSessionByModelId(modelId: string, title?: string, connectionId?: number, rawId?: string) {
    const payload: any = { modelId }
    if (title) payload.title = title
    if (connectionId && rawId) {
      payload.connectionId = connectionId
      payload.rawId = rawId
    }
    const response = await this.client.post<ApiResponse<any>>('/sessions', payload)
    return response.data
  }

  async getAggregatedModels() {
    const response = await this.client.get<ApiResponse<any[]>>('/catalog/models')
    return response.data
  }

  async updateModelTags(connectionId: number, rawId: string, tags: Array<{ name: string }>) {
    const response = await this.client.put<ApiResponse<any>>('/catalog/models/tags', { connectionId, rawId, tags })
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

  async getUserConnections() {
    const response = await this.client.get<ApiResponse<any[]>>('/connections/user')
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

  async createUserConnection(data: any) {
    const response = await this.client.post<ApiResponse<any>>('/connections/user', data)
    return response.data
  }

  async updateUserConnection(id: number, data: any) {
    const response = await this.client.put<ApiResponse<any>>(`/connections/user/${id}`, data)
    return response.data
  }

  async deleteUserConnection(id: number) {
    const response = await this.client.delete<ApiResponse<any>>(`/connections/user/${id}`)
    return response.data
  }

  async deleteSession(sessionId: number) {
    await this.client.delete(`/sessions/${sessionId}`)
  }

  async updateSession(sessionId: number, updates: Partial<{ title: string; reasoningEnabled: boolean; reasoningEffort: 'low'|'medium'|'high'; ollamaThink: boolean }>) {
    const response = await this.client.put(`/sessions/${sessionId}`, updates)
    return response.data
  }

  async updateSessionModel(sessionId: number, modelId: string) {
    const response = await this.client.put<ApiResponse<any>>(`/sessions/${sessionId}/model`, { modelId })
    return response.data
  }

  // 消息相关API
  async getMessages(sessionId: number) {
    // 与后端路由对齐：GET /api/chat/sessions/:sessionId/messages
    const response = await this.client.get<ApiResponse<{ messages: any[] }>>(`/chat/sessions/${sessionId}/messages`)
    const { data } = response.data
    return { data: data?.messages || [] }
  }

  async sendMessage(sessionId: number, content: string) {
    // 非流式发送后端未提供，推荐使用 streamChat。此函数保留占位，抛出错误以避免误用。
    throw new Error('sendMessage is not supported. Use streamChat instead.')
  }

  // 流式聊天API
  // 流式聊天（带退避+可取消）。429 退避 15s、5xx/超时 退避 2s，最多重试 1 次
  async *streamChat(sessionId: number, content: string, images?: Array<{ data: string; mime: string }>, options?: { reasoningEnabled?: boolean; reasoningEffort?: 'low'|'medium'|'high'; ollamaThink?: boolean; saveReasoning?: boolean; clientMessageId?: string }): AsyncGenerator<import('@/types').ChatStreamChunk, void, unknown> {
    // API_BASE_URL 已包含 /api 前缀
    const doOnce = async (signal: AbortSignal) => fetch(`${API_BASE_URL}/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // 明确声明期望 SSE，有助于代理/中间层正确处理为流式
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify({ sessionId, content, images, ...(options||{}) }),
      signal,
      credentials: 'include',
    })

    // 建立带退避的请求
    this.currentStreamController?.abort();
    this.currentStreamController = new AbortController();
    let response = await doOnce(this.currentStreamController.signal)
    if (response.status === 401) {
      this.handleUnauthorized()
      throw new Error('Unauthorized')
    }
    if (response.status === 429) {
      await new Promise(r => setTimeout(r, 15000))
      response = await doOnce(this.currentStreamController.signal)
      if (response.status === 401) {
        this.handleUnauthorized()
        throw new Error('Unauthorized')
      }
    } else if (response.status >= 500) {
      await new Promise(r => setTimeout(r, 2000))
      response = await doOnce(this.currentStreamController.signal)
      if (response.status === 401) {
        this.handleUnauthorized()
        throw new Error('Unauthorized')
      }
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const reader = response.body?.getReader()
    const decoder = new TextDecoder()

    if (!reader) {
      throw new Error('Response body is not readable')
    }

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')
        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          console.debug('[streamChat] chunk', chunk.slice(0, 120))
        }

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') {
              return
            }
            try {
              const parsed = JSON.parse(data)
              // 标准化事件
              if (parsed.type === 'content' && parsed.content) {
                yield { type: 'content', content: parsed.content }
              } else if (parsed.type === 'usage' && parsed.usage) {
                yield { type: 'usage', usage: parsed.usage }
              } else if (parsed.type === 'reasoning') {
                // 可能是增量或结束事件
                if (parsed.done) {
                  yield { type: 'reasoning', done: true, duration: parsed.duration }
                } else if (parsed.content) {
                  yield { type: 'reasoning', content: parsed.content }
                }
              } else if (parsed.type === 'start') {
                yield { type: 'start' }
              } else if (parsed.type === 'end') {
                yield { type: 'end' }
              } else if (parsed.type === 'stop') {
                // 可用于前端识别结束原因，不强制处理
              } else if (parsed.type === 'complete') {
                yield { type: 'complete' }
              } else if (parsed.error) {
                throw new Error(parsed.error)
              }
            } catch (e) {
              // 忽略解析错误，但在开发模式打印
              if (process.env.NODE_ENV !== 'production') {
                // eslint-disable-next-line no-console
                console.debug('[streamChat] JSON parse ignore:', e)
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
      // 释放当前控制器
      this.currentStreamController = null
    }
  }

  cancelStream() {
    try { this.currentStreamController?.abort(); } catch {}
    this.currentStreamController = null
  }

  // 非流式接口：失败退避策略同上
  async chatCompletion(sessionId: number, content: string, images?: Array<{ data: string; mime: string }>, options?: { reasoningEnabled?: boolean; reasoningEffort?: 'low'|'medium'|'high'; ollamaThink?: boolean; saveReasoning?: boolean; clientMessageId?: string }) {
    const doOnce = () => this.client.post<ApiResponse<{ content: string; usage: any }>>('/chat/completion', { sessionId, content, images, ...(options||{}) })
    try {
      let res = await doOnce()
      if (res.status === 429) {
        await new Promise(r => setTimeout(r, 15000))
        res = await doOnce()
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

  async getDailyUsage(params: { from?: string; to?: string; sessionId?: number }) {
    const response = await this.client.get<import('@/types').ApiResponse<{ from: string; to: string; rows: Array<{ date: string; prompt_tokens: number; completion_tokens: number; total_tokens: number }> }>>(`/chat/usage/daily`, {
      params,
    })
    return response.data
  }

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
      }>>('/settings/system')
    const allowRegistration = !!settingsRes.data.data?.registration_enabled
    const brandText = settingsRes.data.data?.brand_text || 'AIChat'
    const systemModels: any[] = []
    const sseHeartbeatIntervalMs = Number(settingsRes.data.data?.sse_heartbeat_interval_ms ?? 15000)
    const providerMaxIdleMs = Number(settingsRes.data.data?.provider_max_idle_ms ?? 60000)
    const providerTimeoutMs = Number(settingsRes.data.data?.provider_timeout_ms ?? 300000)
    const usageEmit = (settingsRes.data.data?.usage_emit ?? true) as boolean
    const usageProviderOnly = (settingsRes.data.data?.usage_provider_only ?? false) as boolean
    const reasoningEnabled = (settingsRes.data.data?.reasoning_enabled ?? true) as boolean
    const reasoningDefaultExpand = (settingsRes.data.data?.reasoning_default_expand ?? false) as boolean
    const reasoningSaveToDb = (settingsRes.data.data?.reasoning_save_to_db ?? true) as boolean
    const reasoningTagsMode = (settingsRes.data.data?.reasoning_tags_mode ?? 'default') as any
    const reasoningCustomTags = (settingsRes.data.data?.reasoning_custom_tags ?? '') as string
    const streamDeltaChunkSize = Number(settingsRes.data.data?.stream_delta_chunk_size ?? 1)
    const openaiReasoningEffort = (settingsRes.data.data?.openai_reasoning_effort ?? '') as any
    const ollamaThink = Boolean(settingsRes.data.data?.ollama_think ?? false)
    return { data: { allowRegistration, brandText, systemModels, sseHeartbeatIntervalMs, providerMaxIdleMs, providerTimeoutMs, usageEmit, usageProviderOnly, reasoningEnabled, reasoningDefaultExpand, reasoningSaveToDb, reasoningTagsMode, reasoningCustomTags, streamDeltaChunkSize, openaiReasoningEffort, ollamaThink } }
  }

  async updateSystemSettings(settings: any) {
    // 支持 allowRegistration/brandText 以及流式稳定性设置
    const payload: any = {}
    if (typeof settings.allowRegistration === 'boolean') payload.registration_enabled = !!settings.allowRegistration
    if (typeof settings.brandText === 'string') payload.brand_text = settings.brandText
    if (typeof settings.sseHeartbeatIntervalMs === 'number') payload.sse_heartbeat_interval_ms = settings.sseHeartbeatIntervalMs
    if (typeof settings.providerMaxIdleMs === 'number') payload.provider_max_idle_ms = settings.providerMaxIdleMs
    if (typeof settings.providerTimeoutMs === 'number') payload.provider_timeout_ms = settings.providerTimeoutMs
    if (typeof settings.usageEmit === 'boolean') payload.usage_emit = !!settings.usageEmit
    if (typeof settings.usageProviderOnly === 'boolean') payload.usage_provider_only = !!settings.usageProviderOnly
    if (typeof settings.reasoningEnabled === 'boolean') payload.reasoning_enabled = !!settings.reasoningEnabled
    if (typeof settings.reasoningDefaultExpand === 'boolean') payload.reasoning_default_expand = !!settings.reasoningDefaultExpand
    if (typeof settings.reasoningSaveToDb === 'boolean') payload.reasoning_save_to_db = !!settings.reasoningSaveToDb
    if (typeof settings.reasoningTagsMode === 'string') payload.reasoning_tags_mode = settings.reasoningTagsMode
    if (typeof settings.reasoningCustomTags === 'string') payload.reasoning_custom_tags = settings.reasoningCustomTags
    if (typeof settings.streamDeltaChunkSize === 'number') payload.stream_delta_chunk_size = settings.streamDeltaChunkSize
    if (typeof settings.openaiReasoningEffort === 'string') payload.openai_reasoning_effort = settings.openaiReasoningEffort
    if (typeof settings.ollamaThink === 'boolean') payload.ollama_think = !!settings.ollamaThink
    await this.client.put<ApiResponse<any>>('/settings/system', payload)
    // 返回更新后的设置（与 getSystemSettings 保持一致）
    const current = await this.getSystemSettings()
    return current
  }

  async getUsers(params?: { page?: number; limit?: number; search?: string }) {
    const response = await this.client.get<ApiResponse<{ users: Array<{ id: number; username: string; role: 'ADMIN'|'USER'; createdAt: string; _count?: { chatSessions: number; connections: number } }>; pagination: { page: number; limit: number; total: number; totalPages: number } }>>('/users', { params })
    return response.data
  }

  async updateUserRole(userId: number, role: 'ADMIN' | 'USER') {
    const response = await this.client.put(`/users/${userId}/role`, { role })
    return response.data
  }

  async deleteUser(userId: number) {
    await this.client.delete(`/users/${userId}`)
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
