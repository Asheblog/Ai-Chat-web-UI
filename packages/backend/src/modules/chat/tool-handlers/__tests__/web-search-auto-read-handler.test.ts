import type { WebSearchHit, WebSearchParallelResult } from '../../../../utils/web-search'
import { WebSearchToolHandler } from '../web-search-handler'

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
  engines: ['tavily'],
  engineOrder: ['tavily'],
  apiKeys: { tavily: 'tv-key' },
  resultLimit: 5,
  domains: [],
  scope: 'webpage',
  autoBilingual: false,
  autoReadAfterSearch: true,
  autoReadTopK: 2,
  parallelMaxEngines: 1,
  ...overrides,
})

const searchResult = (hits: WebSearchHit[]): WebSearchParallelResult => ({
  hits: hits.map((hit, index) => ({ engine: 'tavily', rank: index + 1, sourceEngines: ['tavily'], ...hit })),
  tasks: [
    {
      task: { engine: 'tavily', query: 'q', queryLanguage: 'zh', queryIndex: 0, taskIndex: 0 },
      status: 'success',
      hits,
    },
  ],
})

const pageResult = (url: string, text: string) => ({
  title: `Title ${url}`,
  url,
  content: text,
  textContent: text,
  resourceType: 'page' as const,
  fallbackUsed: 'none' as const,
  attempts: [],
})

