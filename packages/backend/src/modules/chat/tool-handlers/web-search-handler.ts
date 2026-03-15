/**
 * Web 搜索工具处理器
 */

import { randomUUID } from 'node:crypto'
import {
  runWebSearchParallel,
  mergeWebSearchParallelResults,
  formatHitsForModel,
  type WebSearchParallelQuery,
  type WebSearchParallelQueryPlan,
  type WebSearchParallelResult,
  type WebSearchTaskResult,
} from '../../../utils/web-search'
import { truncateText } from '../../../utils/parsers'
import { readUrlContent, type UrlReadErrorCode } from '../../../utils/url-reader'
import type {
  IToolHandler,
  ToolCall,
  ToolCallContext,
  ToolDefinition,
  ToolHandlerResult,
  ToolLogDetails,
  WebSearchHandlerConfig,
} from './types'

interface AutoReadEvidenceItem {
  url: string
  title?: string
  excerpt?: string
  siteName?: string
  byline?: string
  wordCount?: number
  content?: string
  error?: string
  errorCode?: UrlReadErrorCode
  httpStatus?: number
  fallbackUsed: 'none' | 'search_snippet' | 'crawler'
  rank: number
}

const DEFAULT_AUTO_READ_TOP_K = 2
const DEFAULT_AUTO_READ_TIMEOUT_MS = 18000
const DEFAULT_AUTO_READ_MAX_CONTENT_LENGTH = 24000
const DEFAULT_AUTO_READ_PARALLELISM = 2
const DEFAULT_MODEL_EVIDENCE_CHARS = 2200
const DEFAULT_MODEL_RESULT_HITS = 5
const DEFAULT_MODEL_TASK_RESULTS = 6
const DEFAULT_MODEL_SNIPPET_CHARS = 360
const DEFAULT_MODEL_SUMMARY_CHARS = 3200
const DEFAULT_MODEL_EVIDENCE_ITEMS = 2
const DEFAULT_MODEL_EVIDENCE_ITEM_CHARS = 900
const DEFAULT_PARALLEL_MAX_ENGINES = 3
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

