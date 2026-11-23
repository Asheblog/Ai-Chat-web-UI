jest.mock('../../../../utils/remote-image-reader', () => ({
  readRemoteImages: jest.fn(),
}))

import { WebSearchToolHandler } from '../web-search-handler'
import { resetWebSearchBackoff } from '../web-search-backoff'
import { clearSearchEvidenceStore } from '../web-search-evidence-store'

const urlReaderModule = require('../../../../utils/url-reader')
const imageReaderModule = require('../../../../utils/remote-image-reader')

const createConfig = (overrides: Record<string, unknown> = {}) => ({
  enabled: true,
  engines: ['tavily'],
  apiKeys: { tavily: 'tv-key' },
  resultLimit: 5,
  domains: [],
  scope: 'webpage',
  autoReadAfterSearch: true,
  autoReadTopK: 0,
  parallelMaxEngines: 1,
  autoBilingualMode: 'off',
  ...overrides,
})

const createContext = (overrides: Record<string, unknown> = {}) => ({
  sessionId: 1,
  actorIdentifier: 'user:test',
  actorUserId: 1,
  messageId: 11,
  connectionId: 101,
  emitReasoning: jest.fn(),
  sendToolEvent: jest.fn(),
  ...overrides,
})

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

const runSearch = async (
  handler: WebSearchToolHandler,
  args: Record<string, unknown>,
  context: Record<string, unknown>,
  callId = 'call_args',
) => {
  const result = await handler.handle(
    { id: callId, function: { name: 'web_search', arguments: '{}' } },
    args,
    context as any,
  )
  return { result, payload: JSON.parse(String(result.message.content)) }
}

describe('web_search 结构化参数：domains / time_range', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    resetWebSearchBackoff()
    clearSearchEvidenceStore()
  })

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  test('指定来源与配置白名单无交集时不发请求，并明确区分原因', async () => {
    const fetchMock = jest.fn()
    global.fetch = fetchMock as any

    const { payload } = await runSearch(
      new WebSearchToolHandler(createConfig({ domains: ['reuters.com'] }) as any),
      { query: 'q', domains: ['https://www.bbc.com/news'] },
      createContext(),
    )

    expect(fetchMock).not.toHaveBeenCalled()
    expect(payload.retrievalOutcome).toMatchObject({
      status: 'empty',
      reason: 'domains_outside_whitelist',
      retryable: false,
    })
    expect(payload.retrievalOutcome.restriction).toMatchObject({ restricted: true, requested: ['www.bbc.com'], effective: [] })
    expect(payload.evidenceSummary).toMatchObject({ restricted: true, restrictedTo: [] })
  })

  test('明确提供 domains 但全部无法归一为有效主机时返回 invalid_request，不降级为全网', async () => {
    const fetchMock = jest.fn()
    global.fetch = fetchMock as any

    const { payload } = await runSearch(
      new WebSearchToolHandler(createConfig() as any),
      { query: 'q', domains: ['not a domain', 'http://', ''] },
      createContext(),
    )

    expect(fetchMock).not.toHaveBeenCalled()
    expect(payload.errorCode).toBe('INVALID_REQUEST')
    expect(payload.retrievalOutcome).toMatchObject({ status: 'failed', reason: 'invalid_request' })
    expect(String(payload.error)).toMatch(/domains/)
  })

  test('受限来源零命中与通用搜索无结果可区分', async () => {
    global.fetch = jest.fn(async () => jsonResponse({ results: [] })) as any

    const { payload } = await runSearch(
      new WebSearchToolHandler(createConfig({ domains: ['reuters.com'] }) as any),
      { query: 'q' },
      createContext(),
    )

    expect(payload.retrievalOutcome).toMatchObject({
      status: 'empty',
      reason: 'no_results_in_restricted_sources',
    })
    expect(payload.retrievalOutcome.restriction).toMatchObject({
      restricted: true,
      effective: ['reuters.com'],
    })
    expect(payload.evidenceSummary).toMatchObject({ restricted: true, restrictedTo: ['reuters.com'] })
  })

  test('时间窗倒置显式返回 invalid_request，不悄悄反转', async () => {
    const fetchMock = jest.fn()
    global.fetch = fetchMock as any

    const { payload } = await runSearch(
      new WebSearchToolHandler(createConfig() as any),
      { query: 'q', time_range: { start: '2026-02-01', end: '2026-01-01' } },
      createContext(),
    )

    expect(fetchMock).not.toHaveBeenCalled()
    expect(payload.errorCode).toBe('INVALID_REQUEST')
    expect(payload.retrievalOutcome).toMatchObject({ status: 'failed', reason: 'invalid_request' })
    expect(String(payload.error)).toMatch(/time_range/)
  })

  test('无法解析的时间窗同样返回 invalid_request', async () => {
    const fetchMock = jest.fn()
    global.fetch = fetchMock as any

    const { payload } = await runSearch(
      new WebSearchToolHandler(createConfig() as any),
      { query: 'q', time_range: { start: 'next week' } },
      createContext(),
    )

    expect(fetchMock).not.toHaveBeenCalled()
    expect(payload.retrievalOutcome).toMatchObject({ status: 'failed', reason: 'invalid_request' })
  })

  test('时间窗下发到引擎并按可解析日期本地过滤，未标日期保留为未核实', async () => {
    let requestBody: any
    global.fetch = jest.fn(async (_input: any, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body || '{}'))
      return jsonResponse({
        results: [
          { title: 'In range', url: 'https://news.example.com/in', published_date: '2026-01-15T00:00:00Z' },
          { title: 'Too old', url: 'https://news.example.com/old', published_date: '2025-01-01' },
          { title: 'Undated', url: 'https://news.example.com/undated' },
        ],
      })
    }) as any

    const { payload } = await runSearch(
      new WebSearchToolHandler(createConfig() as any),
      { query: 'news', time_range: { start: '2026-01-01', end: '2026-01-31' } },
      createContext(),
    )

    expect(requestBody.start_date).toBe('2026-01-01')
    expect(requestBody.end_date).toBe('2026-01-31')
    expect(payload.hits).toHaveLength(2)
    expect(payload.hits[0]).toMatchObject({ url: 'https://news.example.com/in', timeRangeStatus: 'in_range' })
    expect(payload.hits[1]).toMatchObject({ url: 'https://news.example.com/undated', timeRangeStatus: 'undated' })
    expect(payload.retrievalOutcome.timeRange).toMatchObject({
      start: '2026-01-01',
      end: '2026-01-31',
      verified: 1,
      undated: 1,
    })
    expect(payload.summary).toContain('未核实')
  })

  test('常规调用不带结构化参数时请求形状不变', async () => {
    let requestBody: any
    global.fetch = jest.fn(async (_input: any, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body || '{}'))
      return jsonResponse({ results: [] })
    }) as any

    await runSearch(new WebSearchToolHandler(createConfig() as any), { query: 'q' }, createContext())

    expect(requestBody).not.toHaveProperty('start_date')
    expect(requestBody).not.toHaveProperty('end_date')
    expect(requestBody).not.toHaveProperty('include_domains')
  })
})

