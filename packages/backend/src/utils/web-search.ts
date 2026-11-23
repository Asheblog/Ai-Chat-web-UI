import { BackendLogger as log } from './logger'
import { WEB_SEARCH_ENGINE_IDS, type WebSearchEngine } from '@aichat/shared/web-search-contract'
import { DeepSeekToolError, runDeepSeekSearch } from './deepseek-tools'
import { combineAbortSignals } from './abort-signal'

export type WebSearchQueryLanguage = 'zh' | 'en' | 'unknown'

/**
 * 搜索命中里 content 字段的真实种类。
 * 只有 article 可以当正文复用；summary / highlight / snippet 只能作为摘要证据。
 */
export type WebSearchContentKind = 'article' | 'summary' | 'highlight' | 'snippet'

/**
 * content 的提供方与长度信息。独立于 sourceEngines：命中来自多个引擎不代表多份正文。
 */
export interface WebSearchContentMetadata {
  provider: string
  kind: WebSearchContentKind
  chars: number
  /** 提供方对正文长度设了硬上限，内容可能被截断（例如 Exa contents.text.maxCharacters）。 */
  truncated?: boolean
  maxChars?: number
}

export interface WebSearchHit {
  title: string
  url: string
  snippet?: string
  content?: string
  imageUrl?: string
  thumbnailUrl?: string
  engine?: string
  query?: string
  queryLanguage?: WebSearchQueryLanguage
  rank?: number
  sourceEngines?: string[]
  mergeScore?: number
  /** 发布/更新时间，来自各引擎文档化字段（Tavily published_date、Brave page_age、Exa publishedDate、DeepSeek date）。 */
  publishedDate?: string
  /** 站点名，来自文档化字段（Brave profile.name、DeepSeek site_name）。 */
  siteName?: string
  /** DeepSeek 权威性评分（0-4，-1 未知）。 */
  authority?: number
  /** content 的种类。缺省表示该提供方没有声明，按最弱的 snippet 处理，不会被当成正文。 */
  contentKind?: WebSearchContentKind
  /** 实际提供 content 的提供方，与 sourceEngines 没有必然关系。 */
  contentSource?: string
  contentMetadata?: WebSearchContentMetadata
  /**
   * 时间窗核验状态。in_range 表示引擎声明的发布/更新日期落在请求窗口内；
   * undated 表示没有可解析日期，保留但不代表已确认在窗口内。
   */
  timeRangeStatus?: 'in_range' | 'undated'
}

/**
 * 只有带正文来源标记且非空的内容才算全文。
 * 不能仅凭 content 非空或 sourceEngines 含某个引擎推断正文。
 */
export const isArticleContent = (
  hit: Pick<WebSearchHit, 'content' | 'contentKind'> | null | undefined,
): boolean => Boolean(hit && hit.contentKind === 'article' && (hit.content || '').trim().length > 0)

/** 正文种类强弱：合并时只能整体取某一提供方的 (content, kind, source) 三元组。 */
const CONTENT_KIND_WEIGHT: Record<WebSearchContentKind, number> = {
  article: 3,
  summary: 2,
  highlight: 1,
  snippet: 0,
}

const buildContentMetadata = (
  provider: string,
  kind: WebSearchContentKind,
  content: string,
  extra: { truncated?: boolean; maxChars?: number } = {},
): WebSearchContentMetadata => ({
  provider,
  kind,
  chars: content.length,
  ...(extra.truncated ? { truncated: true } : {}),
  ...(typeof extra.maxChars === 'number' ? { maxChars: extra.maxChars } : {}),
})

export interface WebSearchOptions {
  engine: string
  apiKey?: string
  limit: number
  domains?: string[]
  endpoint?: string
  scope?: string
  includeSummary?: boolean
  includeRawContent?: boolean
  /** 自动阅读需要正文：只开启引擎既有的正文能力，不改条数与长度上限，也不引入新服务。 */
  autoReadNeedContent?: boolean
  deepseekNeedContent?: boolean
  /** 触发检索的用户原始问题，供支持 ori_question 的引擎理解意图（DeepSeek）。 */
  oriQuestion?: string
  /** 可选的发布时间窗，只有引擎文档字段支持的才下发。 */
  timeRange?: WebSearchTimeRange
  signal?: AbortSignal
}

export interface WebSearchParallelQuery {
  query: string
  queryLanguage?: WebSearchQueryLanguage
}

export interface WebSearchParallelQueryPlan extends WebSearchParallelQuery {
  engines: string[]
}

export interface WebSearchParallelTask {
  engine: string
  query: string
  queryLanguage: WebSearchQueryLanguage
  queryIndex: number
  taskIndex: number
}

/**
 * 任务级失败种类：把「上游没交付」「超时」「被取消」「没凭据」分开，
 * 供父结果生成可机读结论，而不是让调用方解析错误文案。
 */
export type WebSearchTaskFailureKind =
  | 'upstream_error'
  | 'rate_limited'
  | 'timeout'
  | 'cancelled'
  | 'network'
  | 'no_credential'
  | 'unsupported'
  | 'invalid_response'

/**
 * 上游失败里「换一次可能成功」的种类：退避记账与父结果 retryable 投影共用这一处，
 * 调用点不要再各自维护一份集合。
 */
export const RETRYABLE_WEB_SEARCH_FAILURE_KINDS: ReadonlySet<WebSearchTaskFailureKind> = new Set([
  'upstream_error',
  'rate_limited',
  'network',
  'timeout',
])

export interface WebSearchTaskResult {
  task: WebSearchParallelTask
  status: 'success' | 'error'
  hits: WebSearchHit[]
  error?: string
  failureKind?: WebSearchTaskFailureKind
  errorCode?: string
  httpStatus?: number
  /** 上游 Retry-After 的毫秒数；只做提示，不推断账户或配额成因。 */
  retryAfterMs?: number
  durationMs?: number
  /** 本次请求是否把时间窗下发给该引擎；undefined 表示没有请求时间窗。 */
  timeRangeApplied?: boolean
}

/** 时间窗请求；日期为 YYYY-MM-DD，单边也允许。 */
export interface WebSearchTimeRange {
  start?: string
  end?: string
}

export interface WebSearchParallelOptions {
  engines: string[]
  engineOrder?: string[]
  apiKeys: Partial<Record<string, string>>
  queries: WebSearchParallelQuery[]
  queryPlans?: WebSearchParallelQueryPlan[]
  /** 用户原始问题，供支持 ori_question 的引擎理解意图；不参与路由与合并。 */
  originalQuery?: string
  limit: number
  domains?: string[]
  endpoint?: string
  scope?: string
  includeSummary?: boolean
  includeRawContent?: boolean
  /** 自动阅读需要正文：透传给支持正文能力的引擎（Tavily / Exa / Metaso / DeepSeek）。 */
  autoReadNeedContent?: boolean
  deepseekNeedContent?: boolean
  timeoutMs?: number
  parallelMaxEngines?: number
  timeRange?: WebSearchTimeRange
  signal?: AbortSignal
}

