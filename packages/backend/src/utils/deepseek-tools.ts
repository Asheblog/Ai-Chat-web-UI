import { combineAbortSignals } from './abort-signal'
import { isDisallowedHostname } from './host-safety'

export const DEEPSEEK_SEARCH_ENDPOINT = 'https://api.deepseek.com/v1/tools/search'
export const DEEPSEEK_FETCH_ENDPOINT = 'https://api.deepseek.com/v1/tools/fetch'

const DEFAULT_TIMEOUT_MS = 20_000
const MAX_QUERY_CODE_POINTS = 128
const MAX_FETCH_URL_LENGTH = 8192

export type DeepSeekToolErrorCode =
  | 'MISSING_API_KEY'
  | 'INVALID_QUERY'
  | 'UNSUPPORTED_SCOPE'
  | 'INVALID_URL'
  | 'DISALLOWED_URL'
  | 'EMPTY_CONTENT'
  | 'INVALID_RESPONSE'
  | 'HTTP_ERROR'
  | 'TIMEOUT'
  | 'CANCELLED'
  | `HTTP_${number}`

export class DeepSeekToolError extends Error {
  readonly code: DeepSeekToolErrorCode
  readonly status?: number

  constructor(code: DeepSeekToolErrorCode, message: string, status?: number) {
    super(message)
    this.name = 'DeepSeekToolError'
    this.code = code
    this.status = status
  }
}

export interface DeepSeekSearchOptions {
  apiKey?: string
  limit: number
  domains?: string[]
  scope?: string
  includeRawContent?: boolean
  /** 触发检索的用户原始问题（官方 ori_question，1-128 字符），用于理解搜索意图。 */
  oriQuestion?: string
  signal?: AbortSignal
  timeoutMs?: number
}

export interface DeepSeekFetchOptions {
  apiKey?: string
  signal?: AbortSignal
  timeoutMs?: number
}

export interface DeepSeekFetchResult {
  title: string
  content: string
}

/** 独立的搜索结果形状，避免 HTTP 模块反向依赖搜索调度器。 */
export interface DeepSeekSearchHit {
  title: string
  url: string
  snippet?: string
  content?: string
  /** 官方 date 字段（UTC RFC 3339），未知时省略。 */
  publishedDate?: string
  /** 官方 site_name 字段，缺失时为 null。 */
  siteName?: string
  /** 官方 authority 字段（0-4，-1 表示未知）。 */
  authority?: number
}

const requireApiKey = (apiKey?: string): string => {
  const normalized = (apiKey || '').trim()
  if (!normalized) {
    throw new DeepSeekToolError('MISSING_API_KEY', 'DeepSeek API key is not configured')
  }
  return normalized
}

const clampLimit = (limit: number): number => {
  if (!Number.isFinite(limit)) return 4
  return Math.max(1, Math.min(10, Math.floor(limit)))
}

const normalizeDomain = (value: string): string => {
  let normalized = (value || '').trim().toLowerCase()
  if (!normalized) return ''
  if (normalized.startsWith('*.')) normalized = normalized.slice(2)
  if (/^https?:\/\//i.test(normalized)) {
    try {
      normalized = new URL(normalized).hostname
    } catch {
      return ''
    }
  }
  normalized = normalized.split('/')[0]?.split(':')[0] || ''
  return normalized.replace(/^\.+|\.+$/g, '')
}

const normalizeDomains = (domains?: string[]): string[] =>
  Array.isArray(domains)
    ? Array.from(new Set(domains.map(normalizeDomain).filter(Boolean)))
    : []

const isAllowedResultUrl = (rawUrl: string, domains: string[]): boolean => {
  if (!rawUrl) return false
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  if (parsed.username || parsed.password) return false
  if (domains.length === 0) return true
  const hostname = parsed.hostname.toLowerCase()
  return domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
}

const assertWebScope = (scope?: string): void => {
  const normalized = (scope || '').trim().toLowerCase()
  if (!normalized) return
  if (normalized === 'webpage' || normalized === 'web') return
  throw new DeepSeekToolError(
    'UNSUPPORTED_SCOPE',
    `DeepSeek web search does not support the "${normalized}" scope`,
  )
}

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')

const mapStatusError = (status: number): DeepSeekToolError => {
  // 状态码语义见 https://api-docs.deepseek.com/zh-cn/guides/search/ 「错误」表
  const hint =
    status === 400
      ? 'DeepSeek rejected the request headers or body'
      : status === 401
        ? 'DeepSeek rejected the API key'
        : status === 402
          ? 'DeepSeek account balance is insufficient'
          : status === 403
            ? 'DeepSeek fetch was blocked by its security policy'
            : status === 404
              ? 'DeepSeek fetch could not extract usable page content'
              : status === 408
                ? 'DeepSeek timed out while reading the request body'
                : status === 413
                  ? 'DeepSeek request body exceeded its size limit'
                  : status === 429
                    ? 'DeepSeek search/fetch rate limit exceeded'
                    : status >= 500
                      ? 'DeepSeek search/fetch service is unavailable'
                      : 'DeepSeek search/fetch request failed'
  // 不拼接上游 error.message：官方错误体可能原样回显 API Key（已有测试锁定该契约）
  return new DeepSeekToolError(
    `HTTP_${status}` as DeepSeekToolErrorCode,
    `${hint} (HTTP ${status})`,
    status,
  )
}

