jest.mock('../../../utils/remote-image-reader', () => ({
  readRemoteImages: jest.fn(),
}))

declare const jest: any

import { UrlReaderToolHandler } from './url-reader-handler'
import * as urlReaderModule from '../../../utils/url-reader'
import {
  buildSearchEvidenceTaskKey,
  clearSearchEvidenceStore,
  lookupSearchEvidence,
  recordReadEvidence,
  recordSearchEvidence,
} from './web-search-evidence-store'
import type { ToolCallContext } from '../../../agent-runtime/tool-handler-types'

const createContext = (override: Partial<ToolCallContext> = {}): ToolCallContext => ({
  sessionId: 1,
  actorIdentifier: 'user:test',
  actorUserId: 1,
  messageId: 10,
  emitReasoning: jest.fn(),
  sendToolEvent: jest.fn(),
  provider: 'openai',
  connectionId: 100,
  modelRawId: 'gpt-4o',
  modelCapabilities: { vision: false },
  ...override,
})

describe('read_url 同任务正文复用与机读摘要', () => {
  beforeEach(() => {
    clearSearchEvidenceStore()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  const page = (overrides: Record<string, unknown> = {}) => ({
    title: 'Article',
    url: 'https://example.com/article',
    content: '',
    textContent: '原站正文',
    resourceType: 'page' as const,
    fallbackUsed: 'none' as const,
    contentKind: 'article' as const,
    ...overrides,
  })

  const seedEvidence = (content = '搜索命中的正文内容', truncated = false) => {
    recordSearchEvidence(
      buildSearchEvidenceTaskKey({ sessionId: 1, messageId: 10 }),
      [
        {
          title: 'Article',
          url: 'https://example.com/article',
          content,
          contentKind: 'article',
          contentSource: 'tavily',
          ...(truncated ? { contentMetadata: { provider: 'exa', kind: 'article' as const, chars: content.length, truncated: true } } : {}),
        },
      ],
    )
  }

  it('reuses same-task search body through providedContent and marks the provider source', async () => {
    seedEvidence()
    const readSpy = jest.spyOn(urlReaderModule, 'readUrlContent').mockResolvedValue(
      page({ fallbackUsed: 'provided', engine: 'provided' }),
    )

    const context = createContext({ modelCapabilities: { vision: false } })
    const result = await new UrlReaderToolHandler({ enabled: true }).handle(
      { id: 'reuse_case', function: { name: 'read_url' } },
      { url: 'https://example.com/article' },
      context,
    )

    expect(readSpy).toHaveBeenCalledWith(
      'https://example.com/article',
      expect.objectContaining({
        purpose: 'current',
        freshness: 'current',
        providedContent: expect.objectContaining({ content: '搜索命中的正文内容', kind: 'article', source: 'tavily' }),
      }),
    )
    const events = (context.sendToolEvent as any).mock.calls.map(([payload]: any[]) => payload)
    const resultEvent = events.find((payload: any) => payload.stage === 'result')
    expect(resultEvent.summary).toContain('复用')
    expect(resultEvent.details).toMatchObject({
      reusedFrom: 'search_content',
      contentSource: 'provider',
      // 共享枚举只声明 provider；真实提供方单独带出，不写回正文
      contentProvider: 'tavily',
    })

    const content = String(result.message.content)
    expect(content).toContain('复用搜索正文')
    const summaryLine = content.trim().split('\n').pop()!
    const summary = JSON.parse(summaryLine)
    expect(summary).toMatchObject({ source: 'provider', read: 1, readFailed: 0 })
  })

  it('skips reuse when the caller asks for fresh original content', async () => {
    seedEvidence()
    const readSpy = jest.spyOn(urlReaderModule, 'readUrlContent').mockResolvedValue(page())

    await new UrlReaderToolHandler({ enabled: true }).handle(
      { id: 'fresh_case', function: { name: 'read_url' } },
      { url: 'https://example.com/article', fresh: true },
      createContext({ modelCapabilities: { vision: false } }),
    )

    expect(readSpy).toHaveBeenCalledWith(
      'https://example.com/article',
      expect.not.objectContaining({ providedContent: expect.anything() }),
    )
  })

  it('does not reuse structured bodies, which would otherwise be downgraded to article', async () => {
    recordReadEvidence(buildSearchEvidenceTaskKey({ sessionId: 1, messageId: 10 }), [
      {
        url: 'https://example.com/table',
        content: '{"rows":[[1,2]]}',
        evidenceKind: 'structured',
        contentSource: 'tavily',
      },
    ])
    const readSpy = jest.spyOn(urlReaderModule, 'readUrlContent').mockResolvedValue(
      page({ url: 'https://example.com/table' }),
    )

    await new UrlReaderToolHandler({ enabled: true }).handle(
      { id: 'structured_case', function: { name: 'read_url' } },
      { url: 'https://example.com/table' },
      createContext({ modelCapabilities: { vision: false } }),
    )

    expect(lookupSearchEvidence(buildSearchEvidenceTaskKey({ sessionId: 1, messageId: 10 }), 'https://example.com/table'))
      .toMatchObject({ contentKind: 'structured' })
    expect(readSpy).toHaveBeenCalledWith(
      'https://example.com/table',
      expect.not.objectContaining({ providedContent: expect.anything() }),
    )
  })

  it('never reuses provider body for history reads', async () => {
    seedEvidence()
    const readSpy = jest.spyOn(urlReaderModule, 'readUrlContent').mockResolvedValue(
      page({ contentKind: 'article', archivedAt: '20250102030405', fallbackUsed: 'wayback' }),
    )

    await new UrlReaderToolHandler({ enabled: true }).handle(
      { id: 'history_case', function: { name: 'read_url' } },
      { url: 'https://example.com/article', purpose: 'history' },
      createContext({ modelCapabilities: { vision: false } }),
    )

    expect(readSpy).toHaveBeenCalledWith(
      'https://example.com/article',
      expect.not.objectContaining({ providedContent: expect.anything() }),
    )
  })

  it('does not store provider-truncated bodies for reuse', async () => {
    seedEvidence('Exa 截断正文', true)
    const readSpy = jest.spyOn(urlReaderModule, 'readUrlContent').mockResolvedValue(page())

    await new UrlReaderToolHandler({ enabled: true }).handle(
      { id: 'truncated_case', function: { name: 'read_url' } },
      { url: 'https://example.com/article' },
      createContext({ modelCapabilities: { vision: false } }),
    )

    expect(readSpy).toHaveBeenCalledWith(
      'https://example.com/article',
      expect.not.objectContaining({ providedContent: expect.anything() }),
    )
  })

  it('returns a cancelled machine-readable result without calling the reader', async () => {
    const readSpy = jest.spyOn(urlReaderModule, 'readUrlContent')
    const controller = new AbortController()
    controller.abort()

    const result = await new UrlReaderToolHandler({ enabled: true }).handle(
      { id: 'cancel_case', function: { name: 'read_url' } },
      { url: 'https://example.com/article' },
      createContext({ requestSignal: controller.signal, modelCapabilities: { vision: false } }),
    )

    expect(readSpy).not.toHaveBeenCalled()
    const payload = JSON.parse(String(result.message.content))
    expect(payload.cancelled).toBe(true)
    expect(payload.error).toBeUndefined()
    expect(payload.retrievalOutcome).toMatchObject({ status: 'cancelled', reason: 'request_cancelled' })
    expect(payload.evidenceSummary).toMatchObject({ read: 0, readFailed: 1, failures: [{ reason: 'cancelled' }] })
  })

  it('maps read failures to the fixed reason enum', async () => {
    jest.spyOn(urlReaderModule, 'readUrlContent').mockResolvedValue({
      title: '',
      url: 'https://example.com/blocked',
      content: '',
      textContent: '',
      error: 'HTTP 403 for blocked',
      errorCode: 'HTTP_403',
      httpStatus: 403,
      attempts: [],
    })

    const result = await new UrlReaderToolHandler({ enabled: true }).handle(
      { id: 'blocked_case', function: { name: 'read_url' } },
      { url: 'https://example.com/blocked' },
      createContext({ modelCapabilities: { vision: false } }),
    )

    const payload = JSON.parse(String(result.message.content))
    expect(payload.errorCode).toBe('HTTP_403')
    expect(payload.retrievalOutcome).toMatchObject({ status: 'failed', reason: 'read_failed' })
    expect(payload.retrievalOutcome.engines[0]).toMatchObject({ state: 'error', failureKind: 'upstream_error' })
    expect(payload.evidenceSummary.failures).toEqual([
      { url: 'https://example.com/blocked', reason: 'blocked' },
    ])
  })

  it('keeps the machine-readable trailer on successful reads with origin source', async () => {
    jest.spyOn(urlReaderModule, 'readUrlContent').mockResolvedValue(page({ title: 'Plain', fallbackUsed: 'crawler' }))

    const result = await new UrlReaderToolHandler({ enabled: true }).handle(
      { id: 'origin_case', function: { name: 'read_url' } },
      { url: 'https://example.com/article' },
      createContext({ modelCapabilities: { vision: false } }),
    )

    const content = String(result.message.content)
    expect(content).toContain('## 检索摘要')
    const summary = JSON.parse(content.trim().split('\n').pop()!)
    expect(summary).toMatchObject({ source: 'origin', read: 1, readFailed: 0, failures: [], truncated: 0 })
  })
})
describe('search evidence store identity gating', () => {
  const hit = {
    title: 'A',
    url: 'https://example.com/a',
    content: '正文内容',
    contentKind: 'article' as const,
    contentSource: 'tavily',
  }

  it('requires both session and message identity and never shares a placeholder key', () => {
    expect(buildSearchEvidenceTaskKey({ sessionId: 1, messageId: 10 })).toBe('1:10')
    expect(buildSearchEvidenceTaskKey({ sessionId: 1 })).toBeNull()
    expect(buildSearchEvidenceTaskKey({ messageId: 10 })).toBeNull()
    expect(buildSearchEvidenceTaskKey({ sessionId: 1, messageId: null })).toBeNull()
    expect(buildSearchEvidenceTaskKey({ sessionId: 1, messageId: 0 })).toBeNull()
    expect(buildSearchEvidenceTaskKey({ sessionId: 0, messageId: 10 })).toBeNull()
  })

  it('disables both writes and reads when identity is incomplete or belongs to another message', () => {
    recordSearchEvidence(buildSearchEvidenceTaskKey({ sessionId: 1 }), [hit])
    expect(lookupSearchEvidence(buildSearchEvidenceTaskKey({ sessionId: 1 }), hit.url)).toBeUndefined()

    recordSearchEvidence(buildSearchEvidenceTaskKey({ sessionId: 1, messageId: 10 }), [hit])
    expect(lookupSearchEvidence(buildSearchEvidenceTaskKey({ sessionId: 1, messageId: 11 }), hit.url)).toBeUndefined()
    expect(lookupSearchEvidence(buildSearchEvidenceTaskKey({ sessionId: 2, messageId: 10 }), hit.url)).toBeUndefined()
    expect(lookupSearchEvidence(buildSearchEvidenceTaskKey({ sessionId: 1, messageId: 10 }), hit.url)).toMatchObject({
      source: 'tavily',
    })
  })

  it('does not reuse evidence across messages for read_url', async () => {
    recordSearchEvidence(buildSearchEvidenceTaskKey({ sessionId: 1, messageId: 10 }), [
      { ...hit, contentKind: 'article' as const },
    ])
    const readSpy = jest.spyOn(urlReaderModule, 'readUrlContent').mockResolvedValue({
      title: 'A',
      url: hit.url,
      content: '',
      textContent: '原站正文',
      resourceType: 'page',
      fallbackUsed: 'none',
    })

    await new UrlReaderToolHandler({ enabled: true }).handle(
      { id: 'other_message', function: { name: 'read_url' } },
      { url: hit.url },
      createContext({ messageId: 11 }),
    )

    expect(readSpy).toHaveBeenCalledWith(
      hit.url,
      expect.not.objectContaining({ providedContent: expect.anything() }),
    )
  })
})

describe('web_search records reusable bodies with their real source', () => {
  const { WebSearchToolHandler } = require('./web-search-handler')
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  const searchConfig = (overrides: Record<string, unknown> = {}) => ({
    enabled: true,
    engines: ['tavily'],
    apiKeys: { tavily: 'tv-key' },
    resultLimit: 5,
    domains: [],
    scope: 'webpage',
    autoReadAfterSearch: true,
    autoReadTopK: 1,
    parallelMaxEngines: 1,
    autoBilingualMode: 'off',
    ...overrides,
  })

  const runSearch = (handler: any, context: ToolCallContext) =>
    handler.handle(
      { id: 'search_call', function: { name: 'web_search', arguments: '{}' } },
      { query: 'q' },
      context,
    )

  it('registers an article body from the search provider for a later read_url', async () => {
    global.fetch = jest.fn(async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              title: 'Provider body',
              url: 'https://example.com/provider',
              content: 'short',
              raw_content: '提供方正文'.repeat(30),
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as any
    const context = createContext()
    await runSearch(new WebSearchToolHandler(searchConfig()), context)

    const readSpy = jest.spyOn(urlReaderModule, 'readUrlContent').mockResolvedValue({
      title: 'Provider body',
      url: 'https://example.com/provider',
      content: '',
      textContent: '提供方正文',
      resourceType: 'page',
      fallbackUsed: 'provided',
      engine: 'provided',
    })
    await new UrlReaderToolHandler({ enabled: true }).handle(
      { id: 'reuse_from_search', function: { name: 'read_url' } },
      { url: 'https://example.com/provider' },
      context,
    )

    expect(readSpy).toHaveBeenCalledWith(
      'https://example.com/provider',
      expect.objectContaining({
        providedContent: expect.objectContaining({ source: 'tavily' }),
      }),
    )
  })

  it('registers an auto-read body with the real reader engine, not the search engine', async () => {
    jest.spyOn(urlReaderModule, 'readUrlContent').mockResolvedValueOnce({
      title: 'Read page',
      url: 'https://example.com/read-page',
      content: '',
      textContent: '自动阅读得到的正文',
      resourceType: 'page',
      fallbackUsed: 'crawler',
      engine: 'crawler',
    })
    global.fetch = jest.fn(async () =>
      new Response(
        JSON.stringify({
          results: [
            { title: 'Read page', url: 'https://example.com/read-page', snippet: 'only snippet' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as any
    const context = createContext()
    await runSearch(new WebSearchToolHandler(searchConfig()), context)

    const readSpy = jest.spyOn(urlReaderModule, 'readUrlContent').mockResolvedValue({
      title: 'Read page',
      url: 'https://example.com/read-page',
      content: '',
      textContent: '自动阅读得到的正文',
      resourceType: 'page',
      fallbackUsed: 'provided',
      engine: 'provided',
    })
    await new UrlReaderToolHandler({ enabled: true }).handle(
      { id: 'reuse_from_read', function: { name: 'read_url' } },
      { url: 'https://example.com/read-page' },
      context,
    )

    expect(readSpy).toHaveBeenCalledWith(
      'https://example.com/read-page',
      expect.objectContaining({
        providedContent: expect.objectContaining({ source: 'crawler' }),
      }),
    )
  })
})