export interface WebSearchParallelResult {
  hits: WebSearchHit[]
  tasks: WebSearchTaskResult[]
}

const DEFAULT_LIMIT = 4
const DEFAULT_PARALLEL_TIMEOUT_MS = 12_000
const SUPPORTED_ENGINES = WEB_SEARCH_ENGINE_IDS
type SupportedSearchEngine = WebSearchEngine

const TAVILY_SEARCH_ENDPOINT = 'https://api.tavily.com/search'
const TAVILY_MAX_DOMAINS = 300
const TAVILY_CHUNKS_PER_SOURCE = 3
const BRAVE_WEB_SEARCH_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search'
const BRAVE_IMAGE_SEARCH_ENDPOINT = 'https://api.search.brave.com/res/v1/images/search'
const METASO_SEARCH_ENDPOINT = 'https://metaso.cn/api/v1/search'
const EXA_SEARCH_ENDPOINT = 'https://api.exa.ai/search'
const EXA_RAW_TEXT_MAX_CHARS = 4000

/**
 * Metaso 官方 Search API 只接受这六个 scope（见 metaso.cn/search-api/playground）。
 * 项目词汇里的 paper 表示论文/文献，映射到官方 scholar。
 */
export const METASO_SCOPE_IDS = ['webpage', 'document', 'scholar', 'image', 'video', 'podcast'] as const
export type MetasoScope = (typeof METASO_SCOPE_IDS)[number]

const METASO_SCOPE_BY_PROJECT_SCOPE: Record<string, MetasoScope> = {
  webpage: 'webpage',
  web: 'webpage',
  document: 'document',
  paper: 'scholar',
  scholar: 'scholar',
  image: 'image',
  video: 'video',
  podcast: 'podcast',
}

export const resolveMetasoScope = (scope?: string): MetasoScope => {
  const normalized = (scope || '').trim().toLowerCase()
  return METASO_SCOPE_BY_PROJECT_SCOPE[normalized] || 'webpage'
}

const clampLimit = (value?: number) => {
  if (!value || Number.isNaN(value)) return DEFAULT_LIMIT
  return Math.max(1, Math.min(10, value))
}

const normalizeDomains = (domains?: string[]) =>
  Array.isArray(domains) ? domains.map((d) => d.trim()).filter(Boolean) : []

const normalizeEngine = (value: string) => value.trim().toLowerCase()

const isSupportedEngine = (engine: string): engine is SupportedSearchEngine =>
  (SUPPORTED_ENGINES as readonly string[]).includes(engine)

const looksLikeImageUrl = (value: string): boolean =>
  /^https?:\/\/.+\.(?:png|jpe?g|gif|webp|svg|bmp|avif)(?:[?#].*)?$/i.test(value)

const pickFirstString = (...candidates: unknown[]): string | undefined => {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }
  return undefined
}

const pickImageUrl = (item: any): string | undefined => {
  const fromImagesArray = (() => {
    const first = item?.images?.[0]
    if (typeof first === 'string' && first.trim()) return first.trim()
    if (first && typeof first === 'object') {
      return pickFirstString(first.url, first.src, first.imageUrl, first.href)
    }
    return undefined
  })()

  const fromExtras = (() => {
    const links = item?.extras?.imageLinks
    if (!Array.isArray(links) || links.length === 0) return undefined
    const first = links[0]
    if (typeof first === 'string' && first.trim()) return first.trim()
    if (first && typeof first === 'object') {
      return pickFirstString(first.url, first.src, first.href)
    }
    return undefined
  })()

  const direct = pickFirstString(
    item?.imageUrl,
    item?.image_url,
    typeof item?.image === 'string' ? item.image : undefined,
    item?.imageSrc,
    item?.image_src,
    item?.cover,
    item?.coverUrl,
    item?.cover_url,
    item?.pic,
    item?.picUrl,
    item?.pic_url,
    item?.thumbnail?.original,
    fromImagesArray,
    fromExtras,
  )
  if (direct) return direct
  const nested = pickFirstString(item?.image?.url, item?.image?.src)
  if (nested) return nested
  const fallbackUrl = pickFirstString(item?.url)
  return fallbackUrl && looksLikeImageUrl(fallbackUrl) ? fallbackUrl : undefined
}

const pickThumbnailUrl = (item: any): string | undefined =>
  pickFirstString(
    item?.thumbnailUrl,
    item?.thumbnail_url,
    typeof item?.thumbnail === 'string' ? item.thumbnail : undefined,
    item?.thumbnail?.src,
    item?.thumbnail?.original,
    item?.thumb,
    item?.previewImage,
    item?.preview_image,
    item?.image?.thumbnail,
    typeof item?.images?.[0] === 'string' ? item.images[0] : undefined,
    item?.images?.[0]?.thumbnail,
    item?.images?.[0]?.url,
  )

/**
 * 引擎失败错误：只保留状态码与 Retry-After 提示，不回显上游响应体。
 * 上游错误体可能原样包含 API Key（各引擎都会出现），已有测试把「不泄露上游正文」定为契约。
 */
export class WebSearchEngineError extends Error {
  readonly failureKind: WebSearchTaskFailureKind
  readonly errorCode?: string
  readonly httpStatus?: number
  readonly retryAfterMs?: number

  constructor(
    message: string,
    init: {
      failureKind: WebSearchTaskFailureKind
      errorCode?: string
      httpStatus?: number
      retryAfterMs?: number
    },
  ) {
    super(message)
    this.name = 'WebSearchEngineError'
    this.failureKind = init.failureKind
    this.errorCode = init.errorCode
    this.httpStatus = init.httpStatus
    this.retryAfterMs = init.retryAfterMs
  }
}

/** Retry-After 既可能是秒数也可能是 HTTP 日期；无法解析就不猜。 */
export const parseRetryAfterMs = (value: string | null): number | undefined => {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000
  const parsed = Date.parse(trimmed)
  if (Number.isNaN(parsed)) return undefined
  return Math.max(0, parsed - Date.now())
}

const buildHttpError = (label: string, response: Response): WebSearchEngineError => {
  const retryAfter = response.headers.get('retry-after')
  const retryAfterMs = parseRetryAfterMs(retryAfter)
  const retryHint = retryAfter ? ` (retry after ${retryAfter}s)` : ''
  return new WebSearchEngineError(`${label} failed: ${response.status}${retryHint}`, {
    failureKind: response.status === 429 ? 'rate_limited' : 'upstream_error',
    errorCode: `HTTP_${response.status}`,
    httpStatus: response.status,
    retryAfterMs,
  })
}

/** 把用户填写的域名/URL 归一成主机名，供白名单匹配与站点操作符复用。 */
const normalizeDomainHost = (value: string): string => {
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
  return normalized.split('/')[0]?.split(':')[0]?.replace(/^\.+|\.+$/g, '') || ''
}

/** 公开的主机名归一化入口：工具参数与配置白名单共用同一套规则。 */
export const normalizeSearchDomainHost = (value: string): string => normalizeDomainHost(value)

const normalizeDomainHosts = (domains?: string[]): string[] =>
  Array.from(new Set(normalizeDomains(domains).map(normalizeDomainHost).filter(Boolean)))

const isHostnameWithinDomains = (hostname: string, domains: string[]): boolean =>
  domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))

