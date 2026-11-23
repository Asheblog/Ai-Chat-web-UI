/**
 * Web 搜索工具处理器
 */

import { randomUUID } from 'node:crypto'
import {
  runWebSearchParallel,
  mergeWebSearchParallelResults,
  normalizeSearchUrl,
  type WebSearchHit,
  type WebSearchQueryLanguage,
  type WebSearchParallelQuery,
  type WebSearchParallelQueryPlan,
  type WebSearchParallelResult,
  type WebSearchTaskResult,
} from '../../../utils/web-search'
import { truncateText } from '../../../utils/parsers'
import { supportsToolImages } from '../../../utils/tool-image-evidence'
import { downloadSearchImageEvidence } from './web-search-image-evidence'
import {
  DEFAULT_MODEL_SUMMARY_CHARS,
  buildSummaryForModel,
  slimEvidenceForModel,
  slimHitsForModel,
  slimTaskResultsForModel,
} from './web-search-model-output'
import { buildEngineBackoffKey, getEngineBackoff } from './web-search-backoff'
import {
  buildSearchEvidenceTaskKey,
  recordReadEvidence,
  recordSearchEvidence,
} from './web-search-evidence-store'
import { parseWebSearchRequestArgs } from './web-search-request'
import {
  buildEvidenceSummary,
  buildRetrievalOutcome,
  buildTerminalOutcome,
  mapReadFailureReason,
  type EvidenceSummaryFailure,
  type RetrievalAutoReadReport,
  type RetrievalEvidenceCounts,
  type RetrievalOutcome,
  type RetrievalRestriction,
  type RetrievalTimeRangeReport,
  type SkippedEngineReport,
} from './web-search-outcome'
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
            domains: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional source restriction for news or specified outlets, e.g. ["reuters.com", "bloomberg.com"]. It narrows the configured whitelist and never widens it.',
            },
            time_range: {
              type: 'object',
              properties: {
                start: { type: 'string', description: 'Earliest publication date, YYYY-MM-DD.' },
                end: { type: 'string', description: 'Latest publication date, YYYY-MM-DD.' },
              },
              description: 'Optional publication window for news or time-sensitive questions. Inverted or unparseable ranges are rejected instead of being silently reversed.',
            },
            include_images: {
              type: 'boolean',
              description: 'Set true only when binary page images are needed as evidence. Image urls are always listed; leaving this false avoids image downloads.',
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
    const requestParse = parseWebSearchRequestArgs({
      args,
      configDomains: this.config.domains,
    })
    const requestAborted = () => Boolean(context.requestSignal?.aborted)
    const buildTerminalEvidence = (
      outcome: RetrievalOutcome,
      restriction: RetrievalRestriction = { restricted: false, requested: [], effective: [] },
    ) =>
      buildEvidenceSummary({
        source: 'search',
        queries: [],
        hits: 0,
        evidence: outcome.evidence,
        engines: [],
        failures: [],
        truncated: 0,
        restriction,
        timeRange: null,
      })

    if (!requestParse.ok) {
      const outcome = buildTerminalOutcome({ status: 'failed', reason: 'invalid_request' })
      context.sendToolEvent({
        id: callId,
        tool: 'web_search',
        stage: 'error',
        query,
        error: requestParse.message,
        details: { errorCode: requestParse.errorCode, groupId: callId, retrievalOutcome: outcome },
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
            error: requestParse.message,
            errorCode: requestParse.errorCode,
            retrievalOutcome: outcome,
            evidenceSummary: buildTerminalEvidence(outcome),
          }),
        },
      }
    }

    const requestPlan = requestParse.plan

    /**
     * 取消终态只有一条路：构造结论、发布父 result 事件、返回不含 error 的结果。
     * 任何取消支路都走这里，避免个别分支只返回内容却不发事件。
     */
    const publishCancelledResult = (skippedEngines?: SkippedEngineReport[]): ToolHandlerResult => {
      const outcome = buildTerminalOutcome({
        status: 'cancelled',
        reason: 'request_cancelled',
        restriction: requestPlan.restriction,
        cancelled: true,
        ...(skippedEngines ? { skippedEngines } : {}),
      })
      const evidenceSummary = buildTerminalEvidence(outcome, requestPlan.restriction)
      context.sendToolEvent({
        id: callId,
        tool: 'web_search',
        stage: 'result',
        query,
        hits: [],
        summary: '检索已取消',
        details: { groupId: callId, cancelled: true, retrievalOutcome: outcome, evidenceSummary },
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
            hits: [],
            summary: `本次检索已取消（${query}）。`,
            retrievalOutcome: outcome,
            evidenceSummary,
          }),
        },
      }
    }

    if (requestPlan.conflict) {
      // 指定来源全部落在部署白名单之外：不放宽白名单，也不换别家媒体替代
      const outcome = buildTerminalOutcome({
        status: 'empty',
        reason: 'domains_outside_whitelist',
        restriction: requestPlan.restriction,
      })
      context.sendToolEvent({
        id: callId,
        tool: 'web_search',
        stage: 'result',
        query,
        hits: [],
        summary: '指定来源不在可用来源范围内',
        details: { groupId: callId, retrievalOutcome: outcome },
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
            hits: [],
            summary: `限定来源检索：${query}。请求来源不在部署允许的来源范围内。`,
            retrievalOutcome: outcome,
            evidenceSummary: buildTerminalEvidence(outcome, requestPlan.restriction),
          }),
        },
      }
    }
    // 取消优先于一切：不再探测退避、不再升级、不再读取网页
    if (requestAborted()) return publishCancelledResult()

    const activeEngines = pickActiveEngines(this.config, effectiveScope)
    const backoff = getEngineBackoff()
    const backoffKeyOf = (engine: string) =>
      buildEngineBackoffKey({
        engine,
        apiKey: this.config.apiKeys?.[engine],
        endpoint: this.config.endpoint,
        connectionId: context.connectionId,
      })
    const recordEngineOutcomes = (results: WebSearchTaskResult[]) => {
      // 取消是调用方行为：不记账，避免把取消当成上游故障
      if (requestAborted()) return
      for (const result of results) {
        const key = backoffKeyOf(result.task.engine)
        if (result.status === 'success') {
          backoff.recordSuccess(key)
          probesHeld.delete(key)
          continue
        }
        backoff.recordFailure(key, result.failureKind || 'upstream_error', {
          retryAfterMs: result.retryAfterMs,
        })
        probesHeld.delete(key)
      }
    }
    const releaseRemainingProbes = () => {
      for (const key of probesHeld) backoff.releaseProbe(key)
      probesHeld.clear()
    }
    const skippedEngines: SkippedEngineReport[] = []
    const probesHeld = new Set<string>()
    const availableEngines: string[] = []
    for (const engine of activeEngines) {
      const key = backoffKeyOf(engine)
      const inspection = backoff.inspect(key)
      if (inspection.blocked) {
        skippedEngines.push({ engine, retryAfterMs: inspection.retryAfterMs })
        continue
      }
      if (inspection.probe) {
        if (!backoff.acquireProbe(key)) {
          skippedEngines.push({ engine, retryAfterMs: inspection.retryAfterMs })
          continue
        }
        probesHeld.add(key)
      }
      availableEngines.push(engine)
    }
    // 全部冷却时允许一次探测（单飞）：不整轮硬失败，也不允许并发绕过退避
    let exhaustionState: 'all_cooling_down' | null = null
    if (availableEngines.length === 0 && activeEngines.length > 0) {
      if (requestAborted()) return publishCancelledResult(skippedEngines)
      const probeCandidate = activeEngines[0]
      const probeKey = backoffKeyOf(probeCandidate)
      if (!backoff.acquireProbe(probeKey, { allowCooling: true })) {
        const outcome = buildTerminalOutcome({
          status: 'failed',
          reason: 'all_sources_cooling_down',
          restriction: requestPlan.restriction,
          skippedEngines,
          exhaustedOverride: 'all_cooling_down',
        })
        context.sendToolEvent({
          id: callId,
          tool: 'web_search',
          stage: 'error',
          query,
          error: 'All search engines are cooling down after repeated failures',
          details: { groupId: callId, retrievalOutcome: outcome },
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
              error: 'All search engines are cooling down after repeated failures',
              errorCode: 'ALL_COOLING_DOWN',
              hits: [],
              retrievalOutcome: outcome,
              evidenceSummary: buildTerminalEvidence(outcome, requestPlan.restriction),
            }),
          },
        }
      }
      probesHeld.add(probeKey)
      exhaustionState = 'all_cooling_down'
      availableEngines.push(probeCandidate)
      const skippedIndex = skippedEngines.findIndex((item) => item.engine === probeCandidate)
      if (skippedIndex >= 0) skippedEngines.splice(skippedIndex, 1)
    }

    const routingPlan = buildLanguageAwareSearchPlan({
      originalQuery: query,
      expandedQueries,
      activeEngines: availableEngines,
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
        engineCount: availableEngines.length,
        skippedBackoff: skippedEngines.length,
        queryCount: expandedQueries.length,
        requiredSources: routingPlan.requiredSources,
        highRisk: routingPlan.highRisk,
        scope: effectiveScope,
        restricted: requestPlan.restriction.restricted,
        restrictedTo: requestPlan.restriction.effective,
        timeRange: requestPlan.timeRange || null,
        includeImages: requestPlan.includeImages,
      },
    })

    if (activeEngines.length === 0) {
      const message = 'No search engines with valid API keys are configured'
      const outcome = buildTerminalOutcome({
        status: 'failed',
        reason: 'no_active_engine',
        restriction: requestPlan.restriction,
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
            error: message,
            errorCode: 'NO_ACTIVE_ENGINE',
            retrievalOutcome: outcome,
            evidenceSummary: buildTerminalEvidence(outcome, requestPlan.restriction),
          }),
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
      const searchDomains = requestPlan.restriction.effective
      let searchResult = await runWebSearchParallel({
        engines: availableEngines,
        engineOrder: this.config.engines,
        apiKeys: this.config.apiKeys || {},
        queries: expandedQueries,
        queryPlans: routingPlan.queryPlans,
        originalQuery: query,
        limit: appliedLimit,
        domains: searchDomains,
        endpoint: this.config.endpoint,
        scope: effectiveScope,
        includeSummary: this.config.includeSummary,
        includeRawContent: this.config.includeRawContent,
        autoReadNeedContent,
        // DeepSeek 的正文需求与其它引擎同条件：topK=0 时不再索取正文
        deepseekNeedContent: autoReadNeedContent,
        timeoutMs: parallelTimeoutMs,
        parallelMaxEngines: this.config.parallelMaxEngines,
        timeRange: requestPlan.timeRange,
        signal: context.requestSignal,
      })
      emitSearchTaskResultEvents(searchResult.tasks, 'initial')
      recordEngineOutcomes(searchResult.tasks)

      let executedSearchTaskCount = plannedSearchTaskCount
      let escalationInfo: {
        triggered: boolean
        reason: string | null
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
      // 取消优先：已取消的请求不再发起升级往返
      if (escalationDecision.escalate && !requestAborted()) {
        const triedEngines = new Set(searchResult.tasks.map((item) => item.task.engine))
        // 初始轮零成功且已配置 Exa 时优先走 Exa 兜底，避免整轮只剩失败
        const preferExa =
          escalationDecision.successfulEngineCount === 0 &&
          activeEngines.includes('exa') &&
          !triedEngines.has('exa')
        const candidates = preferExa
          ? ['exa', ...routingPlan.fallbackEngines.filter((item) => item !== 'exa')]
          : routingPlan.fallbackEngines
        let escalationEngine = ''
        let escalationReason: string = escalationDecision.reason || 'insufficient_sources'
        for (const engine of candidates) {
          if (!availableEngines.includes(engine) || triedEngines.has(engine)) continue
          const key = backoffKeyOf(engine)
          const inspection = backoff.inspect(key)
          if (inspection.blocked) continue
          if (inspection.probe) {
            if (!backoff.acquireProbe(key)) continue
            probesHeld.add(key)
          }
          escalationEngine = engine
          if (preferExa && engine === 'exa') escalationReason = 'exa_fallback'
          break
        }
        const escalationPlans = buildEscalationQueryPlans(routingPlan, escalationEngine)
        if (escalationEngine && escalationPlans.length > 0) {
          emitSearchTaskStartEvents(escalationPlans, 'escalation')
          const escalationResult = await runWebSearchParallel({
            engines: [escalationEngine],
            engineOrder: this.config.engines,
            apiKeys: this.config.apiKeys || {},
            queries: escalationPlans.map((item) => ({
              query: item.query,
              queryLanguage: item.queryLanguage,
            })),
            queryPlans: escalationPlans,
            originalQuery: query,
            limit: appliedLimit,
            domains: searchDomains,
            endpoint: this.config.endpoint,
            scope: effectiveScope,
            includeSummary: this.config.includeSummary,
            includeRawContent: this.config.includeRawContent,
            autoReadNeedContent,
            deepseekNeedContent: autoReadNeedContent,
            timeoutMs: parallelTimeoutMs,
            parallelMaxEngines: this.config.parallelMaxEngines,
            timeRange: requestPlan.timeRange,
            signal: context.requestSignal,
          })
          emitSearchTaskResultEvents(escalationResult.tasks, 'escalation')
          recordEngineOutcomes(escalationResult.tasks)
          searchResult = mergeWebSearchParallelResults(
            [searchResult, escalationResult],
            appliedLimit,
            this.config.engines,
          )
          executedSearchTaskCount += countPlannedTasks(escalationPlans)
          escalationInfo = {
            ...escalationInfo,
            triggered: true,
            reason: escalationReason,
            engine: escalationEngine,
          }
        }
      }

      const hits = searchResult.hits
      const evidenceTaskKey = buildSearchEvidenceTaskKey(context)
      // 同任务正文复用：先登记搜索正文，自动阅读取得正文后再补充登记，来源各自保留真实提供方
      recordSearchEvidence(evidenceTaskKey, hits)
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

      const emptyAutoReadBatch = {
        items: [] as AutoReadItem[],
        articleCount: 0,
        structuredCount: 0,
        summaryCount: 0,
        failedCount: 0,
        candidatesExamined: 0,
        candidateCount: autoReadCandidates.length,
        duplicateUrls: [] as string[],
        deadlineExceeded: false,
        cancelled: requestAborted(),
        batchTimeoutMs: autoReadBatchTimeoutMs,
        batchElapsedMs: 0,
      }
      // 取消优先：已取消的请求不再发起自动阅读批次
      const autoReadBatch = !requestAborted()
        ? await runSearchAutoReadBatch({
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
        : emptyAutoReadBatch

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
        const enriched: AutoReadItem = {
          ...item,
          ...(images.length > 0 ? { images } : {}),
          // 发布方与发布时间只取引擎声明字段，缺失就留空
          ...(item.publishedDate || !hit?.publishedDate ? {} : { publishedDate: hit.publishedDate }),
          ...(item.siteName || !hit?.siteName ? {} : { siteName: hit.siteName }),
        }
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
          const cancelledRead = enriched.skippedReason === 'cancelled'
          context.sendToolEvent({
            id: readCallId,
            tool: 'read_url',
            stage: cancelledRead ? 'result' : 'error',
            query: enriched.url,
            summary:
              enriched.evidenceKind === 'summary'
                ? '网页读取失败，已回退到搜索摘要（不计为正文）'
                : enriched.skippedReason === 'batch_deadline'
                  ? '批次总时限已用完，未读取该网页'
                  : cancelledRead
                    ? '网页读取已取消'
                    : '网页读取失败且无可用摘要回退',
            url: enriched.url,
            ...(cancelledRead ? {} : { error: enriched.error }),
            details: { ...details, cancelled: cancelledRead },
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

      // 自动阅读取得的正文也登记给同任务 read_url，来源保留真实读取引擎
      recordReadEvidence(evidenceTaskKey, autoReadEvidence)

      // 有效正文只算 article / structured；摘要单独计数，不冒充正文
      const autoReadBodyCount = autoReadBatch.articleCount + autoReadBatch.structuredCount
      const taskSucceeded = searchResult.tasks.filter((item) => item.status === 'success').length
      const taskFailed = searchResult.tasks.length - taskSucceeded

      const aborted = requestAborted()
      const autoReadState: RetrievalAutoReadReport['state'] = !autoReadActive
        ? 'off'
        : aborted || autoReadBatch.cancelled
          ? 'cancelled'
          : autoReadBatch.deadlineExceeded
            ? 'deadline'
            : autoReadBatch.summaryCount > 0 || autoReadBatch.failedCount > 0
              ? 'partial'
              : 'ok'
      const autoReadReport: RetrievalAutoReadReport = {
        state: autoReadState,
        requested: autoReadBatch.candidateCount,
        candidatesExamined: autoReadBatch.candidatesExamined,
        bodies: autoReadBodyCount,
        summaryOnly: autoReadBatch.summaryCount,
        failed: autoReadBatch.failedCount,
        skipped: autoReadEvidence.filter((item) => Boolean(item.skippedReason)).length,
      }
      const evidenceCounts: RetrievalEvidenceCounts = {
        article: autoReadBatch.articleCount,
        structured: autoReadBatch.structuredCount,
        summary: autoReadBatch.summaryCount,
        none: autoReadBatch.failedCount,
      }
      // 未取得正文的 URL 收口成固定原因枚举，供父结果按枚举统计未核实来源
      const readFailures: EvidenceSummaryFailure[] = autoReadEvidence
        .filter(
          (item) =>
            !item.skippedReason &&
            item.evidenceKind !== 'article' &&
            item.evidenceKind !== 'structured',
        )
        .map((item) => ({ url: item.url, reason: mapReadFailureReason(item.errorCode) }))
      const truncatedCount = autoReadEvidence.filter((item) => item.truncated).length
      const timeRangeReport: RetrievalTimeRangeReport | null = requestPlan.timeRange
        ? {
            start: requestPlan.timeRange.start ?? null,
            end: requestPlan.timeRange.end ?? null,
            verified: hits.filter((hit) => hit.timeRangeStatus === 'in_range').length,
            undated: hits.filter((hit) => hit.timeRangeStatus === 'undated').length,
          }
        : null
      const retrievalOutcome = buildRetrievalOutcome({
        taskResults: searchResult.tasks,
        attempted: searchResult.tasks.length,
        skippedEngines,
        autoRead: autoReadReport,
        evidence: evidenceCounts,
        cancelled: aborted,
        totalHits: hits.length,
        restriction: requestPlan.restriction,
        timeRange: timeRangeReport,
        exhaustedOverride: exhaustionState ?? undefined,
        escalation: {
          triggered: escalationInfo.triggered,
          ...(escalationInfo.engine ? { engine: escalationInfo.engine } : {}),
          reason: escalationInfo.reason,
        },
      })
      const evidenceSummary = buildEvidenceSummary({
        source: 'search',
        queries: expandedQueries.map((item) => item.query),
        hits: hits.length,
        evidence: evidenceCounts,
        engines: Array.from(new Set(searchResult.tasks.map((item) => item.task.engine))),
        failures: readFailures,
        truncated: truncatedCount,
        restriction: requestPlan.restriction,
        timeRange: timeRangeReport,
      })

      const summary = buildSummaryForModel({ query, hits, autoReadEvidence, outcome: retrievalOutcome })
      // 二进制网页配图只在显式请求时回传；正文里的图片链接始终保留，URL 不受影响
      const imageEvidence =
        requestPlan.includeImages &&
        context.modelCapabilities?.vision === true &&
        supportsToolImages(context.provider)
          ? await downloadSearchImageEvidence(autoReadEvidence, context.requestSignal)
          : undefined
      releaseRemainingProbes()

      context.sendToolEvent({
        id: callId,
        tool: 'web_search',
        stage: 'result',
        query,
        hits,
        summary:
          retrievalOutcome.status === 'cancelled'
            ? '检索已取消'
            : retrievalOutcome.status === 'failed' || retrievalOutcome.status === 'timeout'
              ? `搜索失败：${retrievalOutcome.reason}`
              : autoReadBatch.candidateCount > 0
                ? `搜索完成，取得正文 ${autoReadBodyCount} 条（候选 ${autoReadBatch.candidatesExamined}/${autoReadBatch.candidateCount}，仅摘要 ${autoReadBatch.summaryCount}）`
                : `搜索完成，共 ${hits.length} 条结果`,
        details: {
          retrievalOutcome,
          evidenceSummary,
          requestedLimit: modelRequestedLimit,
          appliedLimit,
          groupId: callId,
          engineCount: availableEngines.length,
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
          ...(imageEvidence ? { imageEvidence } : {}),
          content: JSON.stringify({
            query,
            expandedQueries,
            engines: availableEngines,
            scope: effectiveScope,
            request: {
              scope: effectiveScope,
              domains: requestPlan.restriction.requested,
              effectiveDomains: requestPlan.restriction.effective,
              restricted: requestPlan.restriction.restricted,
              domainConflict: requestPlan.conflict,
              timeRange: requestPlan.timeRange ?? null,
              includeImages: requestPlan.includeImages,
            },
            retrievalOutcome,
            evidenceSummary,
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
      releaseRemainingProbes()
      const message = searchError instanceof Error ? searchError.message : 'Web search failed'
      const errorCode = classifyWebSearchErrorCode(message)
      // 取消不包装成工具错误：整轮按取消收尾，不写 error 状态
      if (requestAborted()) return publishCancelledResult()
      const outcome = buildTerminalOutcome({
        status: 'failed',
        reason: 'all_sources_failed',
        restriction: requestPlan.restriction,
        retryable: errorCode !== 'HTTP_403' && errorCode !== 'HTTP_404',
      })
      context.sendToolEvent({
        id: callId,
        tool: 'web_search',
        stage: 'error',
        query,
        summary: '搜索失败',
        error: message,
        details: {
          errorCode,
          fallbackUsed: 'none',
          groupId: callId,
          cancelled: false,
          retrievalOutcome: outcome,
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
            error: message,
            errorCode,
            retrievalOutcome: outcome,
            evidenceSummary: buildTerminalEvidence(outcome, requestPlan.restriction),
          }),
        },
      }
    }
  }
}