describe('web_search 来源交集：父域/子域与空数组', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    resetWebSearchBackoff()
    clearSearchEvidenceStore()
  })

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  const captureFetch = (holder: { body?: any }) =>
    jest.fn(async (_input: any, init?: RequestInit) => {
      holder.body = JSON.parse(String(init?.body || '{}'))
      return jsonResponse({ results: [] })
    }) as any

  test('父域请求 + 子域白名单：交集取白名单子域', async () => {
    const holder: { body?: any } = {}
    global.fetch = captureFetch(holder)

    const { payload } = await runSearch(
      new WebSearchToolHandler(createConfig({ domains: ['news.example.com'] }) as any),
      { query: 'q', domains: ['example.com'] },
      createContext(),
    )

    expect(holder.body.include_domains).toEqual(['news.example.com'])
    expect(payload.request).toMatchObject({
      domains: ['example.com'],
      effectiveDomains: ['news.example.com'],
      restricted: true,
    })
    expect(payload.retrievalOutcome.restriction).toMatchObject({
      restricted: true,
      requested: ['example.com'],
      effective: ['news.example.com'],
    })
  })

  test('子域请求 + 父域白名单：交集保留请求子域；domains 空数组仍视为未限定', async () => {
    const holder: { body?: any } = {}
    global.fetch = captureFetch(holder)

    const { payload } = await runSearch(
      new WebSearchToolHandler(createConfig({ domains: ['example.com'] }) as any),
      { query: 'q', domains: ['news.example.com'] },
      createContext(),
    )

    expect(holder.body.include_domains).toEqual(['news.example.com'])
    expect(payload.request.effectiveDomains).toEqual(['news.example.com'])

    const emptyHolder: { body?: any } = {}
    global.fetch = captureFetch(emptyHolder)
    const { payload: emptyPayload } = await runSearch(
      new WebSearchToolHandler(createConfig({ domains: [] }) as any),
      { query: 'q', domains: [] },
      createContext(),
      'call_empty_domains',
    )

    expect(emptyHolder.body).not.toHaveProperty('include_domains')
    expect(emptyPayload.request).toMatchObject({ domains: [], effectiveDomains: [], restricted: false })
    expect(emptyPayload.retrievalOutcome.restriction.restricted).toBe(false)
  })
})