/** 对没有服务端域名参数的引擎做统一白名单收口，保持与 UI「域名白名单」同义。 */
const filterHitsByDomains = (hits: WebSearchHit[], domains: string[]): WebSearchHit[] => {
  if (domains.length === 0) return hits
  return hits.filter((hit) => {
    if (!hit.url) return false
    try {
      return isHostnameWithinDomains(new URL(hit.url).hostname.toLowerCase(), domains)
    } catch {
      return false
    }
  })
}

const ISO_DATE_PREFIX_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * 归一成 YYYY-MM-DD（UTC）。无法解析返回 null，由调用方决定是 invalid_request 还是忽略。
 * 不在这里自动反转或放宽窗口。
 */
export const normalizeTimeRangeDate = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const dateOnly = trimmed.slice(0, 10)
  if (ISO_DATE_PREFIX_RE.test(dateOnly)) {
    const parsed = Date.parse(`${dateOnly}T00:00:00.000Z`)
    if (Number.isNaN(parsed)) return null
    // 2026-02-31 这类会被 Date.parse 规范化的日期必须拒绝，不能悄悄改成 03-03
    return new Date(parsed).toISOString().slice(0, 10) === dateOnly ? dateOnly : null
  }
  const parsed = Date.parse(trimmed)
  if (Number.isNaN(parsed)) return null
  return new Date(parsed).toISOString().slice(0, 10)
}

export const normalizeTimeRange = (timeRange?: WebSearchTimeRange): WebSearchTimeRange | undefined => {
  if (!timeRange) return undefined
  const start = normalizeTimeRangeDate(timeRange.start)
  const end = normalizeTimeRangeDate(timeRange.end)
  if (!start && !end) return undefined
  return {
    ...(start ? { start } : {}),
    ...(end ? { end } : {}),
  }
}

/**
 * 只有文档支持时间参数的引擎才下发：Tavily / Exa 支持单边，Brave 只支持双边区间，
 * Metaso / DeepSeek 没有文档参数，返回 false 并由本地日期过滤兜底。
 */
export const applyTimeRangeToEngineRequest = (
  engine: string,
  timeRange?: WebSearchTimeRange,
): boolean => {
  if (!timeRange) return false
  const hasAny = Boolean(timeRange.start || timeRange.end)
  const hasBoth = Boolean(timeRange.start && timeRange.end)
  switch (normalizeEngine(engine)) {
    case 'tavily':
    case 'exa':
      return hasAny
    case 'brave':
      return hasBoth
    default:
      return false
  }
}

/**
 * 本地时间窗核验：能解析日期的命中才可能判定 in_range，越界丢弃；
 * 没有可解析日期的命中保留为 undated，表示未核实而不是已确认。
 */
export const applyTimeRangeToHits = (
  hits: WebSearchHit[],
  timeRange: WebSearchTimeRange,
): WebSearchHit[] => {
  const startMs = timeRange.start ? Date.parse(`${timeRange.start}T00:00:00.000Z`) : null
  const endMs = timeRange.end ? Date.parse(`${timeRange.end}T23:59:59.999Z`) : null
  const filtered: WebSearchHit[] = []
  for (const hit of hits) {
    const parsed = hit.publishedDate ? Date.parse(hit.publishedDate) : Number.NaN
    if (Number.isNaN(parsed)) {
      filtered.push({ ...hit, timeRangeStatus: 'undated' })
      continue
    }
    if (startMs !== null && parsed < startMs) continue
    if (endMs !== null && parsed > endMs) continue
    filtered.push({ ...hit, timeRangeStatus: 'in_range' })
  }
  return filtered
}

/** Brave 官方支持 site: 与 OR 操作符（大写），用它表达域名白名单。 */
const buildBraveSiteFilter = (domains: string[]): string => {
  if (domains.length === 0) return ''
  return domains.map((domain) => `site:${domain}`).join(' OR ')
}

const buildUrlWithParams = (endpoint: string, params: Record<string, string>): string => {
  try {
    const url = new URL(endpoint)
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }
    return url.toString()
  } catch {
    const search = new URLSearchParams(params).toString()
    return `${endpoint}${endpoint.includes('?') ? '&' : '?'}${search}`
  }
}

const normalizeUrlForDedupe = (rawUrl: string): string => {
  if (!rawUrl) return ''
  try {
    const parsed = new URL(rawUrl)
    parsed.hash = ''
    const stripKeys = [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'gclid',
      'fbclid',
      'igshid',
      'mc_cid',
      'mc_eid',
      'ref',
      'source',
    ]
    for (const key of stripKeys) {
      parsed.searchParams.delete(key)
    }
    parsed.searchParams.sort()
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/'
    return parsed.toString()
  } catch {
    return rawUrl.trim()
  }
}

/** 公开的 URL 归一化入口：自动阅读去重与合并去重使用同一套规则，保留有语义的 query 参数。 */
export const normalizeSearchUrl = normalizeUrlForDedupe

const getEngineWeight = (engine: string, engineOrder: string[]): number => {
  const idx = engineOrder.indexOf(engine)
  if (idx < 0) return 0
  return Math.max(0, engineOrder.length - idx)
}

const normalizeEngineOrderForMerge = (
  engines: string[],
  engineOrder?: string[],
): string[] => {
  const normalizedEngines = Array.from(
    new Set((engines || []).map((engine) => normalizeEngine(engine)).filter(Boolean)),
  )
  const normalizedOrder = Array.from(
    new Set((engineOrder || []).map((engine) => normalizeEngine(engine)).filter(Boolean)),
  )
  return [
    ...normalizedOrder.filter((engine) => normalizedEngines.includes(engine)),
    ...normalizedEngines.filter((engine) => !normalizedOrder.includes(engine)),
  ]
}

