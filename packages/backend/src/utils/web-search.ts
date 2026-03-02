import { BackendLogger as log } from './logger'

export type WebSearchQueryLanguage = 'zh' | 'en' | 'unknown'

export interface WebSearchHit {
  title: string
  url: string
  snippet?: string
  content?: string
  engine?: string
  query?: string
  queryLanguage?: WebSearchQueryLanguage
  rank?: number
  sourceEngines?: string[]
  mergeScore?: number
}

export interface WebSearchOptions {
  engine: string
  apiKey?: string
  limit: number
  domains?: string[]
  endpoint?: string
  scope?: string
  includeSummary?: boolean
  includeRawContent?: boolean
  signal?: AbortSignal
}

export interface WebSearchParallelQuery {
  query: string
  queryLanguage?: WebSearchQueryLanguage
}

export interface WebSearchParallelTask {
  engine: string
  query: string
  queryLanguage: WebSearchQueryLanguage
  queryIndex: number
  taskIndex: number
}

export interface WebSearchTaskResult {
  task: WebSearchParallelTask
  status: 'success' | 'error'
  hits: WebSearchHit[]
  error?: string
}

export interface WebSearchParallelOptions {
  engines: string[]
  engineOrder?: string[]
  apiKeys: Partial<Record<string, string>>
  queries: WebSearchParallelQuery[]
  limit: number
  domains?: string[]
  endpoint?: string
  scope?: string
  includeSummary?: boolean
  includeRawContent?: boolean
  timeoutMs?: number
  parallelMaxEngines?: number
  mergeStrategy?: 'hybrid_score_v1' | string
}

export interface WebSearchParallelResult {
  hits: WebSearchHit[]
  tasks: WebSearchTaskResult[]
}

const DEFAULT_LIMIT = 4
const DEFAULT_PARALLEL_TIMEOUT_MS = 12_000
const SUPPORTED_ENGINES = ['tavily', 'brave', 'metaso'] as const
const METASO_SCOPE_WHITELIST = new Set(['webpage', 'document', 'paper', 'scholar', 'image', 'video', 'podcast'])

const clampLimit = (value?: number) => {
  if (!value || Number.isNaN(value)) return DEFAULT_LIMIT
  return Math.max(1, Math.min(10, value))
}

const normalizeDomains = (domains?: string[]) =>
  Array.isArray(domains) ? domains.map((d) => d.trim()).filter(Boolean) : []

const normalizeEngine = (value: string) => value.trim().toLowerCase()

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

const getEngineWeight = (engine: string, engineOrder: string[]): number => {
  const idx = engineOrder.indexOf(engine)
  if (idx < 0) return 0
  return Math.max(0, engineOrder.length - idx)
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
    return `${idx + 1}. ${hit.title || 'Untitled'}\nURL: ${hit.url}\n${engineText} | ${languageText}\nSummary: ${snippet}`.trim()
  })
  return `Web search results for "${query}":\n\n${lines.join('\n\n')}`
}

