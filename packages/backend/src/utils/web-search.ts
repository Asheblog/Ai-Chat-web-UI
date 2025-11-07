import { BackendLogger as log } from './logger'

export interface WebSearchHit {
  title: string
  url: string
  snippet?: string
  content?: string
}

export interface WebSearchOptions {
  engine: string
  apiKey?: string
  limit: number
  domains?: string[]
  endpoint?: string
}

const DEFAULT_LIMIT = 4

const clampLimit = (value?: number) => {
  if (!value || Number.isNaN(value)) return DEFAULT_LIMIT
  return Math.max(1, Math.min(10, value))
}

const normalizeDomains = (domains?: string[]) =>
  Array.isArray(domains) ? domains.map((d) => d.trim()).filter(Boolean) : []

export const formatHitsForModel = (query: string, hits: WebSearchHit[]): string => {
  if (hits.length === 0) {
    return `Web search for "${query}" returned no results.`
  }
  const lines = hits.map((hit, idx) => {
    const snippet = hit.snippet || hit.content || ''
    return `${idx + 1}. ${hit.title || 'Untitled'}\nURL: ${hit.url}\nSummary: ${snippet}`.trim()
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

export const runWebSearch = async (query: string, opts: WebSearchOptions): Promise<WebSearchHit[]> => {
  const engine = (opts.engine || '').toLowerCase()
  log.debug('web search request', { engine, query })
  switch (engine) {
    case 'tavily':
      return runTavilySearch(query, opts)
    case 'brave':
      return runBraveSearch(query, opts)
    default:
      throw new Error(`Unsupported web search engine: ${engine || 'unknown'}`)
  }
}
