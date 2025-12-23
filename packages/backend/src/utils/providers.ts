import { BackendLogger as log } from './logger'
import type { CapabilityFlags, CapabilitySource } from './capabilities'
import { hasDefinedCapability } from './capabilities'

export type ProviderType = 'openai' | 'openai_responses' | 'azure_openai' | 'ollama' | 'google_genai'
export type AuthType = 'bearer' | 'none' | 'session' | 'system_oauth' | 'microsoft_entra_id'

type FetchResponse = {
  ok: boolean
  status: number
  json: () => Promise<any>
  text: () => Promise<string>
  headers: { get: (name: string) => string | null }
}

type FetchInit = {
  headers?: Record<string, string>
  signal?: AbortSignal
  method?: string
  body?: any
}

type FetchLike = (input: string, init?: FetchInit) => Promise<FetchResponse>

let cachedFetch: FetchLike | null = null

const resolveFetch = async (): Promise<FetchLike> => {
  if (cachedFetch) return cachedFetch
  if (typeof fetch === 'function') {
    cachedFetch = fetch as unknown as FetchLike
    return cachedFetch
  }
  const mod = await import('node-fetch')
  cachedFetch = (mod.default ?? mod) as unknown as FetchLike
  return cachedFetch
}

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
  defaultCapabilities?: CapabilityFlags
}

export interface CatalogItem {
  id: string // 展示ID（含前缀）
  rawId: string
  name: string
  provider: ProviderType
  channelName: string
  connectionBaseUrl: string
  connectionType: 'external' | 'local'
  tags: Array<{ name: string }>
  // 模型能力元数据：对齐 open-webui 的能力设计
  // 仅在聚合内存中计算与返回，不落库
  capabilities?: CapabilityFlags
  capabilitySource?: CapabilitySource
}

// 公共工具：根据 tags 与 rawId 推导模型能力（标签优先，启发式其次）
export function computeCapabilities(rawId: string, tags?: Array<{ name: string }>): CapabilityFlags {
  const caps: CapabilityFlags = {}
  const tnames = (tags || []).map((t) => (t?.name || '').toLowerCase())
  const hasTag = (k: string) => tnames.includes(k)

  if (hasTag('vision')) caps.vision = true
  if (hasTag('file_upload') || hasTag('file')) caps.file_upload = true
  if (hasTag('web_search')) caps.web_search = true
  if (hasTag('image_generation')) caps.image_generation = true
  if (hasTag('code_interpreter')) caps.code_interpreter = true

  const id = (rawId || '').toLowerCase()
  if (caps.vision !== true) {
    const visionHints = [
      'gpt-4o', 'gpt-4.1', 'gpt4o', 'o4', 'omni', 'vision', 'vl',
      'phi-3', 'phi-3.5', 'phi-4', 'minicpm', 'qwen-vl', 'qwen2-vl', 'qwen2.5-vl',
      'llava', 'llama-3.2', 'llama3.2', 'llama-vision', 'llama3-vision', 'moondream', 'bakllava', 'pixtral',
      'deepseek-vl', 'kling-v', 'grok-vision'
    ]
    if (visionHints.some((p) => id.includes(p))) caps.vision = true
  }

  const fileUploadHints = ['upload-anything', 'file-gpt', 'omni', 'vision', 'gpt-4.1', 'gpt4o', 'o4']
  if (caps.file_upload !== true && fileUploadHints.some((p) => id.includes(p))) {
    caps.file_upload = true
  }

  const webSearchHints = ['web', 'browse', 'search', 'perplexity', 'webgpt', 'internet']
  if (caps.web_search !== true && webSearchHints.some((p) => id.includes(p))) {
    caps.web_search = true
  }

  const imageGenHints = ['image-gen', 'image_generation', 'dall', 'kandinsky', 'sdxl', 'flux', 'kling', 'midjourney']
  if (caps.image_generation !== true && imageGenHints.some((p) => id.includes(p))) {
    caps.image_generation = true
  }

  const codeHints = ['code', 'coder', 'program', 'deepseek', 'o1', 'o3', 'reasoner', 'math']
  if (caps.code_interpreter !== true && codeHints.some((p) => id.includes(p))) {
    caps.code_interpreter = true
  }

  return caps
}

const CHANNEL_PREFIX_BLACKLIST = new Set(['api', 'app', 'prod', 'dev', 'test', 'staging', 'stage', 'ai', 'llm', 'model', 'models', 'gateway', 'gw'])
const GENERIC_TLDS = new Set(['com', 'net', 'org', 'gov', 'edu', 'co', 'ai', 'io', 'app', 'dev', 'cn', 'uk'])

function parseUrlCandidate(input?: string): URL | null {
  if (!input) return null
  const tryParse = (value: string): URL | null => {
    try {
      return new URL(value)
    } catch {
      return null
    }
  }
  const direct = tryParse(input)
  if (direct) return direct
  if (!/^https?:\/\//i.test(input)) {
    return tryParse(`https://${input}`)
  }
  return null
}

