/**
 * Web 搜索工具处理器
 */

import { randomUUID } from 'node:crypto'
import {
  runWebSearchParallel,
  mergeWebSearchParallelResults,
  formatHitsForModel,
  normalizeSearchUrl,
  type WebSearchHit,
  type WebSearchQueryLanguage,
  type WebSearchParallelQuery,
  type WebSearchParallelQueryPlan,
  type WebSearchParallelResult,
  type WebSearchTaskResult,
} from '../../../utils/web-search'
import { truncateText } from '../../../utils/parsers'
import { WEB_SEARCH_SCOPE_IDS, isWebSearchScope } from '@aichat/shared/web-search-contract'
import { WEB_SEARCH_AUTO_READ_BATCH_TIMEOUT_MS } from '@aichat/shared'
import { readUrlContent, type UrlReadResult, type UrlReaderOptions } from '../../../utils/url-reader'
import {
  DEFAULT_AUTO_READ_BATCH_TIMEOUT_MS,
  runSearchAutoReadBatch,
  type AutoReadCandidate,
  type AutoReadEvent,
  type AutoReadFallbackUsed,
  type AutoReadItem,
} from './web-search-auto-read'
import type {
  IToolHandler,
  ToolCall,
  ToolCallContext,
  ToolDefinition,
  ToolHandlerResult,
  ToolLogDetails,
  WebSearchHandlerConfig,
} from '../../../agent-runtime/tool-handler-types'

const DEFAULT_AUTO_READ_TOP_K = 2
const DEFAULT_AUTO_READ_TIMEOUT_MS = 18000
const DEFAULT_AUTO_READ_MAX_CONTENT_LENGTH = 24000
const DEFAULT_AUTO_READ_PARALLELISM = 2
const DEFAULT_MODEL_EVIDENCE_CHARS = 2200
const DEFAULT_MODEL_RESULT_HITS = 5
const DEFAULT_MODEL_TASK_RESULTS = 6
const DEFAULT_MODEL_SNIPPET_CHARS = 360
const DEFAULT_MODEL_SUMMARY_CHARS = 3200
// 与自动阅读的候选上限一致：模型最多看到 4 条阅读证据，不额外隐藏失败项
const DEFAULT_MODEL_EVIDENCE_ITEMS = 4
const DEFAULT_MODEL_EVIDENCE_ITEM_CHARS = 900
const MAX_MODEL_EVIDENCE_IMAGES = 4
const DEFAULT_PARALLEL_MAX_ENGINES = 5
const DEFAULT_PARALLEL_MAX_QUERIES = 2
const DEFAULT_PARALLEL_TIMEOUT_MS = 12000

const CHINESE_CHAR_RE = /[\u3400-\u9FFF]/
const ENGLISH_WORD_RE = /[A-Za-z]{3,}/
const BILINGUAL_TOPIC_RE = new RegExp(
  [
    'openai',
    'google',
    'microsoft',
    'github',
    'cloud',
    'release',
    'api',
    'security',
    'cve',
    'llm',
    'ai',
    'model',
    'framework',
    'research',
    'paper',
    'benchmark',
    '跨境',
    '海外',
    '国际',
    '论文',
    '芯片',
    '开源',
    '发布',
    '漏洞',
  ].join('|'),
  'i',
)

const parseRequestedLimit = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const normalized = Math.floor(value)
    return normalized > 0 ? normalized : null
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    const parsed = Number.parseInt(trimmed, 10)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }
  return null
}

const clampAutoReadTopK = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(3, Math.floor(value)))
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.min(3, Math.floor(parsed)))
    }
  }
  return DEFAULT_AUTO_READ_TOP_K
}

const clampPositiveInt = (value: unknown, fallback: number, min: number, max: number): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(min, Math.min(max, Math.floor(value)))
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) {
      return Math.max(min, Math.min(max, Math.floor(parsed)))
    }
  }
  return fallback
}