const dedupeSearchUrls = (hits: Array<{ url?: string }>, limit: number): string[] => {
  if (limit <= 0) return []
  const seen = new Set<string>()
  const urls: string[] = []
  for (const hit of hits) {
    const rawUrl = typeof hit.url === 'string' ? hit.url.trim() : ''
    if (!rawUrl || !isHttpUrl(rawUrl) || seen.has(rawUrl)) continue
    seen.add(rawUrl)
    urls.push(rawUrl)
    if (urls.length >= limit) break
  }
  return urls
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

const shouldExpandBilingual = (
  query: string,
  language: 'zh' | 'en' | 'unknown',
  mode: 'off' | 'conditional' | 'always',
  enabled: boolean,
): boolean => {
  if (!enabled || mode === 'off') return false
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
  const useBilingual = shouldExpandBilingual(
    query,
    queryLanguage,
    bilingualMode,
    config.autoBilingual !== false,
  )

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

const pickActiveEngines = (config: WebSearchHandlerConfig): string[] => {
  const order = Array.from(
    new Set(
      [...(config.engineOrder || []), ...(config.engines || [])]
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  )
  const withKeys = order.filter((engine) => Boolean(config.apiKeys?.[engine]))
  const maxEngines = clampPositiveInt(
    config.parallelMaxEngines,
    DEFAULT_PARALLEL_MAX_ENGINES,
    1,
    3,
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
  zh: ['metaso', 'tavily', 'brave'],
  en: ['tavily', 'brave', 'metaso'],
  unknown: ['tavily', 'metaso', 'brave'],
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
  const queryList = expandedQueries.length > 0 ? expandedQueries : [{ query: originalQuery, queryLanguage: 'unknown' }]
  const primaryLanguage = queryList[0]?.queryLanguage || detectQueryLanguage(originalQuery)
  const highRisk = isHighRiskQuery(originalQuery)
  const requiredSources = pickRequiredSourceCount(activeEngines.length, highRisk, minSources)
  const escalationPolicy = conflictEscalation === 'off' ? 'off' : 'auto'

  const queryPlans: WebSearchParallelQueryPlan[] = queryList.map((queryItem, queryIndex) => {
    const language = queryItem.queryLanguage || detectQueryLanguage(queryItem.query)
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

const buildSummaryForModel = (
  query: string,
  hits: Array<{ title: string; url: string; snippet?: string; content?: string }>,
  autoReadEvidence: AutoReadEvidenceItem[],
): string => {
  const base = formatHitsForModel(query, hits)
  if (autoReadEvidence.length === 0) {
    return `${base}\n\n注：本轮未读取网页正文，仅基于搜索摘要。`
  }

  const successItems = autoReadEvidence.filter((item) => !item.error)
  const failedItems = autoReadEvidence.filter((item) => item.error)
  const lines: string[] = []

  lines.push('自动网页读取证据（按搜索结果顺序）：')
  for (const item of autoReadEvidence) {
    if (item.error) {
      const fallbackSuffix =
        item.fallbackUsed === 'search_snippet' ? '，已回退为搜索摘要' : '，无可用回退正文'
      lines.push(
        `${item.rank}. 读取失败：${item.url} | ${item.errorCode || 'UNKNOWN'}${typeof item.httpStatus === 'number' ? ` (HTTP ${item.httpStatus})` : ''}${fallbackSuffix}`,
      )
      if (item.content) {
        lines.push(`   回退摘要：${truncateText(item.content, 600)}`)
      }
      continue
    }
    const title = item.title || item.url
    const extractionSuffix = item.fallbackUsed === 'crawler' ? '（爬虫回退）' : ''
    lines.push(`${item.rank}. ${title}${extractionSuffix}`)
    lines.push(`   URL: ${item.url}`)
    if (item.excerpt) {
      lines.push(`   摘要: ${truncateText(item.excerpt, 360)}`)
    }
    if (item.content) {
      lines.push(`   正文摘录: ${truncateText(item.content, DEFAULT_MODEL_EVIDENCE_CHARS)}`)
    }
  }

  return `${base}\n\n${lines.join('\n')}\n\n统计：自动读取成功 ${successItems.length} 条，失败 ${failedItems.length} 条。`
}

const slimHitsForModel = (hits: Array<{ title: string; url: string; snippet?: string; content?: string; engine?: string; rank?: number; sourceEngines?: string[] }>) =>
  hits.slice(0, DEFAULT_MODEL_RESULT_HITS).map((hit) => ({
    title: hit.title,
    url: hit.url,
    snippet: truncateText(hit.snippet || hit.content || '', DEFAULT_MODEL_SNIPPET_CHARS),
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

const slimEvidenceForModel = (items: AutoReadEvidenceItem[]) =>
  items.slice(0, DEFAULT_MODEL_EVIDENCE_ITEMS).map((item) => ({
    url: item.url,
    title: item.title,
    excerpt: item.excerpt ? truncateText(item.excerpt, DEFAULT_MODEL_SNIPPET_CHARS) : undefined,
    content: item.content ? truncateText(item.content, DEFAULT_MODEL_EVIDENCE_ITEM_CHARS) : undefined,
    siteName: item.siteName,
    byline: item.byline,
    wordCount: item.wordCount,
    error: item.error,
    errorCode: item.errorCode,
    httpStatus: item.httpStatus,
    fallbackUsed: item.fallbackUsed,
    rank: item.rank,
  }))

async function mapWithConcurrency<TItem, TResult>(
  items: TItem[],
  concurrency: number,
  mapper: (item: TItem, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  if (items.length === 0) return []
  const limit = Math.max(1, Math.floor(concurrency))
  const results = new Array<TResult>(items.length)
  let nextIndex = 0

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const current = nextIndex
      nextIndex += 1
      if (current >= items.length) return
      results[current] = await mapper(items[current], current)
    }
  })

  await Promise.all(workers)
  return results
}

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
    const reasoningMetaBase = { kind: 'tool', tool: 'web_search', query, callId }

    if (!query) {
      context.emitReasoning('模型请求了空的联网搜索参数，已忽略。', {
        ...reasoningMetaBase,
        stage: 'error',
      })
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
    const expandedQueries = buildBilingualQueries(query, this.config)
    const activeEngines = pickActiveEngines(this.config)
    const routingPlan = buildLanguageAwareSearchPlan({
      originalQuery: query,
      expandedQueries,
      activeEngines,
      engineOrder: this.config.engineOrder || [],
      minSources: this.config.minSources,
      conflictEscalation: this.config.conflictEscalation,
      localeRouting: this.config.localeRouting,
    })

    context.emitReasoning(
      `联网搜索：${query}（引擎 ${activeEngines.length}，查询 ${expandedQueries.length}，目标 ${appliedLimit} 条，最少来源 ${routingPlan.requiredSources}）`,
      {
        ...reasoningMetaBase,
        stage: 'start',
      },
    )
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
          hits: taskResult.hits.map(({ imageUrl: _imageUrl, thumbnailUrl: _thumbnailUrl, ...hit }) => hit),
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
        engineOrder: this.config.engineOrder,
        apiKeys: this.config.apiKeys || {},
        queries: expandedQueries,
        queryPlans: routingPlan.queryPlans,
        limit: appliedLimit,
        domains: this.config.domains,
        endpoint: this.config.endpoint,
        scope: this.config.scope,
        includeSummary: this.config.includeSummary,
        includeRawContent: this.config.includeRawContent,
        timeoutMs: parallelTimeoutMs,
        parallelMaxEngines: this.config.parallelMaxEngines,
        mergeStrategy: this.config.mergeStrategy,
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
          context.emitReasoning(
            `搜索结果出现${escalationDecision.reason === 'low_overlap' ? '低重叠冲突' : '来源不足'}，追加 ${escalationEngine} 复核。`,
            {
              ...reasoningMetaBase,
              stage: 'start',
              escalationReason: escalationDecision.reason,
              escalationEngine,
              overlapRatio: escalationDecision.overlapRatio,
              successfulEngineCount: escalationDecision.successfulEngineCount,
            },
          )
          emitSearchTaskStartEvents(escalationPlans, 'escalation')
          const escalationResult = await runWebSearchParallel({
            engines: activeEngines,
            engineOrder: this.config.engineOrder,
            apiKeys: this.config.apiKeys || {},
            queries: escalationPlans.map((item) => ({
              query: item.query,
              queryLanguage: item.queryLanguage,
            })),
            queryPlans: escalationPlans,
            limit: appliedLimit,
            domains: this.config.domains,
            endpoint: this.config.endpoint,
            scope: this.config.scope,
            includeSummary: this.config.includeSummary,
            includeRawContent: this.config.includeRawContent,
            timeoutMs: parallelTimeoutMs,
            parallelMaxEngines: this.config.parallelMaxEngines,
            mergeStrategy: this.config.mergeStrategy,
          })
          emitSearchTaskResultEvents(escalationResult.tasks, 'escalation')
          searchResult = mergeWebSearchParallelResults(
            [searchResult, escalationResult],
            appliedLimit,
            this.config.engineOrder,
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

      const hits = searchResult.hits.map(({ imageUrl: _imageUrl, thumbnailUrl: _thumbnailUrl, ...hit }) => hit)
      const autoReadEnabled = this.config.autoReadAfterSearch !== false
      const autoReadTopK = clampAutoReadTopK(this.config.autoReadTopK)
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

      const autoReadTargets = autoReadEnabled ? dedupeSearchUrls(hits, autoReadTopK) : []
      const autoReadEvidence = await mapWithConcurrency(
        autoReadTargets,
        autoReadParallelism,
        async (targetUrl, index): Promise<AutoReadEvidenceItem> => {
          const rank = index + 1
          const readCallId = `${callId}:read:${rank}`
          context.emitReasoning(`搜索后自动读取网页（${rank}/${autoReadTargets.length}）：${targetUrl}`, {
            ...reasoningMetaBase,
            stage: 'start',
            subTool: 'read_url',
            subCallId: readCallId,
            url: targetUrl,
            rank,
          })
          context.sendToolEvent({
            id: readCallId,
            tool: 'read_url',
            stage: 'start',
            query: targetUrl,
            summary: '基于搜索结果自动读取网页正文',
            url: targetUrl,
            details: {
              groupId: callId,
              url: targetUrl,
              rank,
              autoTriggered: true,
              parentTool: 'web_search',
              parentCallId: callId,
              taskType: 'read_url',
            },
          })

          const readResult = await readUrlContent(targetUrl, {
            timeout: autoReadTimeoutMs,
            maxContentLength: autoReadMaxContentLength,
          })
          if (readResult.error) {
            const fallbackSnippet =
              hits.find((hit) => hit.url === targetUrl)?.content ||
              hits.find((hit) => hit.url === targetUrl)?.snippet ||
              ''
            const fallbackText = truncateText(fallbackSnippet, DEFAULT_MODEL_EVIDENCE_CHARS)
            const evidenceItem: AutoReadEvidenceItem = {
              url: targetUrl,
              error: readResult.error,
              errorCode: readResult.errorCode,
              httpStatus: readResult.httpStatus,
              content: fallbackText || undefined,
              fallbackUsed: fallbackText ? 'search_snippet' : 'none',
              rank,
            }

            const details: ToolLogDetails = {
              groupId: callId,
              url: targetUrl,
              rank,
              autoTriggered: true,
              parentTool: 'web_search',
              parentCallId: callId,
              taskType: 'read_url',
              errorCode: readResult.errorCode,
              httpStatus: readResult.httpStatus,
              fallbackUsed: evidenceItem.fallbackUsed,
            }
            if (fallbackText) {
              details.resultText = fallbackText
            }

            context.emitReasoning(
              `网页读取失败：${targetUrl}（${readResult.errorCode || 'UNKNOWN'}${typeof readResult.httpStatus === 'number' ? ` / HTTP ${readResult.httpStatus}` : ''}）`,
              {
                ...reasoningMetaBase,
                stage: 'error',
                subTool: 'read_url',
                subCallId: readCallId,
                url: targetUrl,
                rank,
                errorCode: readResult.errorCode,
                httpStatus: readResult.httpStatus,
                fallbackUsed: evidenceItem.fallbackUsed,
              },
            )
            context.sendToolEvent({
              id: readCallId,
              tool: 'read_url',
              stage: 'error',
              query: targetUrl,
              summary:
                evidenceItem.fallbackUsed === 'search_snippet'
                  ? '网页读取失败，已回退到搜索摘要'
                  : '网页读取失败且无可用摘要回退',
              url: targetUrl,
              error: readResult.error,
              details,
            })
            return evidenceItem
          }

          const evidenceItem: AutoReadEvidenceItem = {
            url: targetUrl,
            title: readResult.title || undefined,
            excerpt: readResult.excerpt || undefined,
            siteName: readResult.siteName || undefined,
            byline: readResult.byline || undefined,
            wordCount: readResult.wordCount,
            content: truncateText(readResult.textContent || '', DEFAULT_MODEL_EVIDENCE_CHARS),
            fallbackUsed: readResult.fallbackUsed === 'crawler' ? 'crawler' : 'none',
            rank,
          }
          context.emitReasoning(
            `网页读取成功：${readResult.title || targetUrl}（约 ${readResult.wordCount || 0} 词${evidenceItem.fallbackUsed === 'crawler' ? '，爬虫回退' : ''}）`,
            {
              ...reasoningMetaBase,
              stage: 'result',
              subTool: 'read_url',
              subCallId: readCallId,
              url: targetUrl,
              rank,
              title: readResult.title,
              wordCount: readResult.wordCount,
              fallbackUsed: evidenceItem.fallbackUsed,
            },
          )
          context.sendToolEvent({
            id: readCallId,
            tool: 'read_url',
            stage: 'result',
            query: targetUrl,
            summary: readResult.title
              ? `已读取：${readResult.title}${evidenceItem.fallbackUsed === 'crawler' ? '（爬虫回退）' : ''}`
              : evidenceItem.fallbackUsed === 'crawler'
                ? '网页读取完成（爬虫回退）'
                : '网页读取完成',
            url: targetUrl,
            title: readResult.title,
            excerpt: readResult.excerpt,
            wordCount: readResult.wordCount,
            siteName: readResult.siteName,
            byline: readResult.byline,
            details: {
              groupId: callId,
              url: targetUrl,
              rank,
              autoTriggered: true,
              parentTool: 'web_search',
              parentCallId: callId,
              taskType: 'read_url',
              title: readResult.title,
              excerpt: readResult.excerpt,
              wordCount: readResult.wordCount,
              siteName: readResult.siteName,
              byline: readResult.byline,
              fallbackUsed: evidenceItem.fallbackUsed,
            },
          })
          return evidenceItem
        },
      )

      const autoReadSucceeded = autoReadEvidence.filter((item) => !item.error).length
      const autoReadFailed = autoReadEvidence.length - autoReadSucceeded
      const taskSucceeded = searchResult.tasks.filter((item) => item.status === 'success').length
      const taskFailed = searchResult.tasks.length - taskSucceeded
      const summary = buildSummaryForModel(query, hits, autoReadEvidence)

      context.emitReasoning(`获得 ${hits.length} 条结果，自动读取正文成功 ${autoReadSucceeded} 条。`, {
        ...reasoningMetaBase,
        stage: 'result',
        hits: hits.length,
        searchTaskTotal: searchResult.tasks.length,
        searchTaskSucceeded: taskSucceeded,
        searchTaskFailed: taskFailed,
        autoReadRequested: autoReadTargets.length,
        autoReadSucceeded,
        autoReadFailed,
        escalationTriggered: escalationInfo.triggered,
        escalationReason: escalationInfo.reason,
        escalationEngine: escalationInfo.engine,
        overlapRatio: escalationInfo.overlapRatio,
      })
      context.sendToolEvent({
        id: callId,
        tool: 'web_search',
        stage: 'result',
        query,
        hits,
        summary:
          autoReadTargets.length > 0
            ? `搜索完成，自动读取正文 ${autoReadSucceeded}/${autoReadTargets.length} 条`
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
          autoReadRequested: autoReadTargets.length,
          autoReadSucceeded,
          autoReadFailed,
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
              requested: autoReadTargets.length,
              succeeded: autoReadSucceeded,
              failed: autoReadFailed,
            },
          }),
        },
      }
    } catch (searchError: unknown) {
      const message = searchError instanceof Error ? searchError.message : 'Web search failed'
      const errorCode = classifyWebSearchErrorCode(message)
      context.emitReasoning(`联网搜索失败：${message}`, {
        ...reasoningMetaBase,
        stage: 'error',
        errorCode,
      })
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