const runTavilySearch = async (query: string, opts: WebSearchOptions): Promise<WebSearchHit[]> => {
  if (!opts.apiKey) {
    throw new Error('Tavily API key is not configured')
  }
  const endpoint = opts.endpoint || 'https://api.tavily.com/search'
  const payload: Record<string, unknown> = {
    api_key: opts.apiKey,
    query,
    max_results: clampLimit(opts.limit),
    include_answer: false,
    search_depth: 'advanced',
  }
  const domains = normalizeDomains(opts.domains)
  if (domains.length > 0) {
    payload.include_domains = domains
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: opts.signal,
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Tavily search failed: ${response.status} ${text}`)
  }
  const data = await response.json()
  const results = Array.isArray(data?.results) ? data.results : []
  return results.map((item: any) => ({
    title: item?.title || item?.url || 'Untitled',
    url: item?.url || '',
    snippet: item?.content || item?.snippet || '',
    content: item?.content,
  }))
}

const runBraveSearch = async (query: string, opts: WebSearchOptions): Promise<WebSearchHit[]> => {
  if (!opts.apiKey) {
    throw new Error('Brave Search API key is not configured')
  }
  const endpoint =
    opts.endpoint ||
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${clampLimit(
      opts.limit,
    )}`
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      'X-Subscription-Token': opts.apiKey,
      Accept: 'application/json',
    },
    signal: opts.signal,
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Brave search failed: ${response.status} ${text}`)
  }
  const data = await response.json()
  const results = Array.isArray(data?.web?.results) ? data.web.results : []
  return results.map((item: any) => ({
    title: item?.title || item?.url || 'Untitled',
    url: item?.url || '',
    snippet: item?.description || item?.snippet || '',
    content: item?.description,
  }))
}

const sanitizeMetasoScope = (scope?: string) => {
  if (!scope) return 'webpage'
  const normalized = scope.trim().toLowerCase()
  return METASO_SCOPE_WHITELIST.has(normalized) ? normalized : 'webpage'
}

const runMetasoSearch = async (query: string, opts: WebSearchOptions): Promise<WebSearchHit[]> => {
  if (!opts.apiKey) {
    throw new Error('Metaso API key is not configured')
  }
  const endpoint = opts.endpoint || 'https://metaso.cn/api/v1/search'
  const scope = sanitizeMetasoScope(opts.scope)
  const payload: Record<string, unknown> = {
    q: query,
    scope,
    includeSummary: Boolean(opts.includeSummary),
    includeRawContent: Boolean(opts.includeRawContent),
    size: clampLimit(opts.limit),
    conciseSnippet: false,
    stream: false,
    output: 'json',
    format: 'chat_completions',
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
    const text = await response.text()
    throw new Error(`Metaso search failed: ${response.status} ${text}`)
  }
  const data = await response.json()
  const scopeCandidates: Record<string, any[] | undefined> = {
    webpage: data?.results || data?.data?.results,
    document: data?.documents || data?.data?.documents,
    paper: data?.papers || data?.data?.papers,
    scholar: data?.scholars || data?.data?.scholars,
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
  const results = (candidateArrays.find((item) => Array.isArray(item)) as any[]) || []
  return results.map((item: any) => ({
    title: item?.title || item?.name || item?.url || 'Untitled',
    url: item?.url || item?.link || item?.imageUrl || '',
    snippet: item?.summary || item?.description || item?.snippet || '',
    content: item?.content || item?.summary || item?.description,
  }))
}

export const runWebSearch = async (query: string, opts: WebSearchOptions): Promise<WebSearchHit[]> => {
  const engine = normalizeEngine(opts.engine || '')
  log.debug('web search request', { engine, query })
  switch (engine) {
    case 'tavily':
      return runTavilySearch(query, opts)
    case 'brave':
      return runBraveSearch(query, opts)
    case 'metaso':
      return runMetasoSearch(query, opts)
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
    if (score > existing.score) {
      existing.score = score
      existing.hit = {
        ...existing.hit,
        ...hit,
        snippet:
          (hit.snippet || '').length >= (existing.hit.snippet || '').length
            ? hit.snippet
            : existing.hit.snippet,
        content:
          (hit.content || '').length >= (existing.hit.content || '').length
            ? hit.content
            : existing.hit.content,
      }
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

export const runWebSearchParallel = async (
  opts: WebSearchParallelOptions,
): Promise<WebSearchParallelResult> => {
  const engineCandidates = Array.from(
    new Set((opts.engines || []).map((engine) => normalizeEngine(engine)).filter(Boolean))
  ).filter((engine): engine is (typeof SUPPORTED_ENGINES)[number] =>
    SUPPORTED_ENGINES.includes(engine as (typeof SUPPORTED_ENGINES)[number])
  )
  const maxEngines = Math.max(1, Math.min(3, Math.floor(opts.parallelMaxEngines || engineCandidates.length || 1)))
  const engineOrderRaw = Array.from(
    new Set((opts.engineOrder || []).map((engine) => normalizeEngine(engine)).filter(Boolean))
  ).filter((engine): engine is (typeof SUPPORTED_ENGINES)[number] =>
    SUPPORTED_ENGINES.includes(engine as (typeof SUPPORTED_ENGINES)[number])
  )
  const selectedEngines = [
    ...engineOrderRaw.filter((engine) => engineCandidates.includes(engine)),
    ...engineCandidates.filter((engine) => !engineOrderRaw.includes(engine)),
  ].slice(0, maxEngines)

  const normalizedQueries = (opts.queries || [])
    .map((item) => ({
      query: (item.query || '').trim(),
      queryLanguage: item.queryLanguage || 'unknown',
    }))
    .filter((item) => item.query.length > 0)

  if (selectedEngines.length === 0 || normalizedQueries.length === 0) {
    return { hits: [], tasks: [] }
  }

  const tasks: WebSearchParallelTask[] = []
  let taskIndex = 0
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

  const timeoutMs = Math.max(1000, opts.timeoutMs || DEFAULT_PARALLEL_TIMEOUT_MS)

  const taskResults = await Promise.all(
    tasks.map(async (task): Promise<WebSearchTaskResult> => {
      const apiKey = (opts.apiKeys?.[task.engine] || '').trim()
      if (!apiKey) {
        return {
          task,
          status: 'error',
          hits: [],
          error: `API key for ${task.engine} is not configured`,
        }
      }

      const abortController = new AbortController()
      const timeoutId = setTimeout(() => abortController.abort(), timeoutMs)
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
          signal: abortController.signal,
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

        return {
          task,
          status: 'success',
          hits: normalizedHits,
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown search error'
        return {
          task,
          status: 'error',
          hits: [],
          error: message,
        }
      } finally {
        clearTimeout(timeoutId)
      }
    }),
  )

  const mergedHits = mergeHits(
    taskResults.flatMap((result) => result.hits),
    opts.limit,
    selectedEngines,
  )

  return {
    hits: mergedHits,
    tasks: taskResults,
  }
}
