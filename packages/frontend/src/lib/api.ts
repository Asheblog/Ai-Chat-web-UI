import axios, {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig
} from 'axios'
import { AuthResponse, User, ApiResponse } from '@/types'

// API基础配置（统一使用 NEXT_PUBLIC_API_URL，默认 http://localhost:8001/api）
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001/api'

class ApiClient {
  private client: AxiosInstance

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    })

    // 请求拦截器 - 添加认证token
    this.client.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        const token = this.getToken()
        if (token) {
          config.headers.Authorization = `Bearer ${token}`
        }
        return config
      },
      (error) => {
        return Promise.reject(error)
      }
    )

    // 响应拦截器 - 处理错误
    this.client.interceptors.response.use(
      (response: AxiosResponse) => {
        return response
      },
      (error) => {
        if (error.response?.status === 401) {
          // token过期，清除本地存储并跳转到登录页
          this.clearToken()
          if (typeof window !== 'undefined') {
            window.location.href = '/login'
          }
        }
        return Promise.reject(error)
      }
    )
  }

  private getToken(): string | null {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('token')
    }
    return null
  }

  private clearToken(): void {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
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
      localStorage.setItem('token', data.token)
      localStorage.setItem('user', JSON.stringify(data.user))
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
      localStorage.setItem('token', data.token)
      localStorage.setItem('user', JSON.stringify(data.user))
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
      window.location.href = '/login'
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
  async *streamChat(sessionId: number, content: string): AsyncGenerator<string, void, unknown> {
    // API_BASE_URL 已包含 /api 前缀
    const response = await fetch(`${API_BASE_URL}/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.getToken()}`,
      },
      body: JSON.stringify({
        sessionId,
        content,
      }),
    })

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

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') {
              return
            }
            try {
              const parsed = JSON.parse(data)
              if (parsed.content) {
                yield parsed.content
              }
              if (parsed.error) {
                throw new Error(parsed.error)
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
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

  async createModelConfig(name: string, apiUrl: string, apiKey: string) {
    const response = await this.client.post('/models', {
      name,
      apiUrl,
      apiKey,
    })
    return response.data
  }

  async updateModelConfig(modelId: number, updates: Partial<{ name: string; apiUrl: string; apiKey: string }>) {
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
      this.client.get<ApiResponse<{ registration_enabled: boolean }>>('/settings/system'),
      this.client.get<ApiResponse<{ personal: any[]; system: any[] }>>('/models'),
    ])
    const allowRegistration = !!settingsRes.data.data?.registration_enabled
    const systemModels = modelsRes.data.data?.system || []
    return { data: { allowRegistration, systemModels } }
  }

  async updateSystemSettings(settings: any) {
    // 仅支持 registration_enabled 更新
    const payload = { registration_enabled: !!settings.allowRegistration }
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
  async createSystemModel(name: string, apiUrl: string, apiKey: string) {
    const response = await this.client.post('/models/system', { name, apiUrl, apiKey })
    return response.data
  }

  async getSystemModelList() {
    const response = await this.client.get('/models/system/list')
    return response.data
  }
}

export const apiClient = new ApiClient()
export default apiClient