const isHttpUrl = (value: string): boolean => {
  if (!value) return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/** 读取引擎回退来源 → 证据来源标签。google_cache 已删除，未知值不冒充回退来源。 */
const normalizeReadFallbackUsed = (value: UrlReadResult['fallbackUsed']): AutoReadFallbackUsed => {
  switch (value) {
    case 'crawler':
    case 'browser':
    case 'deepseek_fetch':
    case 'document':
    case 'wayback':
    case 'python':
    case 'provided':
      return value
    default:
      return 'none'
  }
}

/** 把一个搜索命中转成自动阅读候选；同一 URL 的去重与候选上限由批次调度负责。 */
const buildAutoReadCandidate = (hit: WebSearchHit): AutoReadCandidate | null => {
  const url = typeof hit.url === 'string' ? hit.url.trim() : ''
  if (!url || !isHttpUrl(url)) return null
  const content = typeof hit.content === 'string' ? hit.content : ''
  const contentSource = hit.contentSource || hit.engine || hit.sourceEngines?.[0] || 'search'
  return {
    url,
    title: hit.title,
    engine: hit.sourceEngines?.[0] || hit.engine,
    snippet: hit.snippet,
    // 只有 article 会被复用成正文；summary / highlight / snippet 只能当摘要回退文本
    searchContent:
      content.trim() && hit.contentKind
        ? {
            content,
            kind: hit.contentKind,
            source: contentSource,
            // 提供方的长度截断必须透传，不能把 Exa maxCharacters 的正文当完整全文
            truncated: hit.contentMetadata?.truncated,
          }
        : undefined,
  }
}

const classifyWebSearchErrorCode = (message: string): string => {
  const normalized = (message || '').toLowerCase()
  if (normalized.includes('403')) return 'HTTP_403'
  if (normalized.includes('404')) return 'HTTP_404'
  if (normalized.includes('429')) return 'HTTP_429'
  if (normalized.includes('timeout')) return 'TIMEOUT'
  if (normalized.includes('fetch failed')) return 'FETCH_FAILED'
  return 'SEARCH_ERROR'
}

const detectQueryLanguage = (query: string): 'zh' | 'en' | 'unknown' => {
  if (CHINESE_CHAR_RE.test(query)) return 'zh'
  if (ENGLISH_WORD_RE.test(query)) return 'en'
  return 'unknown'
}

const normalizeQueryLanguage = (
  value: WebSearchQueryLanguage | undefined,
  query: string,
): WebSearchQueryLanguage => value ?? detectQueryLanguage(query)

/**
 * 双语扩展只看三态模式：off 不扩展、always 必扩展、conditional 按语种与主题词判断。
 * 查询扩展数（parallelMaxQueriesPerCall）为 1 时上层不会追加第二条查询。
 */
const shouldExpandBilingual = (
  query: string,
  language: 'zh' | 'en' | 'unknown',
  mode: 'off' | 'conditional' | 'always',
): boolean => {
  if (mode === 'off') return false
  if (mode === 'always') return true
  if (language === 'unknown') return true
  return BILINGUAL_TOPIC_RE.test(query)
}

const buildBilingualQueries = (
  query: string,
  config: WebSearchHandlerConfig,
): WebSearchParallelQuery[] => {
  const queryLanguage = detectQueryLanguage(query)
  const bilingualMode = config.autoBilingualMode || 'conditional'
  const maxQueries = clampPositiveInt(
    config.parallelMaxQueriesPerCall,
    DEFAULT_PARALLEL_MAX_QUERIES,
    1,
    3,
  )
  const useBilingual = shouldExpandBilingual(query, queryLanguage, bilingualMode)

  const queries: WebSearchParallelQuery[] = [{ query, queryLanguage }]
  if (useBilingual && maxQueries > 1) {
    let altQuery = ''
    if (queryLanguage === 'zh') {
      altQuery = `${query} English sources`
    } else if (queryLanguage === 'en') {
      altQuery = `${query} 中文 资料`
    } else {
      altQuery = `${query} bilingual sources 中文`
    }
    queries.push({
      query: altQuery,
      queryLanguage: queryLanguage === 'zh' ? 'en' : 'zh',
    })
  }

  const deduped = new Map<string, WebSearchParallelQuery>()
  for (const item of queries) {
    const key = item.query.trim().toLowerCase()
    if (!key || deduped.has(key)) continue
    deduped.set(key, item)
  }
  return Array.from(deduped.values()).slice(0, maxQueries)
}

const pickActiveEngines = (config: WebSearchHandlerConfig, scope?: string): string[] => {
  const normalizedScope = (scope || 'webpage').trim().toLowerCase()
  const webOnly = normalizedScope !== 'webpage' && normalizedScope !== 'web'
  // 启用引擎数组本身就是优先顺序：先按顺序去重，再按 Key 与范围过滤
  const order = Array.from(
    new Set(
      (config.engines || [])
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
        .filter((engine) => !webOnly || engine !== 'deepseek'),
    ),
  )
  const withKeys = order.filter((engine) => Boolean(config.apiKeys?.[engine]))
  const maxEngines = clampPositiveInt(
    config.parallelMaxEngines,
    DEFAULT_PARALLEL_MAX_ENGINES,
    1,
    DEFAULT_PARALLEL_MAX_ENGINES,
  )
  return withKeys.slice(0, maxEngines)
}

const HIGH_RISK_QUERY_RE = new RegExp(
  [
    '最新',
    '今日',
    '实时',
    '刚刚',
    '突发',
    '政策',
    '法规',
    '法律',
    '监管',
    '医疗',
    '药品',
    '诊断',
    '金融',
    '股价',
    '投资',
    '汇率',
    '安全',
    '漏洞',
    'cve',
    'latest',
    'today',
    'breaking',
    'law',
    'legal',
    'policy',
    'regulation',
    'medical',
    'drug',
    'diagnosis',
    'finance',
    'stock',
    'market',
    'exchange rate',
    'security',
    'vulnerability',
  ].join('|'),
  'i',
)

const LANGUAGE_ENGINE_PRIORITY: Record<'zh' | 'en' | 'unknown', string[]> = {
  zh: ['metaso', 'deepseek', 'tavily', 'brave', 'exa'],
  en: ['tavily', 'brave', 'exa', 'deepseek', 'metaso'],
  unknown: ['tavily', 'metaso', 'deepseek', 'brave', 'exa'],
}

const MIN_OVERLAP_RATIO_FOR_STABLE = 0.25

interface SearchRoutingPlan {
  queryPlans: WebSearchParallelQueryPlan[]
  fallbackEngines: string[]
  primaryLanguage: 'zh' | 'en' | 'unknown'
  highRisk: boolean
  requiredSources: number
  conflictEscalation: 'off' | 'auto'
}

type SearchEscalationReason = 'insufficient_sources' | 'low_overlap'

interface SearchEscalationDecision {
  escalate: boolean
  reason: SearchEscalationReason | null
  overlapRatio: number
  successfulEngineCount: number
}

const normalizeEngineOrderForRouting = (
  activeEngines: string[],
  engineOrder: string[],
): string[] => {
  const normalizedOrder = Array.from(
    new Set(
      (engineOrder || [])
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  )
  return [
    ...normalizedOrder.filter((engine) => activeEngines.includes(engine)),
    ...activeEngines.filter((engine) => !normalizedOrder.includes(engine)),
  ]
}

const rankEnginesByLanguage = (
  activeEngines: string[],
  orderedEngines: string[],
  language: 'zh' | 'en' | 'unknown',
  localeRouting?: {
    zh?: string[]
    en?: string[]
    unknown?: string[]
  },
): string[] => {
  const preferredFromConfig = Array.isArray(localeRouting?.[language])
    ? localeRouting?.[language] || []
    : []
  const preferred = preferredFromConfig.length > 0
    ? preferredFromConfig
    : (LANGUAGE_ENGINE_PRIORITY[language] || LANGUAGE_ENGINE_PRIORITY.unknown)
  return [
    ...preferred.filter((engine) => activeEngines.includes(engine)),
    ...orderedEngines.filter((engine) => !preferred.includes(engine)),
  ]
}

const countPlannedTasks = (queryPlans: WebSearchParallelQueryPlan[]): number =>
  queryPlans.reduce((sum, item) => sum + item.engines.length, 0)

const isHighRiskQuery = (query: string): boolean => HIGH_RISK_QUERY_RE.test(query)

const pickRequiredSourceCount = (
  activeEngineCount: number,
  highRisk: boolean,
  minSourcesOverride?: number,
): number => {
  if (typeof minSourcesOverride === 'number' && Number.isFinite(minSourcesOverride)) {
    return Math.max(1, Math.min(activeEngineCount, Math.floor(minSourcesOverride)))
  }
  return Math.max(1, Math.min(activeEngineCount, highRisk ? 3 : 2))
}

const pickPerQuerySourceCount = (
  queryIndex: number,
  rankedEngines: string[],
  requiredSources: number,
  highRisk: boolean,
): number => {
  if (queryIndex === 0) return Math.max(1, Math.min(requiredSources, rankedEngines.length))
  const fallbackTarget = highRisk ? 2 : 1
  return Math.max(1, Math.min(fallbackTarget, rankedEngines.length))
}

export const buildLanguageAwareSearchPlan = ({
  originalQuery,
  expandedQueries,
  activeEngines,
  engineOrder,
  minSources,
  conflictEscalation,
  localeRouting,
}: {
  originalQuery: string
  expandedQueries: WebSearchParallelQuery[]
  activeEngines: string[]
  engineOrder: string[]
  minSources?: number
  conflictEscalation?: 'off' | 'auto'
  localeRouting?: {
    zh?: string[]
    en?: string[]
    unknown?: string[]
  }
}): SearchRoutingPlan => {
  const orderedEngines = normalizeEngineOrderForRouting(activeEngines, engineOrder)
  const queryList: WebSearchParallelQuery[] =
    expandedQueries.length > 0
      ? expandedQueries
      : [{ query: originalQuery, queryLanguage: 'unknown' }]
  const primaryLanguage = normalizeQueryLanguage(queryList[0]?.queryLanguage, originalQuery)
  const highRisk = isHighRiskQuery(originalQuery)
  const requiredSources = pickRequiredSourceCount(activeEngines.length, highRisk, minSources)
  const escalationPolicy = conflictEscalation === 'off' ? 'off' : 'auto'

  const queryPlans: WebSearchParallelQueryPlan[] = queryList.map((queryItem, queryIndex) => {
    const language = normalizeQueryLanguage(queryItem.queryLanguage, queryItem.query)
    const rankedEngines = rankEnginesByLanguage(activeEngines, orderedEngines, language, localeRouting)
    const perQuerySources = pickPerQuerySourceCount(queryIndex, rankedEngines, requiredSources, highRisk)
    return {
      query: queryItem.query,
      queryLanguage: language,
      engines: rankedEngines.slice(0, perQuerySources),
    }
  })

  const usedEngines = new Set(queryPlans.flatMap((item) => item.engines))
  const fallbackEngines = rankEnginesByLanguage(
    activeEngines,
    orderedEngines,
    primaryLanguage,
    localeRouting,
  ).filter(
    (engine) => !usedEngines.has(engine),
  )

  return {
    queryPlans,
    fallbackEngines,
    primaryLanguage,
    highRisk,
    requiredSources,
    conflictEscalation: escalationPolicy,
  }
}

const calculateOverlapRatio = (result: WebSearchParallelResult): number => {
  if (result.hits.length === 0) return 0
  const overlapHits = result.hits.filter(
    (item) => Array.isArray(item.sourceEngines) && item.sourceEngines.length >= 2,
  ).length
  return overlapHits / result.hits.length
}

export const evaluateSearchEscalation = (
  plan: SearchRoutingPlan,
  searchResult: WebSearchParallelResult,
): SearchEscalationDecision => {
  const successfulEngineCount = new Set(
    searchResult.tasks
      .filter((item) => item.status === 'success')
      .map((item) => item.task.engine),
  ).size
  const overlapRatio = calculateOverlapRatio(searchResult)
  if (plan.fallbackEngines.length === 0) {
    return {
      escalate: false,
      reason: null,
      overlapRatio,
      successfulEngineCount,
    }
  }
  if (successfulEngineCount < plan.requiredSources) {
    return {
      escalate: true,
      reason: 'insufficient_sources',
      overlapRatio,
      successfulEngineCount,
    }
  }
  if (
    plan.conflictEscalation !== 'off' &&
    successfulEngineCount >= 2 &&
    overlapRatio < MIN_OVERLAP_RATIO_FOR_STABLE
  ) {
    return {
      escalate: true,
      reason: 'low_overlap',
      overlapRatio,
      successfulEngineCount,
    }
  }
  return {
    escalate: false,
    reason: null,
    overlapRatio,
    successfulEngineCount,
  }
}

const buildEscalationQueryPlans = (
  plan: SearchRoutingPlan,
  escalationEngine: string,
): WebSearchParallelQueryPlan[] => {
  if (!escalationEngine) return []
  if (plan.queryPlans.length === 0) return []
  const targetPlans = plan.highRisk ? plan.queryPlans : plan.queryPlans.slice(0, 1)
  return targetPlans.map((item) => ({
    query: item.query,
    queryLanguage: item.queryLanguage,
    engines: [escalationEngine],
  }))
}

const collectReadImageUrls = (
  result: {
    leadImageUrl?: string
    images?: Array<{ url: string }>
  },
  extraUrls: Array<string | undefined> = [],
): string[] =>
  Array.from(
    new Set(
      [
        ...(result.leadImageUrl ? [result.leadImageUrl] : []),
        ...(result.images || []).map((image) => image.url),
        ...extraUrls
          .filter((url): url is string => typeof url === 'string')
          .map((url) => url.trim()),
      ].filter((url) => url.length > 0),
    ),
  )

const buildSummaryForModel = (
  query: string,
  hits: WebSearchHit[],
  autoReadEvidence: AutoReadItem[],
): string => {
  const base = formatHitsForModel(query, hits)
  if (autoReadEvidence.length === 0) {
    return `${base}\n\n注：本轮未读取网页正文，仅基于搜索摘要。`
  }

  const bodyItems = autoReadEvidence.filter(
    (item) => item.evidenceKind === 'article' || item.evidenceKind === 'structured',
  )
  const summaryItems = autoReadEvidence.filter((item) => item.evidenceKind === 'summary')
  const failedItems = autoReadEvidence.filter((item) => item.evidenceKind === 'none')
  const lines: string[] = []

  lines.push('自动网页读取证据（按搜索结果顺序）：')
  for (const item of autoReadEvidence) {
    if (item.evidenceKind === 'none') {
      const status = `${item.errorCode || 'UNKNOWN'}${typeof item.httpStatus === 'number' ? ` (HTTP ${item.httpStatus})` : ''}`
      lines.push(`${item.rank}. 读取失败：${item.url} | ${status}，无可用回退正文`)
      continue
    }
    if (item.evidenceKind === 'summary') {
      const sourceSuffix = item.contentSource ? ` | 来源: ${item.contentSource}` : ''
      const failSuffix = item.errorCode ? ` | 原文读取失败: ${item.errorCode}` : ''
      lines.push(`${item.rank}. 仅取得摘要（不计为正文）：${item.url}${sourceSuffix}${failSuffix}`)
      if (item.content) {
        lines.push(`   摘要：${truncateText(item.content, 600)}`)
      }
      if (item.images?.length) {
        lines.push(`   图片证据: ${item.images.slice(0, MAX_MODEL_EVIDENCE_IMAGES).map((img) => img.url).join(' | ')}`)
      }
      continue
    }
    const title = item.title || item.url
    const kindSuffix = item.evidenceKind === 'structured' ? '（结构化内容）' : ''
    const extractionSuffix = item.fallbackUsed === 'crawler' ? '（爬虫回退）' : ''
    const reuseSuffix =
      item.fallbackUsed === 'search_content'
        ? `（搜索正文复用${item.contentSource ? ` · ${item.contentSource}` : ''}）`
        : ''
    const truncationSuffix = item.truncated
      ? item.fallbackUsed === 'search_content'
        ? '（提供方正文本已截断，非完整正文）'
        : '（正文已截断，非完整正文）'
      : ''
    lines.push(`${item.rank}. ${title}${kindSuffix}${extractionSuffix}${reuseSuffix}${truncationSuffix}`)
    lines.push(`   URL: ${item.url}`)
    if (item.excerpt) {
      lines.push(`   摘要: ${truncateText(item.excerpt, 360)}`)
    }
    if (item.content) {
      lines.push(`   正文摘录: ${truncateText(item.content, DEFAULT_MODEL_EVIDENCE_CHARS)}`)
    }
    if (item.images?.length) {
      lines.push(`   图片证据: ${item.images.slice(0, MAX_MODEL_EVIDENCE_IMAGES).map((img) => img.url).join(' | ')}`)
    }
  }

  return `${base}\n\n${lines.join('\n')}\n\n统计：有效正文 ${bodyItems.length} 条，仅摘要 ${summaryItems.length} 条，失败 ${failedItems.length} 条。`
}

const slimHitsForModel = (hits: Array<{ title: string; url: string; snippet?: string; content?: string; imageUrl?: string; thumbnailUrl?: string; engine?: string; rank?: number; sourceEngines?: string[] }>) =>
  hits.slice(0, DEFAULT_MODEL_RESULT_HITS).map((hit) => ({
    title: hit.title,
    url: hit.url,
    snippet: truncateText(hit.snippet || hit.content || '', DEFAULT_MODEL_SNIPPET_CHARS),
    imageUrl: hit.imageUrl,
    thumbnailUrl: hit.thumbnailUrl,
    engine: hit.engine,
    rank: hit.rank,
    sourceEngines: Array.isArray(hit.sourceEngines) ? hit.sourceEngines.slice(0, 3) : undefined,
  }))

const slimTaskResultsForModel = (tasks: Array<{ task: { engine: string; query: string; queryLanguage: string }; status: 'success' | 'error'; hits: unknown[]; error?: string }>) =>
  tasks.slice(0, DEFAULT_MODEL_TASK_RESULTS).map((item) => ({
    engine: item.task.engine,
    query: item.task.query,
    queryLanguage: item.task.queryLanguage,
    status: item.status,
    hitsCount: Array.isArray(item.hits) ? item.hits.length : 0,
    error: item.error,
  }))

const slimEvidenceForModel = (items: AutoReadItem[]) =>
  items.slice(0, DEFAULT_MODEL_EVIDENCE_ITEMS).map((item) => ({
    url: item.url,
    title: item.title,
    evidenceKind: item.evidenceKind,
    contentSource: item.contentSource,
    excerpt: item.excerpt ? truncateText(item.excerpt, DEFAULT_MODEL_SNIPPET_CHARS) : undefined,
    content: item.content ? truncateText(item.content, DEFAULT_MODEL_EVIDENCE_ITEM_CHARS) : undefined,
    images: Array.isArray(item.images) ? item.images.slice(0, MAX_MODEL_EVIDENCE_IMAGES) : undefined,
    siteName: item.siteName,
    byline: item.byline,
    wordCount: item.wordCount,
    truncated: item.truncated,
    fetchedAt: item.fetchedAt,
    archivedAt: item.archivedAt,
    error: item.error,
    errorCode: item.errorCode,
    httpStatus: item.httpStatus,
    fallbackUsed: item.fallbackUsed,
    skippedReason: item.skippedReason,
    rank: item.rank,
  }))

export class WebSearchToolHandler implements IToolHandler {
  readonly toolName = 'web_search'
  private config: WebSearchHandlerConfig

  constructor(config: WebSearchHandlerConfig) {
    this.config = config
  }

  get toolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: 'web_search',
        description:
          'Use this tool to search the live web for up-to-date information before responding. It uses locale-aware engine routing, bilingual query expansion when needed, and conflict-aware source escalation for better reliability.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query describing the missing information',
            },
            scope: {
              type: 'string',
              enum: [...WEB_SEARCH_SCOPE_IDS],
              description: 'Optional search scope/type. Use "image" only when the research needs news/evidence images; the backend will run image-capable engines and return their raw image urls.',
            },
          },
          required: ['query'],
        },
      },
    }
  }

  canHandle(toolName: string): boolean {
    return toolName === this.toolName
  }

  async handle(
    toolCall: ToolCall,
    args: Record<string, unknown>,
    context: ToolCallContext,
  ): Promise<ToolHandlerResult> {
    const query = ((args.query as string) || '').trim()
    const callId = toolCall.id || randomUUID()

    if (!query) {
      context.sendToolEvent({
        id: callId,
        tool: 'web_search',
        stage: 'error',
        query: '',
        error: 'Model requested web_search without a query',
      })
      return {
        toolCallId: callId,
        toolName: this.toolName,
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          name: 'web_search',
          content: JSON.stringify({ error: 'Missing query parameter' }),
        },
      }
    }

    const modelRequestedLimit = parseRequestedLimit(args.num_results)
    const appliedLimit = this.config.resultLimit
    const requestedScope = typeof args.scope === 'string' ? args.scope.trim().toLowerCase() : ''
    const effectiveScope = isWebSearchScope(requestedScope) ? requestedScope : this.config.scope
    const autoReadEnabledForSearch =
      effectiveScope !== 'image' && this.config.autoReadAfterSearch !== false
    const autoReadTopK = effectiveScope === 'image' ? 0 : clampAutoReadTopK(this.config.autoReadTopK)
    // 自动阅读需要正文时，向支持正文的引擎请求既有正文能力；不新增服务、不改条数与长度上限
    const autoReadNeedContent = autoReadEnabledForSearch && autoReadTopK > 0
    const expandedQueries = buildBilingualQueries(query, this.config)
    const activeEngines = pickActiveEngines(this.config, effectiveScope)
    const routingPlan = buildLanguageAwareSearchPlan({
      originalQuery: query,
      expandedQueries,
      activeEngines,
      engineOrder: this.config.engines || [],
      minSources: this.config.minSources,
      conflictEscalation: this.config.conflictEscalation,
      localeRouting: this.config.localeRouting,
    })

    context.sendToolEvent({
      id: callId,
      tool: 'web_search',
      stage: 'start',
      query,
      details: {
        requestedLimit: modelRequestedLimit,
        appliedLimit,
        groupId: callId,
        engineCount: activeEngines.length,
        queryCount: expandedQueries.length,
        requiredSources: routingPlan.requiredSources,
        highRisk: routingPlan.highRisk,
        scope: effectiveScope,
      },
    })

    if (activeEngines.length === 0) {
      const message = 'No search engines with valid API keys are configured'
      return {
        toolCallId: callId,
        toolName: this.toolName,
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          name: 'web_search',
          content: JSON.stringify({ query, error: message, errorCode: 'NO_ACTIVE_ENGINE' }),
        },
      }
    }

    const plannedSearchTaskCount = countPlannedTasks(routingPlan.queryPlans)
    const emitSearchTaskStartEvents = (
      queryPlans: WebSearchParallelQueryPlan[],
      phase: 'initial' | 'escalation',
    ) => {
      let taskIndex = 0
      for (let queryIndex = 0; queryIndex < queryPlans.length; queryIndex += 1) {
        const queryItem = queryPlans[queryIndex]
        for (let engineIndex = 0; engineIndex < queryItem.engines.length; engineIndex += 1) {
          const engine = queryItem.engines[engineIndex]
          context.sendToolEvent({
            id: `${callId}:search:${phase}:${taskIndex + 1}`,
            tool: 'web_search',
            stage: 'start',
            query: queryItem.query,
            summary:
              phase === 'initial'
                ? `并行搜索中：${engine} / ${queryItem.queryLanguage || 'unknown'}`
                : `冲突升级复核：${engine} / ${queryItem.queryLanguage || 'unknown'}`,
            details: {
              groupId: callId,
              parentTool: 'web_search',
              parentCallId: callId,
              taskType: 'search',
              phase,
              engine,
              queryLanguage: queryItem.queryLanguage || 'unknown',
              originalQuery: query,
              expandedQuery: queryItem.query,
              queryIndex,
            },
          })
          taskIndex += 1
        }
      }
    }

    const emitSearchTaskResultEvents = (
      taskResults: WebSearchTaskResult[],
      phase: 'initial' | 'escalation',
    ) => {
      for (const taskResult of taskResults) {
        const taskId = `${callId}:search:${phase}:${taskResult.task.taskIndex + 1}`
        if (taskResult.status === 'error') {
          context.sendToolEvent({
            id: taskId,
            tool: 'web_search',
            stage: 'error',
            query: taskResult.task.query,
            error: taskResult.error || 'Search task failed',
            summary: `并行搜索失败：${taskResult.task.engine} / ${taskResult.task.queryLanguage}`,
            details: {
              groupId: callId,
              parentTool: 'web_search',
              parentCallId: callId,
              taskType: 'search',
              phase,
              engine: taskResult.task.engine,
              queryLanguage: taskResult.task.queryLanguage,
              originalQuery: query,
              expandedQuery: taskResult.task.query,
              queryIndex: taskResult.task.queryIndex,
            },
          })
          continue
        }
        context.sendToolEvent({
          id: taskId,
          tool: 'web_search',
          stage: 'result',
          query: taskResult.task.query,
          hits: taskResult.hits,
          summary: `并行搜索完成：${taskResult.task.engine} 命中 ${taskResult.hits.length} 条`,
          details: {
            groupId: callId,
            parentTool: 'web_search',
            parentCallId: callId,
            taskType: 'search',
            phase,
            engine: taskResult.task.engine,
            queryLanguage: taskResult.task.queryLanguage,
            originalQuery: query,
            expandedQuery: taskResult.task.query,
            queryIndex: taskResult.task.queryIndex,
            hitsCount: taskResult.hits.length,
          },
        })
      }
    }

    emitSearchTaskStartEvents(routingPlan.queryPlans, 'initial')

    try {
      const parallelTimeoutMs = clampPositiveInt(
        this.config.parallelTimeoutMs,
        DEFAULT_PARALLEL_TIMEOUT_MS,
        1000,
        120000,
      )
      let searchResult = await runWebSearchParallel({
        engines: activeEngines,
        engineOrder: this.config.engines,
        apiKeys: this.config.apiKeys || {},
        queries: expandedQueries,
        queryPlans: routingPlan.queryPlans,
        originalQuery: query,
        limit: appliedLimit,
        domains: this.config.domains,
        endpoint: this.config.endpoint,
        scope: effectiveScope,
        includeSummary: this.config.includeSummary,
        includeRawContent: this.config.includeRawContent,
        autoReadNeedContent,
        // DeepSeek 的正文需求与其它引擎同条件：topK=0 时不再索取正文
        deepseekNeedContent: autoReadNeedContent,
        timeoutMs: parallelTimeoutMs,
        parallelMaxEngines: this.config.parallelMaxEngines,
        signal: context.requestSignal,
      })
      emitSearchTaskResultEvents(searchResult.tasks, 'initial')

      let executedSearchTaskCount = plannedSearchTaskCount
      let escalationInfo: {
        triggered: boolean
        reason: SearchEscalationReason | null
        engine?: string
        overlapRatio: number
        successfulEngineCount: number
      } = {
        triggered: false,
        reason: null,
        overlapRatio: 0,
        successfulEngineCount: 0,
      }

      const escalationDecision = evaluateSearchEscalation(routingPlan, searchResult)
      escalationInfo = {
        ...escalationInfo,
        overlapRatio: escalationDecision.overlapRatio,
        successfulEngineCount: escalationDecision.successfulEngineCount,
      }
      if (escalationDecision.escalate) {
        const escalationEngine = routingPlan.fallbackEngines[0]
        const escalationPlans = buildEscalationQueryPlans(routingPlan, escalationEngine)
        if (escalationEngine && escalationPlans.length > 0) {
          emitSearchTaskStartEvents(escalationPlans, 'escalation')
          const escalationResult = await runWebSearchParallel({
            engines: activeEngines,
            engineOrder: this.config.engines,
            apiKeys: this.config.apiKeys || {},
            queries: escalationPlans.map((item) => ({
              query: item.query,
              queryLanguage: item.queryLanguage,
            })),
            queryPlans: escalationPlans,
            originalQuery: query,
            limit: appliedLimit,
            domains: this.config.domains,
            endpoint: this.config.endpoint,
            scope: effectiveScope,
            includeSummary: this.config.includeSummary,
            includeRawContent: this.config.includeRawContent,
            autoReadNeedContent,
            deepseekNeedContent: autoReadNeedContent,
            timeoutMs: parallelTimeoutMs,
            parallelMaxEngines: this.config.parallelMaxEngines,
            signal: context.requestSignal,
          })
          emitSearchTaskResultEvents(escalationResult.tasks, 'escalation')
          searchResult = mergeWebSearchParallelResults(
            [searchResult, escalationResult],
            appliedLimit,
            this.config.engines,
          )
          executedSearchTaskCount += countPlannedTasks(escalationPlans)
          escalationInfo = {
            ...escalationInfo,
            triggered: true,
            reason: escalationDecision.reason,
            engine: escalationEngine,
          }
        }
      }

      const hits = searchResult.hits
      const autoReadEnabled = autoReadEnabledForSearch
      const autoReadParallelism = clampPositiveInt(
        this.config.autoReadParallelism,
        DEFAULT_AUTO_READ_PARALLELISM,
        1,
        4,
      )
      const autoReadTimeoutMs = clampPositiveInt(
        this.config.autoReadTimeoutMs,
        DEFAULT_AUTO_READ_TIMEOUT_MS,
        3000,
        120000,
      )
      const autoReadMaxContentLength = clampPositiveInt(
        this.config.autoReadMaxContentLength,
        DEFAULT_AUTO_READ_MAX_CONTENT_LENGTH,
        2000,
        300000,
      )

      // 批次总时限与单 URL 超时分别存储：autoReadTimeoutMs 依旧只表示"一个 URL 能等多久"
      const autoReadBatchTimeoutMs = clampPositiveInt(
        this.config.autoReadBatchTimeoutMs,
        DEFAULT_AUTO_READ_BATCH_TIMEOUT_MS,
        WEB_SEARCH_AUTO_READ_BATCH_TIMEOUT_MS.min,
        WEB_SEARCH_AUTO_READ_BATCH_TIMEOUT_MS.max,
      )
      const readerConfig = this.config.urlReader
      const deepseekApiKey = readerConfig?.deepseekApiKey || this.config.apiKeys?.deepseek
      const deepseekFetchEnabled =
        Boolean(this.config.deepseekFetchEnabled ?? readerConfig?.enableDeepseekFallback) &&
        Boolean(deepseekApiKey)
      // autoReadTopK = 0 表示关闭自动阅读；批次调度要求至少 1 条目标，不能在这里被抬回 1
      const autoReadActive = autoReadEnabled && autoReadTopK > 0
      const autoReadCandidates = autoReadActive
        ? hits
            .map((hit) => buildAutoReadCandidate(hit))
            .filter((item): item is AutoReadCandidate => Boolean(item))
        : []
      const hitByUrl = new Map(hits.map((hit) => [normalizeSearchUrl(hit.url) || hit.url, hit]))
      const readCallIdOf = (rank: number) => `${callId}:read:${rank}`
      const readBaseDetails = (url: string, rank: number): ToolLogDetails => ({
        groupId: callId,
        url,
        rank,
        autoTriggered: true,
        parentTool: 'web_search',
        parentCallId: callId,
        taskType: 'read_url',
      })

      const emitAutoReadStart = (event: AutoReadEvent) => {
        if (event.stage !== 'start') return
        context.sendToolEvent({
          id: readCallIdOf(event.rank),
          tool: 'read_url',
          stage: 'start',
          query: event.url,
          summary: '基于搜索结果自动读取网页正文',
          url: event.url,
          details: { ...readBaseDetails(event.url, event.rank), urlTimeoutMs: event.timeoutMs },
        })
      }

      const autoReadBatch = await runSearchAutoReadBatch({
        candidates: autoReadCandidates,
        perUrlTimeoutMs: autoReadTimeoutMs,
        batchTimeoutMs: autoReadBatchTimeoutMs,
        evidenceTarget: autoReadTopK,
        parallelism: autoReadParallelism,
        maxContentChars: autoReadMaxContentLength,
        signal: context.requestSignal,
        onEvent: emitAutoReadStart,
        read: async ({ url, timeoutMs, signal }) => {
          const readOptions: UrlReaderOptions = {
            // 完整转发 url reader 配置：浏览器可用性、渲染等待、body 上限与 DeepSeek 开关
            enableBrowser: readerConfig?.enableBrowser,
            browserExecutablePath: readerConfig?.browserExecutablePath,
            renderWaitMs: readerConfig?.renderWaitMs,
            maxBodyBytes: readerConfig?.maxBodyBytes,
            enableDeepseekFallback: deepseekFetchEnabled,
            deepseekApiKey,
            timeout: timeoutMs,
            maxContentLength: autoReadMaxContentLength,
            // 搜索问题默认要当前内容；只有明确的回溯查询才需要 purpose: 'history'
            purpose: 'current',
            freshness: 'current',
            signal,
          }
          const readResult = await readUrlContent(url, readOptions)
          // core 旧类型仍可能带已删除的 google_cache；统一收敛成证据来源标签，不冒充回退来源
          return { ...readResult, fallbackUsed: normalizeReadFallbackUsed(readResult.fallbackUsed) }
        },
      })

      const autoReadEvidence: AutoReadItem[] = []
      for (const item of autoReadBatch.items) {
        // 目标已达成 / 候选预算用完是正常收敛，不进证据列表，也不制造错误噪音
        if (item.skippedReason === 'evidence_target_met' || item.skippedReason === 'candidate_budget') {
          continue
        }
        const hit = hitByUrl.get(normalizeSearchUrl(item.url) || item.url)
        // 页面本体抽不到图（JS 重页面/文档页）时保留命中项自带封面图，避免证据图整段为空
        const images = collectReadImageUrls(
          { leadImageUrl: item.leadImageUrl, images: item.images },
          [hit?.imageUrl],
        ).map((url) => ({ url }))
        const enriched: AutoReadItem = images.length > 0 ? { ...item, images } : item
        autoReadEvidence.push(enriched)

        const details: ToolLogDetails = {
          ...readBaseDetails(enriched.url, enriched.rank),
          evidenceKind: enriched.evidenceKind,
          contentSource: enriched.contentSource,
          fallbackUsed: enriched.fallbackUsed,
          skippedReason: enriched.skippedReason,
          errorCode: enriched.errorCode,
          httpStatus: enriched.httpStatus,
          attempts: enriched.attempts,
          finalUrl: enriched.finalUrl,
          rendered: enriched.rendered,
          contentFormat: enriched.contentFormat,
        }
        const readCallId = readCallIdOf(enriched.rank)
        if (enriched.evidenceKind === 'summary' || enriched.evidenceKind === 'none') {
          context.sendToolEvent({
            id: readCallId,
            tool: 'read_url',
            stage: 'error',
            query: enriched.url,
            summary:
              enriched.evidenceKind === 'summary'
                ? '网页读取失败，已回退到搜索摘要（不计为正文）'
                : enriched.skippedReason === 'batch_deadline'
                  ? '批次总时限已用完，未读取该网页'
                  : enriched.skippedReason === 'cancelled'
                    ? '网页读取已取消'
                    : '网页读取失败且无可用摘要回退',
            url: enriched.url,
            error: enriched.error,
            details,
          })
          continue
        }
        context.sendToolEvent({
          id: readCallId,
          tool: 'read_url',
          stage: 'result',
          query: enriched.url,
          summary:
            enriched.fallbackUsed === 'search_content'
              ? '已复用搜索结果正文（未重复抓取）'
              : enriched.title
                ? `已读取：${enriched.title}${enriched.fallbackUsed === 'crawler' ? '（爬虫回退）' : ''}`
                : '网页读取完成',
          url: enriched.url,
          title: enriched.title,
          excerpt: enriched.excerpt,
          wordCount: enriched.wordCount,
          siteName: enriched.siteName,
          byline: enriched.byline,
          leadImageUrl: enriched.leadImageUrl,
          details: {
            ...details,
            title: enriched.title,
            excerpt: enriched.excerpt,
            wordCount: enriched.wordCount,
            siteName: enriched.siteName,
            byline: enriched.byline,
            leadImageUrl: enriched.leadImageUrl,
            images: enriched.images,
          },
        })
      }

      // 有效正文只算 article / structured；摘要单独计数，不冒充正文
      const autoReadBodyCount = autoReadBatch.articleCount + autoReadBatch.structuredCount
      const taskSucceeded = searchResult.tasks.filter((item) => item.status === 'success').length
      const taskFailed = searchResult.tasks.length - taskSucceeded

      const summary = buildSummaryForModel(query, hits, autoReadEvidence)

      context.sendToolEvent({
        id: callId,
        tool: 'web_search',
        stage: 'result',
        query,
        hits,
        summary:
          autoReadBatch.candidateCount > 0
            ? `搜索完成，取得正文 ${autoReadBodyCount} 条（候选 ${autoReadBatch.candidatesExamined}/${autoReadBatch.candidateCount}，仅摘要 ${autoReadBatch.summaryCount}）`
            : `搜索完成，共 ${hits.length} 条结果`,
        details: {
          requestedLimit: modelRequestedLimit,
          appliedLimit,
          groupId: callId,
          engineCount: activeEngines.length,
          queryCount: expandedQueries.length,
          searchTaskTotal: searchResult.tasks.length,
          searchTaskSucceeded: taskSucceeded,
          searchTaskFailed: taskFailed,
          autoReadEnabled,
          autoReadRequested: autoReadBatch.candidateCount,
          autoReadSucceeded: autoReadBodyCount,
          autoReadFailed: autoReadBatch.failedCount,
          autoReadSummaryOnly: autoReadBatch.summaryCount,
          autoReadCandidatesExamined: autoReadBatch.candidatesExamined,
          autoReadDuplicateUrls: autoReadBatch.duplicateUrls.length,
          autoReadBatchTimeoutMs: autoReadBatch.batchTimeoutMs,
          autoReadBatchDeadlineExceeded: autoReadBatch.deadlineExceeded,
          autoReadElapsedMs: autoReadBatch.batchElapsedMs,
          scope: effectiveScope,
          requiredSources: routingPlan.requiredSources,
          highRisk: routingPlan.highRisk,
          escalationTriggered: escalationInfo.triggered,
          escalationReason: escalationInfo.reason,
          escalationEngine: escalationInfo.engine,
          overlapRatio: escalationInfo.overlapRatio,
        },
      })

      return {
        toolCallId: callId,
        toolName: this.toolName,
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          name: 'web_search',
          content: JSON.stringify({
            query,
            expandedQueries,
            engines: activeEngines,
            scope: effectiveScope,
            hits: slimHitsForModel(hits),
            taskResults: slimTaskResultsForModel(searchResult.tasks),
            summary: truncateText(summary, DEFAULT_MODEL_SUMMARY_CHARS),
            autoReadEvidence: slimEvidenceForModel(autoReadEvidence),
            taskStats: {
              total: executedSearchTaskCount,
              succeeded: taskSucceeded,
              failed: taskFailed,
            },
            routing: {
              requiredSources: routingPlan.requiredSources,
              highRisk: routingPlan.highRisk,
              primaryLanguage: routingPlan.primaryLanguage,
              queryPlans: routingPlan.queryPlans.map((item) => ({
                query: item.query,
                queryLanguage: item.queryLanguage,
                engines: item.engines,
              })),
            },
            escalation: escalationInfo,
            autoReadStats: {
              enabled: autoReadEnabled,
              requested: autoReadBatch.candidateCount,
              succeeded: autoReadBodyCount,
              failed: autoReadBatch.failedCount,
              article: autoReadBatch.articleCount,
              structured: autoReadBatch.structuredCount,
              summary: autoReadBatch.summaryCount,
              evidenceTarget: autoReadTopK,
              candidatesExamined: autoReadBatch.candidatesExamined,
              duplicateUrls: autoReadBatch.duplicateUrls.length,
              batchTimeoutMs: autoReadBatch.batchTimeoutMs,
              deadlineExceeded: autoReadBatch.deadlineExceeded,
              elapsedMs: autoReadBatch.batchElapsedMs,
            },
          }),
        },
      }
    } catch (searchError: unknown) {
      const message = searchError instanceof Error ? searchError.message : 'Web search failed'
      const errorCode = classifyWebSearchErrorCode(message)
      context.sendToolEvent({
        id: callId,
        tool: 'web_search',
        stage: 'error',
        query,
        error: message,
        details: {
          errorCode,
          fallbackUsed: 'none',
          groupId: callId,
        },
      })
      return {
        toolCallId: callId,
        toolName: this.toolName,
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          name: 'web_search',
          content: JSON.stringify({ query, error: message, errorCode }),
        },
      }
    }
  }
}