export const formatHitsForModel = (query: string, hits: WebSearchHit[]): string => {
  if (hits.length === 0) {
    return `Web search for "${query}" returned no results.`
  }
  const lines = hits.map((hit, idx) => {
    const snippet = hit.snippet || hit.content || ''
    const engineText = hit.sourceEngines?.length
      ? `Engines: ${hit.sourceEngines.join(', ')}`
      : hit.engine
        ? `Engine: ${hit.engine}`
        : 'Engine: unknown'
    const languageText = `QueryLang: ${hit.queryLanguage || 'unknown'}`
    const metaText = [
      hit.siteName ? `Site: ${hit.siteName}` : '',
      hit.publishedDate ? `Published: ${hit.publishedDate}` : '',
      typeof hit.authority === 'number' && hit.authority >= 0 ? `Authority: ${hit.authority}` : '',
    ]
      .filter(Boolean)
      .join(' | ')
    const imageText = (hit.imageUrl || hit.thumbnailUrl) ? `Image: ${hit.imageUrl || hit.thumbnailUrl}` : ''
    const top = `${idx + 1}. ${hit.title || 'Untitled'}\nURL: ${hit.url}\n${engineText} | ${languageText}${metaText ? ` | ${metaText}` : ''}\nSummary: ${snippet}`
    return imageText ? `${top}\n${imageText}`.trim() : top.trim()
  })
  return `Web search results for "${query}":\n\n${lines.join('\n\n')}`
}

const isImageScopeOption = (scope?: string): boolean =>
  (scope || '').trim().toLowerCase() === 'image'

const runTavilySearch = async (query: string, opts: WebSearchOptions): Promise<WebSearchHit[]> => {
  if (!opts.apiKey) {
    throw new Error('Tavily API key is not configured')
  }
  const endpoint = opts.endpoint || TAVILY_SEARCH_ENDPOINT
  const isImageScope = isImageScopeOption(opts.scope)
  // 自动阅读需要正文时同样请求 raw_content；图片搜索保持既有行为
  const wantRawContent = !isImageScope && Boolean(opts.includeRawContent || opts.autoReadNeedContent)
  const payload: Record<string, unknown> = {
    query,
    max_results: clampLimit(opts.limit),
    include_answer: false,
    // 官方默认 false；显式打开后每条 result 可带页面关联图，并在响应顶层返回 query 相关图片
    include_images: true,
    // 官方 beta 字段：每条 result 附 published_date，供证据时效判断
    include_published_date: true,
    search_depth: 'advanced',
  }
  if (wantRawContent) {
    // 官方文档：markdown 返回清洗后的正文（raw_content），可直接作为网页证据复用
    payload.include_raw_content = 'markdown'
  } else {
    // 不取正文时显式保留 3 段语义片段，避免上游默认值变化影响 content 质量
    payload.chunks_per_source = TAVILY_CHUNKS_PER_SOURCE
  }
  if (isImageScope) {
    payload.include_image_descriptions = true
  }
  const domains = normalizeDomainHosts(opts.domains).slice(0, TAVILY_MAX_DOMAINS)
  if (domains.length > 0) {
    payload.include_domains = domains
  }
  // 官方 start_date/end_date：单边也允许；没有请求时间窗时不写这两个字段
  if (opts.timeRange?.start) payload.start_date = opts.timeRange.start
  if (opts.timeRange?.end) payload.end_date = opts.timeRange.end

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      // 官方 OpenAPI 的鉴权方式：Authorization: Bearer <api key>
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: opts.signal,
  })
  if (!response.ok) {
    throw buildHttpError('Tavily search', response)
  }
  const data = await response.json() as any

  if (isImageScope) {
    const topImages = Array.isArray(data?.images) ? data.images : []
    return topImages
      .map((item: any): WebSearchHit | null => {
        if (typeof item === 'string') {
          const imageUrl = item.trim()
          if (!imageUrl) return null
          return {
            title: imageUrl,
            url: imageUrl,
            snippet: '',
            imageUrl,
            thumbnailUrl: imageUrl,
          }
        }
        if (!item || typeof item !== 'object') return null
        const imageUrl =
          pickFirstString(item.url, item.imageUrl, item.image_url, item.src) || pickImageUrl(item)
        if (!imageUrl) return null
        const description = typeof item.description === 'string' ? item.description.trim() : ''
        return {
          title: description || imageUrl,
          url: imageUrl,
          snippet: description,
          content: description,
          contentKind: description ? 'snippet' : undefined,
          contentSource: description ? 'tavily' : undefined,
          contentMetadata: description ? buildContentMetadata('tavily', 'snippet', description) : undefined,
          imageUrl,
          thumbnailUrl: pickThumbnailUrl(item) || imageUrl,
        }
      })
      .filter((hit: WebSearchHit | null): hit is WebSearchHit => Boolean(hit))
      .slice(0, clampLimit(opts.limit))
  }

  const results = Array.isArray(data?.results) ? data.results : []
  return results.map((item: any) => {
    const snippet = pickFirstString(item?.content, item?.snippet) || ''
    // 官方字段语义：raw_content 是清洗后的正文，content 是命中片段。两者不能混为一谈
    const rawContent = pickFirstString(item?.raw_content) || ''
    const content = rawContent || snippet
    const contentKind: WebSearchContentKind | undefined = content
      ? rawContent
        ? 'article'
        : 'snippet'
      : undefined
    return {
      title: item?.title || item?.url || 'Untitled',
      url: item?.url || '',
      snippet,
      content,
      contentKind,
      contentSource: contentKind ? 'tavily' : undefined,
      contentMetadata: contentKind
        ? buildContentMetadata('tavily', contentKind, content)
        : undefined,
      imageUrl: pickImageUrl(item),
      thumbnailUrl: pickThumbnailUrl(item),
      publishedDate: pickFirstString(item?.published_date),
    } satisfies WebSearchHit
  })
}

