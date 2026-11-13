import type { WebSearchParallelResult } from '../../../utils/web-search'
import { DEEPSEEK_SEARCH_ENDPOINT } from '../../../utils/deepseek-tools'
import { WebSearchToolHandler } from './web-search-handler'
import {
  buildLanguageAwareSearchPlan,
  evaluateSearchEscalation,
} from './web-search-handler'

describe('WebSearchToolHandler DeepSeek integration', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  const createContext = (signal?: AbortSignal) => ({
    sessionId: 1,
    actorIdentifier: 'user:test',
    actorUserId: 1,
    messageId: 10,
    emitReasoning: jest.fn(),
    sendToolEvent: jest.fn(),
    requestSignal: signal,
  })

  const createConfig = (overrides: Record<string, unknown> = {}) => ({
    enabled: true,
    engines: ['deepseek'],
    engineOrder: ['deepseek'],
    apiKeys: { deepseek: 'ds-key' },
    resultLimit: 5,
    domains: [],
    scope: 'webpage',
    autoBilingual: false,
    autoReadAfterSearch: true,
    autoReadTopK: 1,
    parallelMaxEngines: 1,
    ...overrides,
  })

  it('reuses valid search content for auto-read evidence without fetching the page again', async () => {
    const body = '搜索返回的正文内容。'.repeat(40)
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(DEEPSEEK_SEARCH_ENDPOINT)
      return new Response(
        JSON.stringify({
          results: [
            {
              title: 'Reusable',
              url: 'https://example.com/reusable',
              snippet: 'short',
              summary: 'summary',
              content: body,
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as jest.MockedFunction<typeof fetch>
    global.fetch = fetchMock

    const handler = new WebSearchToolHandler(createConfig() as any)
    const result = await handler.handle(
      { id: 'call_ds', function: { name: 'web_search', arguments: '{}' } },
      { query: 'DeepSeek 测试' },
      createContext() as any,
    )

    const payload = JSON.parse(String(result.message.content))
    expect(payload.autoReadEvidence[0].content).toContain('搜索返回的正文内容')
    expect(payload.autoReadEvidence[0].fallbackUsed).toBe('search_content')
    expect(payload.autoReadEvidence[0].error).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reads the page when search content is empty and forwards the DeepSeek Fetch config', async () => {
    const urlReaderModule = require('../../../utils/url-reader')
    const readSpy = jest.spyOn(urlReaderModule, 'readUrlContent').mockResolvedValue({
      title: 'Read',
      url: 'https://example.com/empty',
      content: '',
      textContent: '本地读取正文',
      resourceType: 'page',
      fallbackUsed: 'none',
      attempts: [],
    })
    global.fetch = jest.fn(async () =>
      new Response(
        JSON.stringify({
          results: [
            { title: 'Empty', url: 'https://example.com/empty', snippet: 's', summary: '', content: '' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as typeof fetch

    const handler = new WebSearchToolHandler(
      createConfig({ deepseekFetchEnabled: true, apiKeys: { deepseek: 'ds-key' } }) as any,
    )
    await handler.handle(
      { id: 'call_empty', function: { name: 'web_search', arguments: '{}' } },
      { query: 'DeepSeek 空正文' },
      createContext() as any,
    )

    expect(readSpy).toHaveBeenCalledWith(
      'https://example.com/empty',
      expect.objectContaining({
        enableDeepseekFallback: true,
        deepseekApiKey: 'ds-key',
      }),
    )
  })

  it('carries raw auto-read image urls without relevance assessment', async () => {
    const urlReaderModule = require('../../../utils/url-reader')
    jest.spyOn(urlReaderModule, 'readUrlContent').mockResolvedValue({
      title: '带图片的页面',
      url: 'https://example.com/illustrated',
      content: '',
      textContent: '正文',
      resourceType: 'page',
      fallbackUsed: 'none',
      leadImageUrl: 'https://cdn.example.com/lead.png',
      images: [
        { url: 'https://cdn.example.com/lead.png', source: 'meta' },
        { url: 'https://cdn.example.com/second.png', alt: '第二张', source: 'article' },
      ],
      attempts: [],
    })
    global.fetch = jest.fn(async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              title: 'Illustrated',
              url: 'https://example.com/illustrated',
              snippet: 's',
              summary: '',
              content: '',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as typeof fetch

    const handler = new WebSearchToolHandler(createConfig() as any)
    const result = await handler.handle(
      { id: 'call_raw_evidence', function: { name: 'web_search', arguments: '{}' } },
      { query: '带图新闻' },
      createContext() as any,
    )

    const payload = JSON.parse(String(result.message.content))
    expect(payload).not.toHaveProperty('assessedImages')
    expect(payload.autoReadEvidence[0].images).toEqual([
      { url: 'https://cdn.example.com/lead.png' },
      { url: 'https://cdn.example.com/second.png' },
    ])
    expect(payload.summary).toContain('图片证据: https://cdn.example.com/lead.png')
  })

  it('falls back to the matching hit image url when the page itself yields no images', async () => {
    const urlReaderModule = require('../../../utils/url-reader')
    jest.spyOn(urlReaderModule, 'readUrlContent').mockResolvedValue({
      title: 'JS 重页面',
      url: 'https://example.com/app-shell',
      content: '',
      textContent: '正文',
      resourceType: 'page',
      fallbackUsed: 'none',
      attempts: [],
    })
    const webSearchModule = require('../../../utils/web-search')
    jest.spyOn(webSearchModule, 'runWebSearchParallel').mockResolvedValue({
      hits: [
        {
          title: 'JS 重页面',
          url: 'https://example.com/app-shell',
          snippet: 's',
          imageUrl: 'https://cdn.example.com/hit-cover.png',
        },
      ],
      tasks: [
        {
          task: { engine: 'deepseek', query: 'JS 重页面', queryLanguage: 'zh' },
          status: 'success',
          hits: [],
        },
      ],
    })

    const handler = new WebSearchToolHandler(createConfig() as any)
    const result = await handler.handle(
      { id: 'call_hit_cover', function: { name: 'web_search', arguments: '{}' } },
      { query: 'JS 重页面' },
      createContext() as any,
    )

    const payload = JSON.parse(String(result.message.content))
    expect(payload.autoReadEvidence[0].images).toEqual([
      { url: 'https://cdn.example.com/hit-cover.png' },
    ])
    expect(payload.summary).toContain('图片证据: https://cdn.example.com/hit-cover.png')
  })

  it('does not call upstream when the request signal is already aborted', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>
    global.fetch = fetchMock
    const controller = new AbortController()
    controller.abort()

    const handler = new WebSearchToolHandler(createConfig() as any)
    await handler.handle(
      { id: 'call_abort', function: { name: 'web_search', arguments: '{}' } },
      { query: 'DeepSeek 取消' },
      createContext(controller.signal) as any,
    )

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('skips DeepSeek for non-webpage scopes instead of treating it as a generic page engine', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>
    global.fetch = fetchMock

    const handler = new WebSearchToolHandler(
      createConfig({
        engines: ['deepseek', 'tavily'],
        engineOrder: ['deepseek', 'tavily'],
        apiKeys: { deepseek: 'ds-key', tavily: 'tv-key' },
        parallelMaxEngines: 5,
      }) as any,
    )
    const result = await handler.handle(
      { id: 'call_scope', function: { name: 'web_search', arguments: '{}' } },
      { query: '图片搜索', scope: 'image' },
      createContext() as any,
    )

    const payload = JSON.parse(String(result.message.content))
    expect(payload.engines).toEqual(['tavily'])
    expect(payload.error).toBeUndefined()
  })
})

describe('buildLanguageAwareSearchPlan', () => {
  it('includes DeepSeek in the primary Chinese plan when all five engines are active', () => {
    const plan = buildLanguageAwareSearchPlan({
      originalQuery: '国产模型 架构 对比',
      expandedQueries: [{ query: '国产模型 架构 对比', queryLanguage: 'zh' }],
      activeEngines: ['deepseek', 'tavily', 'brave', 'metaso', 'exa'],
      engineOrder: ['deepseek', 'tavily', 'brave', 'metaso', 'exa'],
    })

    expect(plan.queryPlans[0].engines).toEqual(['metaso', 'deepseek'])
    expect(plan.fallbackEngines).toEqual(['tavily', 'brave', 'exa'])
  })

  it('honors an explicit DeepSeek locale preference over the default language ranking', () => {
    const plan = buildLanguageAwareSearchPlan({
      originalQuery: 'model architecture comparison',
      expandedQueries: [{ query: 'model architecture comparison', queryLanguage: 'en' }],
      activeEngines: ['deepseek', 'tavily', 'brave', 'metaso', 'exa'],
      engineOrder: ['tavily', 'brave', 'metaso', 'exa', 'deepseek'],
      localeRouting: { en: ['deepseek', 'tavily'] },
    })

    expect(plan.queryPlans[0].engines).toEqual(['deepseek', 'tavily'])
  })

  it('prioritizes metaso for Chinese query and keeps fallback engines', () => {
    const plan = buildLanguageAwareSearchPlan({
      originalQuery: 'AI 芯片 架构 对比',
      expandedQueries: [
        { query: 'AI 芯片 架构 对比', queryLanguage: 'zh' },
        { query: 'AI chip architecture comparison English sources', queryLanguage: 'en' },
      ],
      activeEngines: ['tavily', 'brave', 'metaso'],
      engineOrder: ['tavily', 'brave', 'metaso'],
    })

    expect(plan.requiredSources).toBe(2)
    expect(plan.queryPlans[0].engines).toEqual(['metaso', 'tavily'])
    expect(plan.queryPlans[1].engines).toEqual(['tavily'])
    expect(plan.fallbackEngines).toEqual(['brave'])
  })

  it('prioritizes western engines for English query', () => {
    const plan = buildLanguageAwareSearchPlan({
      originalQuery: 'OpenAI model release notes',
      expandedQueries: [{ query: 'OpenAI model release notes', queryLanguage: 'en' }],
      activeEngines: ['metaso', 'brave', 'tavily'],
      engineOrder: ['metaso', 'brave', 'tavily'],
    })

    expect(plan.requiredSources).toBe(2)
    expect(plan.queryPlans[0].engines).toEqual(['tavily', 'brave'])
  })

  it('requires three sources for high-risk query when possible', () => {
    const plan = buildLanguageAwareSearchPlan({
      originalQuery: 'today stock market outlook',
      expandedQueries: [{ query: 'today stock market outlook', queryLanguage: 'en' }],
      activeEngines: ['metaso', 'brave', 'tavily'],
      engineOrder: ['tavily', 'brave', 'metaso'],
    })

    expect(plan.requiredSources).toBe(3)
    expect(plan.queryPlans[0].engines).toEqual(['tavily', 'brave', 'metaso'])
  })

  it('applies minSources override to reduce required sources', () => {
    const plan = buildLanguageAwareSearchPlan({
      originalQuery: 'today stock market outlook',
      expandedQueries: [{ query: 'today stock market outlook', queryLanguage: 'en' }],
      activeEngines: ['metaso', 'brave', 'tavily'],
      engineOrder: ['tavily', 'brave', 'metaso'],
      minSources: 1,
    })

    expect(plan.requiredSources).toBe(1)
    expect(plan.queryPlans[0].engines).toEqual(['tavily'])
  })

  it('applies localeRouting override for Chinese queries', () => {
    const plan = buildLanguageAwareSearchPlan({
      originalQuery: '国产模型 对比',
      expandedQueries: [{ query: '国产模型 对比', queryLanguage: 'zh' }],
      activeEngines: ['metaso', 'brave', 'tavily'],
      engineOrder: ['tavily', 'brave', 'metaso'],
      localeRouting: {
        zh: ['brave', 'tavily', 'metaso'],
      },
    })

    expect(plan.queryPlans[0].engines).toEqual(['brave', 'tavily'])
  })
})

describe('evaluateSearchEscalation', () => {
  const plan = {
    queryPlans: [
      { query: 'q', queryLanguage: 'zh' as const, engines: ['metaso', 'tavily'] },
    ],
    fallbackEngines: ['brave'],
    primaryLanguage: 'zh' as const,
    highRisk: false,
    requiredSources: 2,
    conflictEscalation: 'auto' as const,
  }

  it('escalates when successful sources are insufficient', () => {
    const result: WebSearchParallelResult = {
      hits: [],
      tasks: [
        {
          task: {
            engine: 'metaso',
            query: 'q',
            queryLanguage: 'zh',
            queryIndex: 0,
            taskIndex: 0,
          },
          status: 'success',
          hits: [],
        },
      ],
    }

    const decision = evaluateSearchEscalation(plan, result)
    expect(decision.escalate).toBe(true)
    expect(decision.reason).toBe('insufficient_sources')
  })

  it('escalates when overlap between engines is too low', () => {
    const result: WebSearchParallelResult = {
      hits: [
        { title: 'A', url: 'https://a.test', sourceEngines: ['metaso'] },
        { title: 'B', url: 'https://b.test', sourceEngines: ['tavily'] },
      ],
      tasks: [
        {
          task: {
            engine: 'metaso',
            query: 'q',
            queryLanguage: 'zh',
            queryIndex: 0,
            taskIndex: 0,
          },
          status: 'success',
          hits: [],
        },
        {
          task: {
            engine: 'tavily',
            query: 'q',
            queryLanguage: 'zh',
            queryIndex: 0,
            taskIndex: 1,
          },
          status: 'success',
          hits: [],
        },
      ],
    }

    const decision = evaluateSearchEscalation(plan, result)
    expect(decision.escalate).toBe(true)
    expect(decision.reason).toBe('low_overlap')
  })

  it('does not escalate on low overlap when conflict escalation is off', () => {
    const result: WebSearchParallelResult = {
      hits: [
        { title: 'A', url: 'https://a.test', sourceEngines: ['metaso'] },
        { title: 'B', url: 'https://b.test', sourceEngines: ['tavily'] },
      ],
      tasks: [
        {
          task: {
            engine: 'metaso',
            query: 'q',
            queryLanguage: 'zh',
            queryIndex: 0,
            taskIndex: 0,
          },
          status: 'success',
          hits: [],
        },
        {
          task: {
            engine: 'tavily',
            query: 'q',
            queryLanguage: 'zh',
            queryIndex: 0,
            taskIndex: 1,
          },
          status: 'success',
          hits: [],
        },
      ],
    }

    const decision = evaluateSearchEscalation(
      {
        ...plan,
        conflictEscalation: 'off',
      },
      result,
    )
    expect(decision.escalate).toBe(false)
    expect(decision.reason).toBe(null)
  })
})