describe('WebSearchToolHandler auto-read batch', () => {
  const urlReaderModule = require('../../../../utils/url-reader')
  const webSearchModule = require('../../../../utils/web-search')
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  test('forwards the complete url reader config and the current-purpose freshness', async () => {
    jest.spyOn(webSearchModule, 'runWebSearchParallel').mockResolvedValue(
      searchResult([{ title: 'A', url: 'https://example.com/a', snippet: 's' }]),
    )
    const readSpy = jest
      .spyOn(urlReaderModule, 'readUrlContent')
      .mockResolvedValue(pageResult('https://example.com/a', '页面正文'))

    const handler = new WebSearchToolHandler(
      createConfig({
        deepseekFetchEnabled: true,
        apiKeys: { tavily: 'tv-key', deepseek: 'ds-key' },
        urlReader: {
          enableDeepseekFallback: true,
          deepseekApiKey: 'ds-key',
          maxBodyBytes: 4096,
          enableBrowser: true,
          browserExecutablePath: 'C:/chromium/chrome.exe',
          renderWaitMs: 900,
        },
      }) as any,
    )
    await handler.handle(
      { id: 'call_reader_config', function: { name: 'web_search', arguments: '{}' } },
      { query: '最新 行情' },
      createContext() as any,
    )

    expect(readSpy).toHaveBeenCalledWith(
      'https://example.com/a',
      expect.objectContaining({
        enableBrowser: true,
        browserExecutablePath: 'C:/chromium/chrome.exe',
        renderWaitMs: 900,
        maxBodyBytes: 4096,
        enableDeepseekFallback: true,
        deepseekApiKey: 'ds-key',
        freshness: 'current',
        purpose: 'current',
      }),
    )
  })

  test('ends the whole batch at the batch deadline instead of waiting on every url', async () => {
    jest.spyOn(webSearchModule, 'runWebSearchParallel').mockResolvedValue(
      searchResult(
        [1, 2, 3].map((n) => ({ title: `P${n}`, url: `https://example.com/slow${n}`, snippet: 's' })),
      ),
    )
    jest.spyOn(urlReaderModule, 'readUrlContent').mockImplementation(
      (_url: string, options: any) =>
        new Promise((resolve) => {
          const finish = () => resolve({ ...pageResult('https://example.com/slow', ''), error: 'Request timeout', errorCode: 'TIMEOUT' })
          if (options?.signal?.aborted) return finish()
          options?.signal?.addEventListener('abort', finish, { once: true })
        }),
    )

    const handler = new WebSearchToolHandler(
      // 生产下界就是 3000ms；这里用下界验证批次 deadline，而不是测试用的毫秒级 seam
      createConfig({ autoReadTimeoutMs: 15000, autoReadBatchTimeoutMs: 3000 }) as any,
    )
    const startedAt = Date.now()
    const result = await handler.handle(
      { id: 'call_batch_deadline', function: { name: 'web_search', arguments: '{}' } },
      { query: '慢站点' },
      createContext() as any,
    )

    const payload = JSON.parse(String(result.message.content))
    expect(Date.now() - startedAt).toBeLessThan(5000)
    expect(payload.autoReadStats.deadlineExceeded).toBe(true)
    expect(payload.autoReadStats.batchTimeoutMs).toBe(3000)
    expect(payload.autoReadEvidence.every((item: any) => item.errorCode === 'TIMEOUT')).toBe(true)
  })

  test('replaces a failed candidate with the next ranked result and keeps the original error', async () => {
    jest.spyOn(webSearchModule, 'runWebSearchParallel').mockResolvedValue(
      searchResult([
        { title: 'Blocked', url: 'https://example.com/blocked', snippet: 's' },
        { title: 'B', url: 'https://example.com/b', snippet: 's' },
        { title: 'C', url: 'https://example.com/c', snippet: 's' },
      ]),
    )
    jest.spyOn(urlReaderModule, 'readUrlContent').mockImplementation(async (url: string) => {
      if (url.endsWith('/blocked')) {
        return { ...pageResult(url, ''), error: 'HTTP 403 for blocked', errorCode: 'HTTP_403', httpStatus: 403 }
      }
      return pageResult(url, `body of ${url}`)
    })

    const handler = new WebSearchToolHandler(createConfig({ autoReadParallelism: 1 }) as any)
    const result = await handler.handle(
      { id: 'call_replace', function: { name: 'web_search', arguments: '{}' } },
      { query: '替补' },
      createContext() as any,
    )

    const payload = JSON.parse(String(result.message.content))
    expect(payload.autoReadEvidence).toHaveLength(3)
    // 失败候选保留原始错误；命中的短摘要只作为摘要证据，不冒充正文
    expect(payload.autoReadEvidence[0]).toMatchObject({
      url: 'https://example.com/blocked',
      errorCode: 'HTTP_403',
      error: 'HTTP 403 for blocked',
      evidenceKind: 'summary',
      fallbackUsed: 'search_snippet',
    })
    expect(payload.autoReadEvidence[1].evidenceKind).toBe('article')
    expect(payload.autoReadEvidence[2].evidenceKind).toBe('article')
    expect(payload.autoReadStats.article).toBe(2)
    expect(payload.autoReadStats.summary).toBe(1)
    expect(payload.autoReadStats.failed).toBe(0)
  })

  test('does not reuse a search summary as article content and keeps its provider', async () => {
    jest.spyOn(webSearchModule, 'runWebSearchParallel').mockResolvedValue(
      searchResult([
        {
          title: 'Summary only',
          url: 'https://example.com/summary',
          snippet: 'exa highlight',
          content: '这是搜索结果摘要',
          contentKind: 'summary',
          contentSource: 'exa',
        },
      ]),
    )
    const readSpy = jest
      .spyOn(urlReaderModule, 'readUrlContent')
      .mockResolvedValue({ ...pageResult('https://example.com/summary', ''), error: 'Empty content', errorCode: 'EMPTY_CONTENT' })

    const handler = new WebSearchToolHandler(createConfig() as any)
    const result = await handler.handle(
      { id: 'call_summary', function: { name: 'web_search', arguments: '{}' } },
      { query: '摘要不能当全文' },
      createContext() as any,
    )

    const payload = JSON.parse(String(result.message.content))
    expect(readSpy).toHaveBeenCalledTimes(1)
    expect(payload.autoReadEvidence[0]).toMatchObject({
      evidenceKind: 'summary',
      fallbackUsed: 'search_snippet',
      contentSource: 'exa',
      error: 'Empty content',
    })
    expect(payload.autoReadStats.article).toBe(0)
    expect(payload.autoReadStats.summary).toBe(1)
  })

  test('reuses article-kind search content with its provider and skips the page fetch', async () => {
    jest.spyOn(webSearchModule, 'runWebSearchParallel').mockResolvedValue(
      searchResult([
        {
          title: 'Tavily body',
          url: 'https://example.com/tavily',
          snippet: 'short chunk',
          content: 'Tavily 搜索返回的正文'.repeat(20),
          contentKind: 'article',
          contentSource: 'tavily',
        },
      ]),
    )
    const readSpy = jest.spyOn(urlReaderModule, 'readUrlContent')

    const handler = new WebSearchToolHandler(createConfig() as any)
    const context = createContext()
    const result = await handler.handle(
      { id: 'call_reuse', function: { name: 'web_search', arguments: '{}' } },
      { query: '复用正文' },
      context as any,
    )

    const payload = JSON.parse(String(result.message.content))
    expect(readSpy).not.toHaveBeenCalled()
    expect(payload.autoReadEvidence[0]).toMatchObject({
      evidenceKind: 'article',
      fallbackUsed: 'search_content',
      contentSource: 'tavily',
    })
    expect(payload.autoReadStats.article).toBe(1)
    const reuseEvent = (context.sendToolEvent as jest.Mock).mock.calls
      .map((call) => call[0])
      .find((event) => event.stage === 'result' && event.url === 'https://example.com/tavily')
    expect(reuseEvent?.details?.contentSource).toBe('tavily')
  })

  test('clamps a below-minimum configured batch deadline to the production bound', async () => {
    jest.spyOn(webSearchModule, 'runWebSearchParallel').mockResolvedValue(
      searchResult([{ title: 'A', url: 'https://example.com/a', snippet: 's' }]),
    )
    jest.spyOn(urlReaderModule, 'readUrlContent').mockResolvedValue(pageResult('https://example.com/a', 'body'))

    const handler = new WebSearchToolHandler(createConfig({ autoReadBatchTimeoutMs: 500 }) as any)
    const result = await handler.handle(
      { id: 'call_min_bound', function: { name: 'web_search', arguments: '{}' } },
      { query: '下限' },
      createContext() as any,
    )

    const payload = JSON.parse(String(result.message.content))
    expect(payload.autoReadStats.batchTimeoutMs).toBe(3000)
  })

  test('asks body-capable engines for content when auto-read is on and raw content is off', async () => {
    const requestBodies: any[] = []
    global.fetch = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body || '{}')))
      return new Response(
        JSON.stringify({
          results: [
            {
              title: 'Tavily body',
              url: 'https://example.com/tavily',
              content: 'short chunk',
              raw_content: 'Tavily 搜索返回的正文'.repeat(20),
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof fetch
    const readSpy = jest.spyOn(urlReaderModule, 'readUrlContent')

    const handler = new WebSearchToolHandler(
      createConfig({ engines: ['tavily'], engineOrder: ['tavily'], includeRawContent: false, autoReadTopK: 2 }) as any,
    )
    const result = await handler.handle(
      { id: 'call_body_capability', function: { name: 'web_search', arguments: '{}' } },
      { query: '需要正文' },
      createContext() as any,
    )

    const payload = JSON.parse(String(result.message.content))
    expect(requestBodies[0].include_raw_content).toBe('markdown')
    expect(readSpy).not.toHaveBeenCalled()
    expect(payload.autoReadEvidence[0]).toMatchObject({
      evidenceKind: 'article',
      fallbackUsed: 'search_content',
      contentSource: 'tavily',
    })
  })

  test('asks the escalation engine for content too', async () => {
    const bodiesByHost: Record<string, any[]> = { tavily: [], metaso: [], exa: [] }
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('api.tavily.com')) {
        bodiesByHost.tavily.push(JSON.parse(String(init?.body || '{}')))
        return new Response('upstream error', { status: 500 })
      }
      if (url.includes('metaso.cn')) {
        bodiesByHost.metaso.push(JSON.parse(String(init?.body || '{}')))
        return new Response('upstream error', { status: 500 })
      }
      bodiesByHost.exa.push(JSON.parse(String(init?.body || '{}')))
      return new Response(
        JSON.stringify({
          results: [{ title: 'Exa body', url: 'https://example.com/exa', text: 'Exa 正文'.repeat(30) }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof fetch
    jest.spyOn(urlReaderModule, 'readUrlContent')

    const handler = new WebSearchToolHandler(
      createConfig({
        engines: ['tavily', 'metaso', 'exa'],
        engineOrder: ['tavily', 'metaso', 'exa'],
        apiKeys: { tavily: 'tv', metaso: 'mt', exa: 'ex' },
        parallelMaxEngines: 5,
        includeRawContent: false,
        autoReadTopK: 2,
        conflictEscalation: 'auto',
      }) as any,
    )
    const result = await handler.handle(
      { id: 'call_escalation_body', function: { name: 'web_search', arguments: '{}' } },
      { query: 'q' },
      createContext() as any,
    )

    const payload = JSON.parse(String(result.message.content))
    // 初始轮：Tavily 已被要求返回正文
    expect(bodiesByHost.tavily[0].include_raw_content).toBe('markdown')
    // 升级轮：Exa 同样被要求返回正文
    expect(payload.escalation.triggered).toBe(true)
    expect(bodiesByHost.exa[0].contents.text).toEqual({ maxCharacters: 4000 })
  })

  test('keeps body capability off when the evidence target is zero', async () => {
    const bodiesByHost: Record<string, any[]> = { tavily: [], deepseek: [] }
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'))
      if (String(input).includes('deepseek')) {
        bodiesByHost.deepseek.push(body)
      } else {
        bodiesByHost.tavily.push(body)
      }
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch
    jest.spyOn(urlReaderModule, 'readUrlContent')

    const tavilyHandler = new WebSearchToolHandler(
      createConfig({ engines: ['tavily'], engineOrder: ['tavily'], includeRawContent: false, autoReadTopK: 0 }) as any,
    )
    await tavilyHandler.handle(
      { id: 'call_body_off', function: { name: 'web_search', arguments: '{}' } },
      { query: '不要正文' },
      createContext() as any,
    )

    // DeepSeek 的 need_content 与 Tavily/Exa/Metaso 同条件：topK=0 时也不索取正文
    const deepseekHandler = new WebSearchToolHandler(
      createConfig({
        engines: ['deepseek'],
        engineOrder: ['deepseek'],
        apiKeys: { deepseek: 'ds-key' },
        includeRawContent: false,
        autoReadTopK: 0,
        parallelMaxEngines: 1,
      }) as any,
    )
    await deepseekHandler.handle(
      { id: 'call_body_off_ds', function: { name: 'web_search', arguments: '{}' } },
      { query: '不要正文' },
      createContext() as any,
    )

    expect(bodiesByHost.tavily[0]).not.toHaveProperty('include_raw_content')
    expect(bodiesByHost.tavily[0].chunks_per_source).toBe(3)
    expect(bodiesByHost.deepseek[0].need_content).toBe(false)
  })

  test('keeps auto-read off when the evidence target is zero', async () => {
    jest.spyOn(webSearchModule, 'runWebSearchParallel').mockResolvedValue(
      searchResult([{ title: 'A', url: 'https://example.com/a', snippet: 's' }]),
    )
    const readSpy = jest.spyOn(urlReaderModule, 'readUrlContent')

    const handler = new WebSearchToolHandler(createConfig({ autoReadTopK: 0 }) as any)
    const result = await handler.handle(
      { id: 'call_zero', function: { name: 'web_search', arguments: '{}' } },
      { query: '不读正文' },
      createContext() as any,
    )

    const payload = JSON.parse(String(result.message.content))
    expect(readSpy).not.toHaveBeenCalled()
    expect(payload.autoReadEvidence).toEqual([])
    expect(payload.autoReadStats.requested).toBe(0)
  })

  test('keeps one tool operation when a candidate fails and another replaces it', async () => {
    jest.spyOn(webSearchModule, 'runWebSearchParallel').mockResolvedValue(
      searchResult([
        { title: 'Blocked', url: 'https://example.com/blocked', snippet: 's' },
        { title: 'B', url: 'https://example.com/b', snippet: 's' },
      ]),
    )
    jest.spyOn(urlReaderModule, 'readUrlContent').mockImplementation(async (url: string) => {
      if (url.endsWith('/blocked')) {
        return { ...pageResult(url, ''), error: 'HTTP 403 for blocked', errorCode: 'HTTP_403', httpStatus: 403 }
      }
      return pageResult(url, 'body')
    })

    const handler = new WebSearchToolHandler(createConfig({ autoReadParallelism: 1 }) as any)
    const context = createContext()
    await handler.handle(
      { id: 'call_single_op', function: { name: 'web_search', arguments: '{}' } },
      { query: '一次操作' },
      context as any,
    )

    const events = (context.sendToolEvent as jest.Mock).mock.calls.map((call) => call[0])
    // 只有一条顶层 web_search 结果事件；内部读取失败不单独汇报成搜索失败
    const operationEvents = events.filter((event) => event.tool === 'web_search' && event.id === 'call_single_op')
    expect(operationEvents.filter((event) => event.stage === 'result')).toHaveLength(1)
    expect(operationEvents.filter((event) => event.stage === 'error')).toHaveLength(0)
  })

  test('keeps the provider truncation marker when reusing a capped body', async () => {
    jest.spyOn(webSearchModule, 'runWebSearchParallel').mockResolvedValue(
      searchResult([
        {
          title: 'Exa capped',
          url: 'https://example.com/exa-capped',
          snippet: 'short',
          content: 'Exa 正文'.repeat(60),
          contentKind: 'article',
          contentSource: 'exa',
          contentMetadata: { provider: 'exa', kind: 'article', chars: 360, truncated: true, maxChars: 4000 },
        },
      ]),
    )
    const readSpy = jest.spyOn(urlReaderModule, 'readUrlContent')

    const handler = new WebSearchToolHandler(createConfig() as any)
    const result = await handler.handle(
      { id: 'call_truncated', function: { name: 'web_search', arguments: '{}' } },
      { query: '截断标记' },
      createContext() as any,
    )

    const payload = JSON.parse(String(result.message.content))
    expect(readSpy).not.toHaveBeenCalled()
    expect(payload.autoReadEvidence[0]).toMatchObject({
      evidenceKind: 'article',
      fallbackUsed: 'search_content',
      truncated: true,
    })
    expect(payload.autoReadEvidence[0].fetchedAt).toBeUndefined()
    expect(payload.summary).toContain('截断')
  })

  test('never reports a removed cache fallback as an evidence source', async () => {
    jest.spyOn(webSearchModule, 'runWebSearchParallel').mockResolvedValue(
      searchResult([{ title: 'Cache', url: 'https://example.com/cache', snippet: 's' }]),
    )
    jest.spyOn(urlReaderModule, 'readUrlContent').mockResolvedValue({
      ...pageResult('https://example.com/cache', 'cached body'),
      fallbackUsed: 'google_cache' as any,
    })

    const handler = new WebSearchToolHandler(createConfig() as any)
    const result = await handler.handle(
      { id: 'call_cache', function: { name: 'web_search', arguments: '{}' } },
      { query: '缓存回退' },
      createContext() as any,
    )

    const payload = JSON.parse(String(result.message.content))
    expect(payload.autoReadEvidence[0].evidenceKind).toBe('article')
    expect(payload.autoReadEvidence[0].fallbackUsed).toBe('none')
  })

  test('keeps structured content as its own evidence kind instead of calling it an article', async () => {
    jest.spyOn(webSearchModule, 'runWebSearchParallel').mockResolvedValue(
      searchResult([{ title: 'Quote', url: 'https://example.com/quote', snippet: 's' }]),
    )
    jest.spyOn(urlReaderModule, 'readUrlContent').mockResolvedValue({
      ...pageResult('https://example.com/quote', '开 10.5 高 10.9 低 10.1 收 10.7'),
      contentKind: 'structured',
    })

    const handler = new WebSearchToolHandler(createConfig() as any)
    const result = await handler.handle(
      { id: 'call_structured', function: { name: 'web_search', arguments: '{}' } },
      { query: '行情' },
      createContext() as any,
    )

    const payload = JSON.parse(String(result.message.content))
    expect(payload.autoReadEvidence[0].evidenceKind).toBe('structured')
    expect(payload.autoReadStats.structured).toBe(1)
    expect(payload.autoReadStats.article).toBe(0)
  })
})