const postJson = async (
  endpoint: string,
  apiKey: string,
  body: Record<string, unknown>,
  options: { signal?: AbortSignal; timeoutMs?: number },
): Promise<unknown> => {
  if (options.signal?.aborted) {
    throw new DeepSeekToolError('CANCELLED', 'DeepSeek request was cancelled')
  }

  const timeoutMs = Math.max(1000, options.timeoutMs || DEFAULT_TIMEOUT_MS)
  const timeoutController = new AbortController()
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs)
  const combined = combineAbortSignals(options.signal, timeoutController.signal)

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: combined.signal,
    })
    if (!response.ok) {
      throw mapStatusError(response.status)
    }
    try {
      return await response.json()
    } catch (error) {
      if (options.signal?.aborted || timeoutController.signal.aborted || isAbortError(error)) {
        throw error
      }
      throw new DeepSeekToolError('INVALID_RESPONSE', 'DeepSeek returned an invalid JSON response')
    }
  } catch (error) {
    if (error instanceof DeepSeekToolError) throw error
    if (options.signal?.aborted) {
      throw new DeepSeekToolError('CANCELLED', 'DeepSeek request was cancelled')
    }
    if (timeoutController.signal.aborted || isAbortError(error)) {
      throw new DeepSeekToolError('TIMEOUT', `DeepSeek request timed out after ${timeoutMs}ms`)
    }
    throw new DeepSeekToolError('HTTP_ERROR', 'DeepSeek request failed before receiving a response')
  } finally {
    clearTimeout(timeoutId)
    combined.cleanup()
  }
}

const pickText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

export const runDeepSeekSearch = async (
  query: string,
  options: DeepSeekSearchOptions,
): Promise<DeepSeekSearchHit[]> => {
  const apiKey = requireApiKey(options.apiKey)
  const normalizedQuery = (query || '').trim()
  if (!normalizedQuery || Array.from(normalizedQuery).length > MAX_QUERY_CODE_POINTS) {
    throw new DeepSeekToolError(
      'INVALID_QUERY',
      `DeepSeek query must contain 1-${MAX_QUERY_CODE_POINTS} Unicode characters`,
    )
  }
  assertWebScope(options.scope)

  const domains = normalizeDomains(options.domains)
  const oriQuestion = (options.oriQuestion || '').trim()
  const payload: Record<string, unknown> = {
    query: normalizedQuery,
    count: clampLimit(options.limit),
    need_content: Boolean(options.includeRawContent),
  }
  // 官方 ori_question 为可选 1-128 字符；超出范围时省略而不是截断成另一个意图
  if (oriQuestion && Array.from(oriQuestion).length <= MAX_QUERY_CODE_POINTS) {
    payload.ori_question = oriQuestion
  }
  const data = await postJson(DEEPSEEK_SEARCH_ENDPOINT, apiKey, payload, {
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  })

  const results = (data as { results?: unknown })?.results
  if (!Array.isArray(results)) {
    throw new DeepSeekToolError('INVALID_RESPONSE', 'DeepSeek search response is missing results')
  }

  const seen = new Set<string>()
  const hits: DeepSeekSearchHit[] = []
  for (const rawItem of results) {
    if (!rawItem || typeof rawItem !== 'object') continue
    const item = rawItem as Record<string, unknown>
    const url = pickText(item.url)
    if (!isAllowedResultUrl(url, domains) || seen.has(url)) continue
    seen.add(url)
    const snippet = pickText(item.summary) || pickText(item.snippet)
    const content = pickText(item.content)
    const publishedDate = pickText(item.date)
    const siteName = pickText(item.site_name)
    const rawAuthority = item.authority
    const authority =
      typeof rawAuthority === 'number' && Number.isFinite(rawAuthority) && rawAuthority >= 0
        ? rawAuthority
        : undefined
    hits.push({
      title: pickText(item.title) || url || 'Untitled',
      url,
      snippet,
      ...(content ? { content } : {}),
      ...(publishedDate ? { publishedDate } : {}),
      ...(siteName ? { siteName } : {}),
      ...(authority !== undefined ? { authority } : {}),
    })
    if (hits.length >= clampLimit(options.limit)) break
  }
  return hits
}

const validateFetchUrl = (url: string): string => {
  const raw = (url || '').trim()
  if (!/^https?:\/\//i.test(raw) || raw.length > MAX_FETCH_URL_LENGTH) {
    throw new DeepSeekToolError('INVALID_URL', 'DeepSeek fetch requires a valid HTTP(S) URL')
  }
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new DeepSeekToolError('INVALID_URL', 'DeepSeek fetch requires a valid HTTP(S) URL')
  }
  if (parsed.username || parsed.password) {
    throw new DeepSeekToolError('INVALID_URL', 'DeepSeek fetch URL must not contain credentials')
  }
  if (isDisallowedHostname(parsed.hostname)) {
    throw new DeepSeekToolError(
      'DISALLOWED_URL',
      'Access to local/internal URLs is not allowed for security reasons',
    )
  }
  return parsed.toString()
}

export const runDeepSeekFetch = async (
  url: string,
  options: DeepSeekFetchOptions,
): Promise<DeepSeekFetchResult> => {
  const apiKey = requireApiKey(options.apiKey)
  const validatedUrl = validateFetchUrl(url)
  const data = await postJson(DEEPSEEK_FETCH_ENDPOINT, apiKey, { url: validatedUrl }, {
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  })
  if (!data || typeof data !== 'object') {
    throw new DeepSeekToolError('INVALID_RESPONSE', 'DeepSeek fetch response is invalid')
  }
  const record = data as Record<string, unknown>
  const content = pickText(record.content)
  const title = pickText(record.title)
  if (!content) {
    throw new DeepSeekToolError('EMPTY_CONTENT', 'DeepSeek fetch returned no readable content')
  }
  return { title, content }
}
