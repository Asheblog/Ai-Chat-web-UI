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
    })

    // 请求拦截器 - 添加认证token & 记录日志
    this.client.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        ;(config as any).metadata = { start: Date.now() }
        const token = this.getToken()
        if (token) {
          config.headers.Authorization = `Bearer ${token}`
        }
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
      this.clearToken()
      if (typeof window !== 'undefined') {
        // 同步清理 zustand 的持久化存储，防止旧 user/token 复水
        try {
          window.localStorage.removeItem('auth-storage')
        } catch {}
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
  private getPreferredStorage(): Storage | null {
    if (typeof window === 'undefined') return null
    try {
      const prefRaw = localStorage.getItem('auth_pref')
      if (!prefRaw) return localStorage
      const pref = JSON.parse(prefRaw) as { rememberLogin?: boolean }
      return pref?.rememberLogin === false ? sessionStorage : localStorage
    } catch {
      return localStorage
    }
  }

  private getToken(): string | null {
    if (typeof window !== 'undefined') {
      // 优先从 sessionStorage 读取（未勾选记住登录时）
      return sessionStorage.getItem('token') || localStorage.getItem('token')
    }
    return null
  }

  private clearToken(): void {
    if (typeof window !== 'undefined') {
      try {
        // 双存储清理，兼容切换
        localStorage.removeItem('token')
        localStorage.removeItem('user')
        sessionStorage.removeItem('token')
        sessionStorage.removeItem('user')
      } catch {}
    }
  }

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
    if ((data as any).token) {
      const storage = this.getPreferredStorage() || localStorage
      storage.setItem('token', data.token)
      storage.setItem('user', JSON.stringify(data.user))
    }
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
    if ((data as any).token) {
      const storage = this.getPreferredStorage() || localStorage
      storage.setItem('token', data.token)
      storage.setItem('user', JSON.stringify(data.user))
    }
    return data
  }

  async getCurrentUser(): Promise<User> {
    const response = await this.client.get<ApiResponse<User>>('/auth/me')
    return response.data.data!
  }

  logout(): void {
    this.clearToken()
    if (typeof window !== 'undefined') {
      // 统一跳转到 Next.js 下的登录页路径
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

  async createSession(modelConfigId: number, title?: string) {
    const response = await this.client.post<ApiResponse<any>>('/sessions', {
      modelConfigId,
      title,
    })
    return response.data
  }

  async deleteSession(sessionId: number) {
    await this.client.delete(`/sessions/${sessionId}`)
  }

  async updateSession(sessionId: number, title: string) {
    const response = await this.client.put(`/sessions/${sessionId}`, {
      title,
    })
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
  async *streamChat(sessionId: number, content: string, images?: Array<{ data: string; mime: string }>): AsyncGenerator<import('@/types').ChatStreamChunk, void, unknown> {
    // API_BASE_URL 已包含 /api 前缀
    const doOnce = async (signal: AbortSignal) => fetch(`${API_BASE_URL}/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.getToken()}`,
      },
      body: JSON.stringify({ sessionId, content, images }),
      signal,
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
  async chatCompletion(sessionId: number, content: string, images?: Array<{ data: string; mime: string }>) {
    const doOnce = () => this.client.post<ApiResponse<{ content: string; usage: any }>>('/chat/completion', { sessionId, content, images })
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

  // 模型配置相关API
  async getPersonalModels() {
    // 后端提供 /api/models 返回 { personal, system }
    const response = await this.client.get<ApiResponse<{ personal: any[]; system: any[] }>>('/models')
    const { data } = response.data
    return { data: data?.personal || [] }
  }

  async getSystemModels() {
    const response = await this.client.get<ApiResponse<{ personal: any[]; system: any[] }>>('/models')
    const { data } = response.data
    return { data: data?.system || [] }
  }

  async getAllModels() {
    const response = await this.client.get<ApiResponse<{ personal: any[]; system: any[] }>>('/models')
    return response.data
  }

  async createModelConfig(name: string, apiUrl: string, apiKey: string, supportsImages?: boolean) {
    const response = await this.client.post('/models', {
      name,
      apiUrl,
      apiKey,
      supportsImages: !!supportsImages,
    })
    return response.data
  }

  async updateModelConfig(modelId: number, updates: Partial<{ name: string; apiUrl: string; apiKey: string; supportsImages: boolean }>) {
    const response = await this.client.put(`/models/${modelId}`, updates)
    return response.data
  }

  async deleteModelConfig(modelId: number) {
    await this.client.delete(`/models/${modelId}`)
  }

  // 系统设置相关API (仅管理员)
  async getSystemSettings() {
    // 聚合系统设置与系统模型列表，返回前端期望的形状
    const [settingsRes, modelsRes] = await Promise.all([
      this.client.get<ApiResponse<{ 
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
      }>>('/settings/system'),
      this.client.get<ApiResponse<{ personal: any[]; system: any[] }>>('/models'),
    ])
    const allowRegistration = !!settingsRes.data.data?.registration_enabled
    const brandText = settingsRes.data.data?.brand_text || 'AIChat'
    const systemModels = modelsRes.data.data?.system || []
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

  async getUsers() {
    const response = await this.client.get('/users')
    return response.data
  }

  async updateUserRole(userId: number, role: 'ADMIN' | 'USER') {
    const response = await this.client.put(`/users/${userId}/role`, { role })
    return response.data
  }

  async deleteUser(userId: number) {
    await this.client.delete(`/users/${userId}`)
  }

  // 系统模型（管理员）
  async createSystemModel(name: string, apiUrl: string, apiKey: string, supportsImages?: boolean) {
    const response = await this.client.post('/models/system', { name, apiUrl, apiKey, supportsImages: !!supportsImages })
    return response.data
  }

  async getSystemModelList() {
    const response = await this.client.get('/models/system/list')
    return response.data
  }

  async updateSystemModel(modelId: number, updates: Partial<{ name: string; apiUrl: string; apiKey: string; supportsImages: boolean }>) {
    const response = await this.client.put(`/models/system/${modelId}`, updates)
    return response.data
  }

  async deleteSystemModel(modelId: number) {
    await this.client.delete(`/models/system/${modelId}`)
  }
}

export const apiClient = new ApiClient()
export default apiClient