export function deriveChannelName(provider: ProviderType, baseUrl?: string): string {
  const fallback = provider
  const parsed = parseUrlCandidate(baseUrl)
  if (!parsed) return fallback

  const hostname = parsed.hostname.toLowerCase()
  if (!hostname) return fallback

  let parts = hostname.split('.').filter(Boolean)
  if (parts.length > 1 && CHANNEL_PREFIX_BLACKLIST.has(parts[0])) {
    parts = parts.slice(1)
  }

  if (parts.length === 0) return fallback
  if (parts.length === 1) {
    return parts[0]
  }

  let candidate = parts[parts.length - 2]
  if (GENERIC_TLDS.has(candidate) && parts.length >= 3) {
    candidate = parts[parts.length - 3]
  }
  candidate = candidate || parts[parts.length - 1]
  if (!candidate || candidate.length < 2) return fallback

  return candidate
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

export async function buildHeaders(provider: ProviderType, authType: AuthType, apiKey?: string, extra?: Record<string, string>) {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (provider === 'google_genai') {
    if (authType === 'bearer' && apiKey) {
      h['x-goog-api-key'] = apiKey
    }
  } else if (authType === 'bearer' && apiKey) {
    h['Authorization'] = `Bearer ${apiKey}`
  } else if (authType === 'system_oauth') {
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

const trimTrailingSlashes = (value: string) => value.replace(/\/+$/, '')

const ensureJsonContentType = (res: { headers: { get: (name: string) => string | null } }, context: string) => {
  const contentType = res.headers.get('content-type') || ''
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error(`${context}: expected JSON response, received '${contentType || 'unknown'}'`)
  }
}

const normalizeHttpBaseUrl = (baseUrl: string, label: string): string => {
  const trimmed = trimTrailingSlashes((baseUrl || '').trim())
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error(`${label} baseUrl 无效，请提供合法的 URL（例如 https://api.openai.com/v1）`)
  }
  if (!/^https?:$/i.test(parsed.protocol)) {
    throw new Error(`${label} baseUrl 仅支持 http/https，当前为: ${trimmed}`)
  }
  return trimmed
}

export async function verifyConnection(cfg: ConnectionConfig): Promise<void> {
  const headers = await buildHeaders(cfg.provider, cfg.authType, cfg.apiKey, cfg.headers)
  const fetchImpl = await resolveFetch()
  const timeoutMs = 15000
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    if (cfg.provider === 'openai' || cfg.provider === 'openai_responses') {
      const normalizedBase = normalizeHttpBaseUrl(cfg.baseUrl, 'OpenAI')
      const res = await fetchImpl(`${normalizedBase}/models`, { headers, signal: ctrl.signal })
      if (!res.ok) {
        // 一些 responses-only 网关可能不提供 /models，尝试用 /responses 探测（需提供至少一个 modelId）
        if (
          cfg.provider === 'openai_responses' &&
          (res.status === 404 || res.status === 405)
        ) {
          const probeModel = Array.isArray(cfg.modelIds) ? cfg.modelIds.find(Boolean) : undefined
          if (!probeModel) {
            throw new Error('OpenAI（Responses）verify failed: /models unsupported, please set Model IDs and retry')
          }
          const probe = await fetchImpl(`${normalizedBase}/responses`, {
            method: 'POST',
            headers,
            signal: ctrl.signal,
            body: JSON.stringify({
              model: probeModel,
              input: 'ping',
              max_output_tokens: 1,
            }),
          })
          if (!probe.ok) throw new Error(`OpenAI（Responses）verify failed: ${probe.status}`)
          ensureJsonContentType(probe, 'OpenAI（Responses）verify')
          return
        }
        const hint = (() => {
          try {
            const u = new URL(normalizedBase)
            return u.pathname === '/' ? '（提示：OpenAI 官方需填写 https://api.openai.com/v1）' : ''
          } catch {
            return ''
          }
        })()
        throw new Error(`OpenAI verify failed: ${res.status}${hint}`)
      }
      ensureJsonContentType(res, 'OpenAI verify')
    } else if (cfg.provider === 'azure_openai') {
      const v = cfg.azureApiVersion || '2024-02-15-preview'
      const base = trimTrailingSlashes(cfg.baseUrl)
      const res = await fetchImpl(`${base}/openai/models?api-version=${encodeURIComponent(v)}`, { headers, signal: ctrl.signal })
      if (!res.ok) throw new Error(`Azure OpenAI verify failed: ${res.status}`)
      ensureJsonContentType(res, 'Azure OpenAI verify')
    } else if (cfg.provider === 'ollama') {
      const base = trimTrailingSlashes(cfg.baseUrl)
      const res = await fetchImpl(`${base}/api/version`, { headers, signal: ctrl.signal })
      if (!res.ok) throw new Error(`Ollama verify failed: ${res.status}`)
    } else if (cfg.provider === 'google_genai') {
      const base = trimTrailingSlashes(cfg.baseUrl)
      const res = await fetchImpl(`${base}/models`, { headers, signal: ctrl.signal })
      if (!res.ok) throw new Error(`Google Generative verify failed: ${res.status}`)
      ensureJsonContentType(res, 'Google Generative AI verify')
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
  const baseUrl = cfg.baseUrl
  const channelName = deriveChannelName(cfg.provider, baseUrl)
  const headers = await buildHeaders(cfg.provider, cfg.authType, cfg.apiKey, cfg.headers)

  const apply = (id: string, name?: string): CatalogItem => {
    const inferred = computeCapabilities(id, tags)
    const hasInferred = hasDefinedCapability(inferred)
    return {
      id: prefix ? `${prefix}.${id}` : id,
      rawId: id,
      name: name || id,
      provider: cfg.provider,
      channelName,
      connectionBaseUrl: baseUrl,
      connectionType,
      tags,
      ...(hasInferred
        ? {
            capabilities: inferred,
            capabilitySource: 'heuristic' as CapabilitySource,
          }
        : {}),
    }
  }

  if (cfg.modelIds && cfg.modelIds.length) {
    return cfg.modelIds.map((m) => apply(m))
  }

  const fetchImpl = await resolveFetch()
  const timeoutMs = 15000
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    if (cfg.provider === 'openai' || cfg.provider === 'openai_responses') {
      const normalizedBase = normalizeHttpBaseUrl(cfg.baseUrl, 'OpenAI')
      const res = await fetchImpl(`${normalizedBase}/models`, { headers, signal: ctrl.signal })
      if (!res.ok) throw new Error(`OpenAI models failed: ${res.status}`)
      const json: any = await res.json()
      const list: any[] = Array.isArray(json?.data) ? json.data : []
      return list.map((m) => apply(m.id, m.name || m.id))
    }
    if (cfg.provider === 'azure_openai') {
      const v = cfg.azureApiVersion || '2024-02-15-preview'
      const res = await fetchImpl(`${trimTrailingSlashes(cfg.baseUrl)}/openai/models?api-version=${encodeURIComponent(v)}`, { headers, signal: ctrl.signal })
      if (!res.ok) throw new Error(`Azure models failed: ${res.status}`)
      const json: any = await res.json()
      const list: any[] = Array.isArray(json?.data) ? json.data : []
      return list.map((m) => apply(m.id, m.name || m.id))
    }
    if (cfg.provider === 'ollama') {
      const res = await fetchImpl(`${trimTrailingSlashes(cfg.baseUrl)}/api/tags`, { headers, signal: ctrl.signal })
      if (!res.ok) throw new Error(`Ollama tags failed: ${res.status}`)
      const json: any = await res.json()
      const list: any[] = Array.isArray(json?.models) ? json.models : []
      return list.map((m) => apply(m.model, m.name || m.model))
    }
    if (cfg.provider === 'google_genai') {
      const res = await fetchImpl(`${trimTrailingSlashes(cfg.baseUrl)}/models`, { headers, signal: ctrl.signal })
      if (!res.ok) throw new Error(`Google models failed: ${res.status}`)
      const json: any = await res.json()
      const list: any[] = Array.isArray(json?.models) ? json.models : []
      return list.map((m) => {
        const raw = typeof m?.name === 'string' ? m.name.split('/').pop() || m.name : ''
        const display = m?.displayName || raw
        return apply(raw, display)
      })
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

/**
 * 检测模型类型（chat / embedding / both）
 * 优先使用标签，其次基于模型ID启发式推断
 */
export type ModelType = 'chat' | 'embedding' | 'both'

export function detectModelType(rawId: string, tags?: Array<{ name: string }>): ModelType {
  const tnames = (tags || []).map((t) => (t?.name || '').toLowerCase())

  // 标签优先
  const hasEmbeddingTag = tnames.includes('embedding')
  const hasChatTag = tnames.includes('chat')

  if (hasEmbeddingTag && hasChatTag) return 'both'
  if (hasEmbeddingTag) return 'embedding'

  const id = (rawId || '').toLowerCase()

  // 常见 embedding 模型模式
  const embeddingPatterns = [
    'embedding',
    'embed',
    'ada-002',
    'text-embedding',
    'bge-',
    'e5-',
    'nomic-embed',
    'mxbai-embed',
    'snowflake-arctic-embed',
    'all-minilm',
    'gte-',
    'jina-embed',
    'voyage-',
  ]

  if (embeddingPatterns.some((p) => id.includes(p))) {
    return 'embedding'
  }

  return 'chat'
}