const runBraveSearch = async (query: string, opts: WebSearchOptions): Promise<WebSearchHit[]> => {
  if (!opts.apiKey) {
    throw new Error('Brave Search API key is not configured')
  }
  const domains = normalizeDomainHosts(opts.domains)
  const siteFilter = buildBraveSiteFilter(domains)
  const endpointParams: Record<string, string> = {
    q: siteFilter ? `${query} (${siteFilter})` : query,
    count: String(clampLimit(opts.limit)),
    // 官方默认 true 会在 description 里插入高亮标记字符，模型读到的是噪音
    text_decorations: 'false',
    // 每条结果再给 5 段备选摘录，用作 snippet 之外的正文线索
    extra_snippets: 'true',
  }
  // 官方 freshness 只接受 pd/pw/pm/py 或 YYYY-MM-DDtoYYYY-MM-DD：单边时间窗不下发
  if (opts.timeRange?.start && opts.timeRange?.end) {
    endpointParams.freshness = `${opts.timeRange.start}to${opts.timeRange.end}`
  }
  const endpoint = buildUrlWithParams(opts.endpoint || BRAVE_WEB_SEARCH_ENDPOINT, endpointParams)
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      'X-Subscription-Token': opts.apiKey,
      Accept: 'application/json',
    },
    signal: opts.signal,
  })
  if (!response.ok) {
    throw buildHttpError('Brave search', response)
  }
  const data = await response.json() as any
  const results = Array.isArray(data?.web?.results) ? data.web.results : []
  return results.map((item: any): WebSearchHit => {
    const extraSnippets = Array.isArray(item?.extra_snippets)
      ? item.extra_snippets.filter(
          (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0,
        )
      : []
    const description = pickFirstString(item?.description) || ''
    const snippet = pickFirstString(description, extraSnippets[0]) || ''
    const content = [description, ...extraSnippets].filter(Boolean).join('\n\n')
    const mergedContent = content || snippet
    return {
      title: item?.title || item?.url || 'Untitled',
      url: item?.url || '',
      snippet,
      content: mergedContent,
      // Brave 只返回描述与额外摘录，永远不是页正文
      contentKind: mergedContent ? 'snippet' : undefined,
      contentSource: mergedContent ? 'brave' : undefined,
      contentMetadata: mergedContent ? buildContentMetadata('brave', 'snippet', mergedContent) : undefined,
      imageUrl: pickFirstString(item?.thumbnail?.original, item?.thumbnail?.src) || pickImageUrl(item),
      thumbnailUrl: pickThumbnailUrl(item),
      publishedDate: pickFirstString(item?.page_age),
      siteName: pickFirstString(item?.profile?.name),
    }
  })
}

const runBraveImageSearch = async (query: string, opts: WebSearchOptions): Promise<WebSearchHit[]> => {
  if (!opts.apiKey) {
    throw new Error('Brave Search API key is not configured')
  }
  const endpoint = buildUrlWithParams(opts.endpoint || BRAVE_IMAGE_SEARCH_ENDPOINT, {
    q: query,
    count: String(clampLimit(opts.limit)),
  })
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      'X-Subscription-Token': opts.apiKey,
      Accept: 'application/json',
    },
    signal: opts.signal,
  })
  if (!response.ok) {
    throw buildHttpError('Brave image search', response)
  }
  const data = await response.json() as any
  const results = Array.isArray(data?.results) ? data.results : []
  return results.map((item: any): WebSearchHit => {
    // 官方图片结果：properties.url 是原图地址，thumbnail.src 是 Brave 缓存缩略图
    const directImage =
      pickFirstString(
        item?.properties?.url,
        item?.imageUrl,
        item?.image_url,
        typeof item?.image === 'string' ? item.image : undefined,
        item?.thumbnail?.original,
        item?.thumbnail?.src,
        item?.thumb,
      ) || pickImageUrl(item)
    const description = pickFirstString(item?.description, item?.snippet) || ''
    return {
      title: item?.title || item?.url || 'Untitled',
      url: item?.url || item?.pageUrl || item?.page_url || directImage || '',
      snippet: description,
      content: description,
      contentKind: description ? 'snippet' : undefined,
      contentSource: description ? 'brave' : undefined,
      contentMetadata: description ? buildContentMetadata('brave', 'snippet', description) : undefined,
      imageUrl: directImage,
      thumbnailUrl: pickThumbnailUrl(item) || directImage,
    }
  })
}

const runMetasoSearch = async (query: string, opts: WebSearchOptions): Promise<WebSearchHit[]> => {
  if (!opts.apiKey) {
    throw new Error('Metaso API key is not configured')
  }
  const endpoint = opts.endpoint || METASO_SEARCH_ENDPOINT
  const scope = resolveMetasoScope(opts.scope)
  const domains = normalizeDomainHosts(opts.domains)
  // 官方搜索请求体只有这些字段；stream/output/format 属于问答与读页接口，不属于搜索接口
  const payload: Record<string, unknown> = {
    q: query,
    scope,
    includeSummary: Boolean(opts.includeSummary),
    size: clampLimit(opts.limit),
    conciseSnippet: false,
  }
  if (scope === 'webpage') {
    // 官方说明：includeRawContent 只在网页范围内生效；自动阅读需要正文时一并开启
    payload.includeRawContent = Boolean(opts.includeRawContent || opts.autoReadNeedContent)
  }
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
    signal: opts.signal,
  })
  if (!response.ok) {
    throw buildHttpError('Metaso search', response)
  }
  const data = await response.json() as any
  const scopeCandidates: Record<string, any[] | undefined> = {
    webpage: data?.webpages || data?.results || data?.data?.webpages || data?.data?.results,
    document: data?.documents || data?.data?.documents,
    scholar: data?.scholars || data?.papers || data?.data?.scholars || data?.data?.papers,
    image: data?.images || data?.data?.images,
    video: data?.videos || data?.data?.videos,
    podcast: data?.podcasts || data?.data?.podcasts,
  }
  const candidateArrays = [
    scopeCandidates[scope],
    data?.data,
    data?.results,
    data?.hits,
    data?.list,
    data?.webpages,
    data?.items,
    data?.data?.data,
    data?.data?.results,
    data?.data?.hits,
    data?.data?.list,
    data?.data?.webpages,
    data?.data?.items,
  ]
  const results = (candidateArrays.find((item) => Array.isArray(item)) || []) as any[]
  // 官方说明：includeRawContent 只在网页范围生效；其它范围拿到的 content 只能是摘要/片段
  const wantsRawContent = Boolean(opts.includeRawContent) && scope === 'webpage'
  const hits = results.map((item: any): WebSearchHit => {
    const snippet = pickFirstString(item?.summary, item?.description, item?.snippet) || ''
    const rawCandidate = pickFirstString(item?.content) || ''
    const content = rawCandidate || snippet
    const contentKind: WebSearchContentKind | undefined = content
      ? wantsRawContent && rawCandidate
        ? 'article'
        : 'snippet'
      : undefined
    return {
      title: item?.title || item?.name || item?.url || 'Untitled',
      url: item?.url || item?.link || item?.imageUrl || '',
      snippet,
      content,
      contentKind,
      contentSource: contentKind ? 'metaso' : undefined,
      contentMetadata: contentKind
        ? buildContentMetadata('metaso', contentKind, content)
        : undefined,
      imageUrl: pickImageUrl(item),
      thumbnailUrl: pickThumbnailUrl(item),
    }
  })
  // Metaso 搜索接口没有域名参数，用统一白名单在这里收口
  return filterHitsByDomains(hits, domains)
}