describe('web_search 新闻日期与 provenance', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    resetWebSearchBackoff()
    clearSearchEvidenceStore()
  })

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  test('命中保留引擎声明的发布方与发布时间，缺失就不补', async () => {
    jest.spyOn(urlReaderModule, 'readUrlContent').mockResolvedValue({
      title: 'News',
      url: 'https://news.example.com/dated',
      content: '',
      textContent: '新闻正文',
      resourceType: 'page',
      fallbackUsed: 'none',
      attempts: [],
    })
    global.fetch = jest.fn(async (_input: any, init?: RequestInit) => {
      // 第一次是新闻查询，第二次是自动阅读的命中
      return jsonResponse({
        web: {
          results: [
            {
              title: 'Dated',
              url: 'https://news.example.com/dated',
              description: 'd',
              page_age: '2026-01-15T00:00:00Z',
              profile: { name: 'Example News' },
            },
            { title: 'Undated', url: 'https://news.example.com/undated', description: 'd' },
          ],
        },
      })
    }) as any

    const { payload } = await runSearch(
      new WebSearchToolHandler(
        createConfig({ engines: ['brave'], apiKeys: { brave: 'br-key' }, autoReadTopK: 2 }) as any,
      ),
      { query: 'news' },
      createContext(),
    )

    expect(payload.hits[0]).toMatchObject({
      url: 'https://news.example.com/dated',
      publishedDate: '2026-01-15T00:00:00Z',
      siteName: 'Example News',
    })
    expect(payload.hits[1].publishedDate).toBeUndefined()
    expect(payload.hits[1].siteName).toBeUndefined()
    expect(payload.autoReadEvidence[0]).toMatchObject({
      url: 'https://news.example.com/dated',
      publishedDate: '2026-01-15T00:00:00Z',
      siteName: 'Example News',
    })
  })
})

describe('web_search 图片默认值', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    resetWebSearchBackoff()
    clearSearchEvidenceStore()
    imageReaderModule.readRemoteImages.mockReset()
  })

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  const seedIllustratedPage = () => {
    jest.spyOn(urlReaderModule, 'readUrlContent').mockResolvedValue({
      title: '带图新闻',
      url: 'https://example.com/illustrated',
      content: '',
      textContent: '正文内容',
      resourceType: 'page',
      fallbackUsed: 'none',
      leadImageUrl: 'https://cdn.example.com/lead.png',
      images: [{ url: 'https://cdn.example.com/lead.png', source: 'meta' }],
      attempts: [],
    })
    global.fetch = jest.fn(async () =>
      jsonResponse({ results: [{ title: 'Illustrated', url: 'https://example.com/illustrated', snippet: 's' }] })) as any
  }

  test('未显式请求时不下载二进制图片，图片链接仍保留', async () => {
    seedIllustratedPage()

    const { result, payload } = await runSearch(
      new WebSearchToolHandler(createConfig({ autoReadTopK: 2 }) as any),
      { query: '带图新闻' },
      createContext({ provider: 'openai_responses', modelCapabilities: { vision: true } }),
    )

    expect(imageReaderModule.readRemoteImages).not.toHaveBeenCalled()
    expect(result.message).not.toHaveProperty('imageEvidence')
    expect(payload.autoReadEvidence[0].images).toEqual([{ url: 'https://cdn.example.com/lead.png' }])
    expect(payload.summary).toContain('图片证据: https://cdn.example.com/lead.png')
  })

  test('include_images=true 时才回传二进制图片，URL 不受影响', async () => {
    seedIllustratedPage()
    imageReaderModule.readRemoteImages.mockResolvedValue([
      { requestedUrl: 'https://cdn.example.com/lead.png', mime: 'image/png', data: 'ZmFrZQ==' },
    ])

    const { result, payload } = await runSearch(
      new WebSearchToolHandler(createConfig({ autoReadTopK: 2 }) as any),
      { query: '带图新闻', include_images: true },
      createContext({ provider: 'openai_responses', modelCapabilities: { vision: true } }),
    )

    expect(imageReaderModule.readRemoteImages).toHaveBeenCalledTimes(1)
    expect(result.message).toMatchObject({
      imageEvidence: {
        kind: 'page',
        images: [
          expect.objectContaining({
            imageUrl: 'https://cdn.example.com/lead.png',
            dataUrl: 'data:image/png;base64,ZmFrZQ==',
            sourceUrl: 'https://example.com/illustrated',
          }),
        ],
      },
    })
    expect(payload.hits[0].url).toBe('https://example.com/illustrated')
  })

  test('scope=image 沿用按 URL 返回，不新增默认下载开销', async () => {
    global.fetch = jest.fn(async () => jsonResponse({ images: ['https://cdn.example.com/x.png'] })) as any

    const { result, payload } = await runSearch(
      new WebSearchToolHandler(createConfig() as any),
      { query: '图片', scope: 'image' },
      createContext({ provider: 'openai_responses', modelCapabilities: { vision: true } }),
    )

    expect(imageReaderModule.readRemoteImages).not.toHaveBeenCalled()
    expect(result.message).not.toHaveProperty('imageEvidence')
    expect(payload.hits[0]).toMatchObject({
      url: 'https://cdn.example.com/x.png',
      imageUrl: 'https://cdn.example.com/x.png',
    })
  })
})
