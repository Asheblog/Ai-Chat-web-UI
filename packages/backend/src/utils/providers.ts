import fetch from 'node-fetch'
import { BackendLogger as log } from './logger'

export type ProviderType = 'openai' | 'azure_openai' | 'ollama'
export type AuthType = 'bearer' | 'none' | 'session' | 'system_oauth' | 'microsoft_entra_id'

export interface ConnectionConfig {
  provider: ProviderType
  baseUrl: string
  enable: boolean
  authType: AuthType
  apiKey?: string
  headers?: Record<string, string>
  azureApiVersion?: string
  prefixId?: string
  tags?: Array<{ name: string }>
  modelIds?: string[]
  connectionType?: 'external' | 'local'
}

export interface CatalogItem {
  id: string // 展示ID（含前缀）
  rawId: string
  name: string
  provider: ProviderType
  connectionType: 'external' | 'local'
  tags: Array<{ name: string }>
}

async function getAzureAccessToken(): Promise<string | null> {
  try {
    if (process.env.AZURE_ACCESS_TOKEN) return process.env.AZURE_ACCESS_TOKEN
    // 尝试使用 @azure/identity（若未安装或配置失败则回退 null）
    // 动态引入以避免硬依赖
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DefaultAzureCredential } = require('@azure/identity')
    const cred = new DefaultAzureCredential()
    const token = await cred.getToken('https://cognitiveservices.azure.com/.default')
    return token?.token ?? null
  } catch (e) {
    log.debug('Azure access token fetch failed, fallback to env or none')
    return null
  }
}

async function buildHeaders(provider: ProviderType, authType: AuthType, apiKey?: string, extra?: Record<string, string>) {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (authType === 'bearer' && apiKey) h['Authorization'] = `Bearer ${apiKey}`
  else if (authType === 'system_oauth') {
    const token = process.env.SYSTEM_OAUTH_TOKEN
    if (token) h['Authorization'] = `Bearer ${token}`
  } else if (authType === 'microsoft_entra_id' && provider === 'azure_openai') {
    const token = await getAzureAccessToken()
    if (token) h['Authorization'] = `Bearer ${token}`
  }
  if (extra) {
    for (const [k, v] of Object.entries(extra)) h[k] = String(v)
  }
  return h
}

export async function verifyConnection(cfg: ConnectionConfig): Promise<void> {
  const headers = await buildHeaders(cfg.provider, cfg.authType, cfg.apiKey, cfg.headers)
  const timeoutMs = 15000
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    if (cfg.provider === 'openai') {
      const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/models`, { headers, signal: ctrl.signal })
      if (!res.ok) throw new Error(`OpenAI verify failed: ${res.status}`)
    } else if (cfg.provider === 'azure_openai') {
      const v = cfg.azureApiVersion || '2024-02-15-preview'
      const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/openai/models?api-version=${encodeURIComponent(v)}`, { headers, signal: ctrl.signal })
      if (!res.ok) throw new Error(`Azure OpenAI verify failed: ${res.status}`)
    } else if (cfg.provider === 'ollama') {
      const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/api/version`, { headers, signal: ctrl.signal })
      if (!res.ok) throw new Error(`Ollama verify failed: ${res.status}`)
    } else {
      throw new Error('Unsupported provider')
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 拉取一个连接的模型列表，返回 CatalogItem[]
 * 若配置了 modelIds，则直接以这些 ID 合成列表，不发请求。
 */
export async function fetchModelsForConnection(cfg: ConnectionConfig): Promise<CatalogItem[]> {
  if (!cfg.enable) return []
  const connectionType = (cfg.connectionType || 'external') as 'external' | 'local'
  const tags = cfg.tags || []
  const prefix = cfg.prefixId || ''
  const headers = await buildHeaders(cfg.provider, cfg.authType, cfg.apiKey, cfg.headers)

  const apply = (id: string, name?: string): CatalogItem => ({
    id: prefix ? `${prefix}.${id}` : id,
    rawId: id,
    name: name || id,
    provider: cfg.provider,
    connectionType,
    tags,
  })

  if (cfg.modelIds && cfg.modelIds.length) {
    return cfg.modelIds.map((m) => apply(m))
  }

  const timeoutMs = 15000
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    if (cfg.provider === 'openai') {
      const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/models`, { headers, signal: ctrl.signal })
      if (!res.ok) throw new Error(`OpenAI models failed: ${res.status}`)
      const json: any = await res.json()
      const list: any[] = Array.isArray(json?.data) ? json.data : []
      return list.map((m) => apply(m.id, m.name || m.id))
    }
    if (cfg.provider === 'azure_openai') {
      const v = cfg.azureApiVersion || '2024-02-15-preview'
      const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/openai/models?api-version=${encodeURIComponent(v)}`, { headers, signal: ctrl.signal })
      if (!res.ok) throw new Error(`Azure models failed: ${res.status}`)
      const json: any = await res.json()
      const list: any[] = Array.isArray(json?.data) ? json.data : []
      return list.map((m) => apply(m.id, m.name || m.id))
    }
    if (cfg.provider === 'ollama') {
      const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/api/tags`, { headers, signal: ctrl.signal })
      if (!res.ok) throw new Error(`Ollama tags failed: ${res.status}`)
      const json: any = await res.json()
      const list: any[] = Array.isArray(json?.models) ? json.models : []
      return list.map((m) => apply(m.model, m.name || m.model))
    }
    return []
  } finally {
    clearTimeout(timer)
  }
}

export function convertOpenAIReasoningPayload(payload: any): any {
  if (!payload || typeof payload !== 'object') return payload
  if (typeof payload.model === 'string' && payload.model.toLowerCase().startsWith('o1')) {
    if (payload.max_tokens != null) {
      payload.max_completion_tokens = payload.max_tokens
      delete payload.max_tokens
    }
  }
  return payload
}