const runExaSearch = async (query: string, opts: WebSearchOptions): Promise<WebSearchHit[]> => {
  if (!opts.apiKey) {
    throw new Error('Exa API key is not configured')
  }
  const endpoint = opts.endpoint || EXA_SEARCH_ENDPOINT
  const isImageScope = isImageScopeOption(opts.scope)
  const imageLinksCount = isImageScope ? 10 : 5
  const contents: Record<string, unknown> = {
    highlights: true,
    // Exa：代表图 image/favicon 随 contents 返回；再抽若干页内图片链接
    extras: { imageLinks: imageLinksCount },
  }
  if (!isImageScope && (opts.includeRawContent || opts.autoReadNeedContent)) {
    // 官方 contents.text 控制正文返回长度；不传则没有 text 字段
    contents.text = { maxCharacters: EXA_RAW_TEXT_MAX_CHARS }
  }
  if (opts.includeSummary) {
    // 官方 contents.summary 需要对象形式，query 用来指导摘要角度
    contents.summary = { query }
  }
  const payload: Record<string, unknown> = {
    query,
    numResults: clampLimit(opts.limit),
    type: 'auto',
    contents,
  }
  const domains = normalizeDomainHosts(opts.domains)
  if (domains.length > 0) {
    payload.includeDomains = domains
  }
  // 官方 startPublishedDate/endPublishedDate 需要 ISO 8601
  if (opts.timeRange?.start) payload.startPublishedDate = `${opts.timeRange.start}T00:00:00.000Z`
  if (opts.timeRange?.end) payload.endPublishedDate = `${opts.timeRange.end}T23:59:59.999Z`

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'x-api-key': opts.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: opts.signal,
  })
  if (!response.ok) {
    throw buildHttpError('Exa search', response)
  }
  const data = await response.json() as any
  const results = Array.isArray(data?.results) ? data.results : []

  if (isImageScope) {
    const flattened: WebSearchHit[] = []
    const seen = new Set<string>()
    for (const item of results) {
      const pageUrl = typeof item?.url === 'string' ? item.url : ''
      const title = item?.title || pageUrl || 'Untitled'
      const highlights = Array.isArray(item?.highlights) ? item.highlights : []
      const snippet = highlights[0] || ''
      const cover = pickImageUrl(item)
      const extraLinks = Array.isArray(item?.extras?.imageLinks)
        ? item.extras.imageLinks.filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0)
        : []
      for (const imageUrl of [cover, ...extraLinks]) {
        const normalized = typeof imageUrl === 'string' ? imageUrl.trim() : ''
        if (!normalized || seen.has(normalized)) continue
        seen.add(normalized)
        flattened.push({
          title,
          url: pageUrl || normalized,
          snippet,
          content: snippet,
          contentKind: snippet ? 'snippet' : undefined,
          contentSource: snippet ? 'exa' : undefined,
          contentMetadata: snippet ? buildContentMetadata('exa', 'snippet', snippet) : undefined,
          imageUrl: normalized,
          thumbnailUrl: normalized,
        })
      }
    }
    return flattened.slice(0, clampLimit(opts.limit))
  }

  return results.map((item: any): WebSearchHit => {
    const highlights = Array.isArray(item?.highlights)
      ? item.highlights.filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0)
      : []
    const text = typeof item?.text === 'string' ? item.text : ''
    // contents.text 是页面正文；summary 是模型摘要；highlights 是查询相关片段。三者不能互相冒充
    const candidates: Array<[WebSearchContentKind, string]> = [
      ['article', text],
      ['summary', pickFirstString(item?.summary) || ''],
      ['highlight', highlights.join('\n\n')],
    ]
    const picked = candidates.find(([, value]) => value.trim().length > 0)
    const contentKind: WebSearchContentKind | undefined = picked?.[0]
    const content = picked?.[1] || ''
    return {
      title: item?.title || item?.url || 'Untitled',
      url: item?.url || '',
      snippet: pickFirstString(highlights[0], item?.summary) || text.slice(0, 300) || '',
      content,
      contentKind,
      contentSource: contentKind ? 'exa' : undefined,
      contentMetadata: contentKind
        ? buildContentMetadata('exa', contentKind, content, {
            maxChars: contentKind === 'article' ? EXA_RAW_TEXT_MAX_CHARS : undefined,
            truncated: contentKind === 'article' && content.length >= EXA_RAW_TEXT_MAX_CHARS,
          })
        : undefined,
      imageUrl: pickImageUrl(item),
      thumbnailUrl: pickThumbnailUrl(item) || item?.favicon || '',
      publishedDate: pickFirstString(item?.publishedDate),
    }
  })
}

export const runWebSearch = async (query: string, opts: WebSearchOptions): Promise<WebSearchHit[]> => {
  const engine = normalizeEngine(opts.engine || '')
  log.debug('web search request', { engine, query })
  switch (engine) {
    case 'tavily':
      return runTavilySearch(query, opts)
    case 'brave':
      if (isImageScopeOption(opts.scope)) {
        return runBraveImageSearch(query, opts)
      }
      return runBraveSearch(query, opts)
    case 'metaso':
      return runMetasoSearch(query, opts)
    case 'exa':
      return runExaSearch(query, opts)
    case 'deepseek': {
      if (isImageScopeOption(opts.scope)) {
        throw new Error('DeepSeek web search does not support image scope')
      }
      const hits = await runDeepSeekSearch(query, {
        apiKey: opts.apiKey,
        limit: opts.limit,
        domains: opts.domains,
        scope: opts.scope,
        includeRawContent: Boolean(opts.includeRawContent || opts.deepseekNeedContent),
        oriQuestion: opts.oriQuestion,
        signal: opts.signal,
      })
      // need_content 打开时 content 是页面正文；来源固定为 DeepSeek，与其它引擎命中无关
      return hits.map((hit): WebSearchHit => {
        const content = typeof hit.content === 'string' ? hit.content : ''
        if (!content.trim()) return hit
        return {
          ...hit,
          contentKind: 'article',
          contentSource: 'deepseek',
          contentMetadata: buildContentMetadata('deepseek', 'article', content),
        }
      })
    }
    default:
      throw new Error(`Unsupported web search engine: ${engine || 'unknown'}`)
  }
}

