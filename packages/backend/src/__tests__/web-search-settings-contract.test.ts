import { parseSystemSettingsPayload } from '@aichat/shared/settings-codec'
import {
  normalizeWebSearchEngines,
  WEB_SEARCH_RANGES,
  type WebSearchEngine,
} from '@aichat/shared/web-search-contract'

describe('normalizeWebSearchEngines contract', () => {
  it('keeps first-seen order while trimming, lowercasing and dropping duplicates/unknowns', () => {
    expect(normalizeWebSearchEngines([' Exa ', 'tavily', 'exa', 'unknown', 42])).toEqual(['exa', 'tavily'])
  })

  it('accepts JSON, comma and newline separated strings', () => {
    expect(normalizeWebSearchEngines('["DeepSeek", "brave"]')).toEqual(['deepseek', 'brave'])
    expect(normalizeWebSearchEngines('metaso, BRAVE\nmetaso')).toEqual(['metaso', 'brave'])
  })

  it('falls back to Tavily for non-lists, empty lists and unusable content', () => {
    expect(normalizeWebSearchEngines(undefined)).toEqual(['tavily'])
    expect(normalizeWebSearchEngines('')).toEqual(['tavily'])
    expect(normalizeWebSearchEngines('[]')).toEqual(['tavily'])
    expect(normalizeWebSearchEngines({ engines: ['exa'] })).toEqual(['tavily'])
    expect(normalizeWebSearchEngines(['unknown'], ['tavily'])).toEqual(['tavily'])
  })

  it('supports an explicit empty fallback for callers whose set may be empty', () => {
    expect(normalizeWebSearchEngines(undefined, [])).toEqual([])
    expect(normalizeWebSearchEngines(['unknown'], [])).toEqual([])
  })

  it('never returns the fallback array itself', () => {
    const fallback: WebSearchEngine[] = ['tavily']
    const result = normalizeWebSearchEngines([], fallback)
    result.push('exa')
    expect(fallback).toEqual(['tavily'])
  })
})

describe('settings codec web search bounds', () => {
  it('clamps the result limit into the shared 1..10 range and defaults to the shared fallback', () => {
    expect(parseSystemSettingsPayload({ web_search_result_limit: 99 }).webSearchResultLimit).toBe(
      WEB_SEARCH_RANGES.resultLimit.max,
    )
    expect(parseSystemSettingsPayload({ web_search_result_limit: 0 }).webSearchResultLimit).toBe(
      WEB_SEARCH_RANGES.resultLimit.min,
    )
    expect(parseSystemSettingsPayload({ web_search_result_limit: '7' }).webSearchResultLimit).toBe(7)
    expect(parseSystemSettingsPayload({}).webSearchResultLimit).toBe(WEB_SEARCH_RANGES.resultLimit.fallback)
    expect(parseSystemSettingsPayload({ web_search_result_limit: 'abc' }).webSearchResultLimit).toBe(
      WEB_SEARCH_RANGES.resultLimit.fallback,
    )
  })

  it('normalizes persisted engine lists through the shared contract', () => {
    expect(
      parseSystemSettingsPayload({ web_search_enabled_engines: '[" EXA ","tavily","exa"]' })
        .webSearchEnabledEngines,
    ).toEqual(['exa', 'tavily'])
    expect(
      parseSystemSettingsPayload({ web_search_enabled_engines: 'brave, tavily' }).webSearchEnabledEngines,
    ).toEqual(['brave', 'tavily'])
    expect(parseSystemSettingsPayload({ web_search_enabled_engines: [] }).webSearchEnabledEngines).toEqual([
      'tavily',
    ])
  })

  it('clamps execution settings into the shared ranges and keeps their defaults', () => {
    const clamped = parseSystemSettingsPayload({
      web_search_parallel_max_engines: 99,
      web_search_parallel_max_queries_per_call: 0,
      web_search_parallel_timeout_ms: 999999,
      web_search_auto_read_parallelism: 0,
      web_search_auto_read_batch_timeout_ms: 1,
    })
    expect(clamped.webSearchParallelMaxEngines).toBe(WEB_SEARCH_RANGES.parallelMaxEngines.max)
    expect(clamped.webSearchParallelMaxQueriesPerCall).toBe(
      WEB_SEARCH_RANGES.parallelMaxQueriesPerCall.min,
    )
    expect(clamped.webSearchParallelTimeoutMs).toBe(WEB_SEARCH_RANGES.parallelTimeoutMs.max)
    expect(clamped.webSearchAutoReadParallelism).toBe(WEB_SEARCH_RANGES.autoReadParallelism.min)
    expect(clamped.webSearchAutoReadBatchTimeoutMs).toBe(
      WEB_SEARCH_RANGES.autoReadBatchTimeoutMs.min,
    )

    const defaults = parseSystemSettingsPayload({})
    expect(defaults.webSearchParallelMaxEngines).toBe(WEB_SEARCH_RANGES.parallelMaxEngines.fallback)
    expect(defaults.webSearchParallelMaxQueriesPerCall).toBe(
      WEB_SEARCH_RANGES.parallelMaxQueriesPerCall.fallback,
    )
    expect(defaults.webSearchParallelTimeoutMs).toBe(WEB_SEARCH_RANGES.parallelTimeoutMs.fallback)
    expect(defaults.webSearchAutoReadParallelism).toBe(WEB_SEARCH_RANGES.autoReadParallelism.fallback)
    expect(defaults.webSearchAutoReadBatchTimeoutMs).toBe(
      WEB_SEARCH_RANGES.autoReadBatchTimeoutMs.fallback,
    )
  })
})