const scoreHit = (
  hit: WebSearchHit,
  engine: string,
  rank: number,
  engineOrder: string[],
): number => {
  const base = Math.max(0, 100 - rank * 4)
  const engineWeight = getEngineWeight(engine, engineOrder) * 6
  const snippetWeight = Math.min(12, Math.floor((hit.snippet || hit.content || '').length / 80))
  return base + engineWeight + snippetWeight
}

const contentWeightOf = (hit: WebSearchHit): number => {
  const content = (hit.content || '').trim()
  if (!content) return -1
  // 没有种类标记的命中按最弱的片段处理：既不会被当成正文，也不会因合并被升级
  return hit.contentKind ? CONTENT_KIND_WEIGHT[hit.contentKind] : CONTENT_KIND_WEIGHT.snippet
}

/**
 * 合并后保留哪一份正文：整体取同一个提供方的 (content, contentKind, contentSource, contentMetadata)，
 * 不允许把 A 的正文和 B 的种类标签拼在一起。种类相同时取更长的内容。
 */
const pickContentProvenance = (
  current: WebSearchHit,
  incoming: WebSearchHit,
): Pick<WebSearchHit, 'content' | 'contentKind' | 'contentSource' | 'contentMetadata'> => {
  const pick = (hit: WebSearchHit) => ({
    content: hit.content,
    contentKind: hit.contentKind,
    contentSource: hit.contentSource,
    contentMetadata: hit.contentMetadata,
  })
  const currentContent = (current.content || '').trim()
  const incomingContent = (incoming.content || '').trim()
  if (!incomingContent) return pick(current)
  if (!currentContent) return pick(incoming)
  const currentWeight = contentWeightOf(current)
  const incomingWeight = contentWeightOf(incoming)
  if (incomingWeight > currentWeight) return pick(incoming)
  if (incomingWeight < currentWeight) return pick(current)
  return incomingContent.length > currentContent.length ? pick(incoming) : pick(current)
}

const mergeHits = (
  flatHits: WebSearchHit[],
  limit: number,
  engineOrder: string[],
): WebSearchHit[] => {
  const merged = new Map<
    string,
    {
      hit: WebSearchHit
      score: number
      engines: Set<string>
    }
  >()

  for (const hit of flatHits) {
    const dedupeKey = normalizeUrlForDedupe(hit.url) || `${hit.engine || 'unknown'}::${hit.title || ''}`
    const rank = typeof hit.rank === 'number' ? hit.rank : 99
    const engine = normalizeEngine(hit.engine || 'unknown')
    const score = scoreHit(hit, engine, rank, engineOrder)
    const existing = merged.get(dedupeKey)
    if (!existing) {
      merged.set(dedupeKey, {
        hit: { ...hit },
        score,
        engines: new Set<string>(engine ? [engine] : []),
      })
      continue
    }

    existing.engines.add(engine)
    // 正文来源与命中排序无关：排序高的引擎未必提供了正文，任何顺序都要保留真正的那份正文
    const contentProvenance = pickContentProvenance(existing.hit, hit)
    if (score > existing.score) {
      existing.score = score
      existing.hit = {
        ...existing.hit,
        ...hit,
        snippet:
          (hit.snippet || '').length >= (existing.hit.snippet || '').length
            ? hit.snippet
            : existing.hit.snippet,
        // 正文三元组只能整体取一个提供方，避免把摘要的 kind 换成别的引擎标签而"升级"成全文
        ...contentProvenance,
      }
    } else {
      existing.hit = { ...existing.hit, ...contentProvenance }
    }
  }

  const normalized = Array.from(merged.values())
    .map(({ hit, score, engines }) => ({
      ...hit,
      sourceEngines: Array.from(engines).sort(),
      mergeScore: score,
    }))
    .sort((a, b) => (b.mergeScore || 0) - (a.mergeScore || 0))

  return normalized.slice(0, clampLimit(limit)).map((item, index) => ({
    ...item,
    rank: index + 1,
  }))
}

/**
 * 把异常收敛成任务级失败种类。取消与超时由运行器自己掌握，
 * 优先级高于错误文本推断；错误文本只做兜底，不据此猜测账户或配额成因。
 */
const classifyTaskFailure = (
  error: unknown,
  flags: { timedOut: boolean; cancelled: boolean },
): Pick<WebSearchTaskResult, 'failureKind' | 'errorCode' | 'httpStatus' | 'retryAfterMs'> => {
  if (flags.cancelled) return { failureKind: 'cancelled', errorCode: 'CANCELLED' }
  if (flags.timedOut) return { failureKind: 'timeout', errorCode: 'TIMEOUT' }
  if (error instanceof WebSearchEngineError) {
    return {
      failureKind: error.failureKind,
      errorCode: error.errorCode,
      httpStatus: error.httpStatus,
      retryAfterMs: error.retryAfterMs,
    }
  }
  if (error instanceof DeepSeekToolError) {
    if (error.code === 'MISSING_API_KEY') return { failureKind: 'no_credential', errorCode: error.code }
    if (error.code === 'CANCELLED') return { failureKind: 'cancelled', errorCode: error.code }
    if (error.code === 'TIMEOUT') return { failureKind: 'timeout', errorCode: error.code }
    if (error.code === 'UNSUPPORTED_SCOPE') return { failureKind: 'unsupported', errorCode: error.code }
    if (error.code === 'INVALID_RESPONSE' || error.code === 'EMPTY_CONTENT') {
      return { failureKind: 'invalid_response', errorCode: error.code }
    }
    if (typeof error.status === 'number') {
      return {
        failureKind: error.status === 429 ? 'rate_limited' : 'upstream_error',
        errorCode: error.code,
        httpStatus: error.status,
      }
    }
    return { failureKind: 'upstream_error', errorCode: error.code }
  }
  if (error instanceof TypeError) return { failureKind: 'network', errorCode: 'FETCH_FAILED' }
  return { failureKind: 'upstream_error', errorCode: 'SEARCH_ERROR' }
}

export const runWebSearchParallel = async (
  opts: WebSearchParallelOptions,
): Promise<WebSearchParallelResult> => {
  const engineCandidates = Array.from(
    new Set((opts.engines || []).map((engine) => normalizeEngine(engine)).filter(Boolean))
  ).filter(isSupportedEngine)
  const maxEngines = Math.max(
    1,
    Math.min(
      SUPPORTED_ENGINES.length,
      Math.floor(opts.parallelMaxEngines || engineCandidates.length || 1),
    ),
  )
  const engineOrderRaw = Array.from(
    new Set((opts.engineOrder || []).map((engine) => normalizeEngine(engine)).filter(Boolean))
  ).filter(isSupportedEngine)
  const selectedEngines = [
    ...engineOrderRaw.filter((engine) => engineCandidates.includes(engine)),
    ...engineCandidates.filter((engine) => !engineOrderRaw.includes(engine)),
  ].slice(0, maxEngines)

  // 确保 queryPlans 中引用的引擎不被 top-N 截断
  const planEngineSet = new Set(selectedEngines)
  for (const plan of (opts.queryPlans || [])) {
    for (const engine of (plan.engines || [])) {
      const normalized = normalizeEngine(engine)
      if (isSupportedEngine(normalized) && engineCandidates.includes(normalized as SupportedSearchEngine)) {
        planEngineSet.add(normalized)
      }
    }
  }

  const normalizedQueries = (opts.queries || [])
    .map((item) => ({
      query: (item.query || '').trim(),
      queryLanguage: item.queryLanguage || 'unknown',
    }))
    .filter((item) => item.query.length > 0)

  const normalizedQueryPlans = (opts.queryPlans || [])
    .map((item) => ({
      query: (item.query || '').trim(),
      queryLanguage: item.queryLanguage || 'unknown',
      engines: Array.from(
        new Set((item.engines || []).map((engine) => normalizeEngine(engine)).filter(Boolean)),
      ).filter((engine): engine is SupportedSearchEngine => planEngineSet.has(engine as SupportedSearchEngine)),
    }))
    .filter((item) => item.query.length > 0 && item.engines.length > 0)

  if (selectedEngines.length === 0 || (normalizedQueries.length === 0 && normalizedQueryPlans.length === 0)) {
    return { hits: [], tasks: [] }
  }

  const tasks: WebSearchParallelTask[] = []
  let taskIndex = 0
  if (normalizedQueryPlans.length > 0) {
    for (const [queryIndex, queryItem] of normalizedQueryPlans.entries()) {
      tasks.push({
        engine: queryItem.engines[0],
        query: queryItem.query,
        queryLanguage: queryItem.queryLanguage,
        queryIndex,
        taskIndex,
      })
      taskIndex += 1
      for (let idx = 1; idx < queryItem.engines.length; idx += 1) {
        tasks.push({
          engine: queryItem.engines[idx],
          query: queryItem.query,
          queryLanguage: queryItem.queryLanguage,
          queryIndex,
          taskIndex,
        })
        taskIndex += 1
      }
    }
  } else {
    for (const [queryIndex, queryItem] of normalizedQueries.entries()) {
      for (const engine of selectedEngines) {
        tasks.push({
          engine,
          query: queryItem.query,
          queryLanguage: queryItem.queryLanguage,
          queryIndex,
          taskIndex,
        })
        taskIndex += 1
      }
    }
  }

  const timeoutMs = Math.max(1000, opts.timeoutMs || DEFAULT_PARALLEL_TIMEOUT_MS)
  const timeRange = normalizeTimeRange(opts.timeRange)

  const taskResults = await Promise.all(
    tasks.map(async (task): Promise<WebSearchTaskResult> => {
      const apiKey = (opts.apiKeys?.[task.engine] || '').trim()
      const timeRangeApplied = timeRange
        ? applyTimeRangeToEngineRequest(task.engine, timeRange)
        : undefined
      const withTimeRange = (result: WebSearchTaskResult): WebSearchTaskResult =>
        timeRangeApplied === undefined ? result : { ...result, timeRangeApplied }

      if (!apiKey) {
        return withTimeRange({
          task,
          status: 'error',
          hits: [],
          error: `API key for ${task.engine} is not configured`,
          failureKind: 'no_credential',
          errorCode: 'NO_CREDENTIAL',
        })
      }

      const abortController = new AbortController()
      let timedOut = false
      const timeoutId = setTimeout(() => {
        timedOut = true
        abortController.abort()
      }, timeoutMs)
      const combinedSignal = combineAbortSignals(abortController.signal, opts.signal)
      const startedAt = Date.now()
      try {
        const hits = await runWebSearch(task.query, {
          engine: task.engine,
          apiKey,
          limit: opts.limit,
          domains: opts.domains,
          endpoint: opts.endpoint,
          scope: opts.scope,
          includeSummary: opts.includeSummary,
          includeRawContent: opts.includeRawContent,
          autoReadNeedContent: opts.autoReadNeedContent,
          deepseekNeedContent: opts.deepseekNeedContent,
          oriQuestion: opts.originalQuery,
          timeRange,
          signal: combinedSignal.signal,
        })

        const normalizedHits = hits
          .filter((hit) => hit.url)
          .map((hit, idx) => ({
            ...hit,
            engine: task.engine,
            query: task.query,
            queryLanguage: task.queryLanguage,
            rank: idx + 1,
          }))
        // 引擎没有时间参数时靠本地日期核验；没有可解析日期的命中标记 undated 而不是丢弃
        const scopedHits = timeRange ? applyTimeRangeToHits(normalizedHits, timeRange) : normalizedHits

        return withTimeRange({
          task,
          status: 'success',
          hits: scopedHits,
          durationMs: Date.now() - startedAt,
        })
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown search error'
        return withTimeRange({
          task,
          status: 'error',
          hits: [],
          error: message,
          durationMs: Date.now() - startedAt,
          ...classifyTaskFailure(error, {
            timedOut,
            cancelled: Boolean(opts.signal?.aborted),
          }),
        })
      } finally {
        clearTimeout(timeoutId)
        combinedSignal.cleanup()
      }
    }),
  )

  const executedEngines = Array.from(
    new Set(taskResults.map((result) => result.task.engine).filter(Boolean)),
  )
  const mergeOrder = normalizeEngineOrderForMerge(executedEngines, opts.engineOrder)
  const mergedHits = mergeHits(taskResults.flatMap((result) => result.hits), opts.limit, mergeOrder)

  return {
    hits: mergedHits,
    tasks: taskResults,
  }
}

export const mergeWebSearchParallelResults = (
  results: WebSearchParallelResult[],
  limit: number,
  engineOrder?: string[],
): WebSearchParallelResult => {
  const mergedTasks = results.flatMap((result) => result.tasks)
  const enginesFromTasks = Array.from(
    new Set(
      mergedTasks
        .map((result) => normalizeEngine(result.task.engine || ''))
        .filter(Boolean),
    ),
  )
  const mergeOrder = normalizeEngineOrderForMerge(enginesFromTasks, engineOrder)
  return {
    hits: mergeHits(mergedTasks.flatMap((result) => result.hits), limit, mergeOrder),
    tasks: mergedTasks,
  }
}
