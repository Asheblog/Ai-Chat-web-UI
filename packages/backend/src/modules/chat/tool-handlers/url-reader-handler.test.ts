jest.mock('../../../utils/remote-image-reader', () => ({
  readRemoteImages: jest.fn(),
}))

declare const jest: any

import { UrlReaderToolHandler } from './url-reader-handler'
import * as urlReaderModule from '../../../utils/url-reader'
import { readRemoteImages } from '../../../utils/remote-image-reader'
import type { ToolCallContext } from '../../../agent-runtime/tool-handler-types'

const mockedReadRemoteImages = readRemoteImages as any

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
  modelCapabilities: { vision: true },
  ...override,
})

describe('UrlReaderToolHandler', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    mockedReadRemoteImages.mockReset()
  })

  it('keeps article images in the read_url result instead of inventing a user message for Chat Completions', async () => {
    jest.spyOn(urlReaderModule, 'readUrlContent').mockResolvedValue({
      title: '测试页面',
      url: 'https://example.com/article',
      content: '',
      textContent: '正文内容',
      resourceType: 'page',
      wordCount: 10,
      fallbackUsed: 'none',
      leadImageUrl: 'https://cdn.example.com/lead.png',
      images: [
        {
          url: 'https://cdn.example.com/lead.png',
          source: 'meta',
        },
      ],
    })
    mockedReadRemoteImages.mockResolvedValue([
      {
        url: 'https://cdn.example.com/lead.png',
        mime: 'image/png',
        data: 'ZmFrZQ==',
      },
    ])

    const handler = new UrlReaderToolHandler({ enabled: true })
    const context = createContext()
    const result = await handler.handle(
      { id: 'call_1', function: { name: 'read_url', arguments: '{}' } },
      { url: 'https://example.com/article' },
      context,
    )

    expect(result.followupMessages).toBeUndefined()
    expect(mockedReadRemoteImages).not.toHaveBeenCalled()
    expect(result.message.content).toContain('测试页面')
    expect(result.message.content).toContain('https://example.com/article')
    expect(result.message.content).toContain('https://cdn.example.com/lead.png')
    expect(context.sendToolEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          leadImageUrl: 'https://cdn.example.com/lead.png',
        }),
      }),
    )
  })

  it('returns downloaded article images as optional evidence attached to their tool call', async () => {
    const article = 'https://example.com/redirect'
    const finalUrl = 'https://example.com/news'
    const firstImage = 'https://cdn.example.com/first.png'
    const secondImage = 'https://cdn.example.com/picture.png?variant=2'
    jest.spyOn(urlReaderModule, 'readUrlContent').mockResolvedValue({
      title: '本地新闻', url: article, finalUrl, content: '', textContent: '新闻正文',
      resourceType: 'page',
      images: [{ url: firstImage, source: 'article' }, { url: secondImage, alt: '活动现场', source: 'article' }],
    })
    // The first candidate failed to download; the remaining bytes still belong to the second URL.
    mockedReadRemoteImages.mockResolvedValue([
      { url: 'https://cdn.example.com/picture.png?variant=2', requestedUrl: secondImage, mime: 'image/png', data: 'cGljdHVyZQ==', alt: '活动现场' },
    ])

    const result = await new UrlReaderToolHandler({ enabled: true }).handle(
      { id: 'call_news', function: { name: 'read_url' } }, { url: article },
      createContext({ provider: 'openai_responses' }),
    )

    expect(result.followupMessages).toBeUndefined()
    expect(result.message).toMatchObject({
      role: 'tool', tool_call_id: 'call_news', imageEvidence: {
        kind: 'page', sourceUrl: finalUrl, title: '本地新闻',
        images: [{ imageUrl: secondImage, dataUrl: 'data:image/png;base64,cGljdHVyZQ==', alt: '活动现场' }],
      },
    })
    expect(result.message.content).toContain(firstImage)
    expect(result.message.content).toContain(secondImage)
  })

  it.each([
    { provider: 'openai', vision: true, attached: false },
    { provider: 'openai_responses', vision: false, attached: false },
    { provider: 'openai_responses', vision: true, attached: true },
    { provider: 'anthropic', vision: true, attached: true },
  ])('keeps direct images as tool resources ($provider, vision: $vision)', async ({ provider, vision, attached }) => {
    const url = 'https://example.com/image.png'
    jest.spyOn(urlReaderModule, 'readUrlContent').mockResolvedValue({
      title: '', url, content: '', textContent: '', resourceType: 'image',
      contentType: 'image/png', leadImageUrl: url, images: [{ url, source: 'direct' }],
    })
    mockedReadRemoteImages.mockResolvedValue([
      { url, requestedUrl: url, mime: 'image/png', data: 'ZmFrZQ==' },
    ])

    const handler = new UrlReaderToolHandler({ enabled: true })
    const context = createContext({ provider, modelCapabilities: { vision } })
    const result = await handler.handle(
      { id: 'call_2', function: { name: 'read_url', arguments: '{}' } }, { url }, context,
    )

    expect(result.followupMessages).toBeUndefined()
    if (attached) {
      expect(result.message).toMatchObject({ imageEvidence: {
        kind: 'resource', sourceUrl: url,
        images: [{ imageUrl: url, dataUrl: 'data:image/png;base64,ZmFrZQ==' }],
      } })
      expect(mockedReadRemoteImages).toHaveBeenCalledTimes(1)
    } else {
      expect(result.message).not.toHaveProperty('imageEvidence')
      expect(mockedReadRemoteImages).not.toHaveBeenCalled()
    }
    expect(result.message.content).toContain('## 图片资源')
    expect(result.message.content).toContain(url)
  })

  it('forwards DeepSeek fallback config and the request signal to the reader', async () => {
    const readSpy = jest.spyOn(urlReaderModule, 'readUrlContent').mockResolvedValue({
      title: 'OK',
      url: 'https://example.com/article',
      content: '',
      textContent: '正文',
      resourceType: 'page',
      fallbackUsed: 'deepseek_fetch',
      engine: 'deepseek_fetch',
      attempts: [{ engine: 'deepseek_fetch', status: 'success', durationMs: 10 }],
    })
    const controller = new AbortController()

    const handler = new UrlReaderToolHandler({
      enabled: true,
      enableDeepseekFallback: true,
      deepseekApiKey: 'ds-key',
    })
    const context = createContext({ requestSignal: controller.signal })
    const result = await handler.handle(
      { id: 'call_3', function: { name: 'read_url', arguments: '{}' } },
      { url: 'https://example.com/article' },
      context,
    )

    expect(readSpy).toHaveBeenCalledWith(
      'https://example.com/article',
      expect.objectContaining({
        enableDeepseekFallback: true,
        deepseekApiKey: 'ds-key',
        signal: controller.signal,
      }),
    )
    expect(result.message.content).toContain('DeepSeek')
  })

  it('keeps raw image urls as evidence instead of assessing relevance', async () => {
    jest.spyOn(urlReaderModule, 'readUrlContent').mockResolvedValue({
      title: '带图片的新闻页',
      url: 'https://example.com/a',
      content: '',
      textContent: '正文内容',
      resourceType: 'page',
      wordCount: 10,
      fallbackUsed: 'none',
      leadImageUrl: 'https://cdn.example.com/lead.png',
      images: [
        { url: 'https://cdn.example.com/lead.png', source: 'meta' },
        { url: 'https://cdn.example.com/second.png', alt: '第二张', source: 'article' },
      ],
    })

    const handler = new UrlReaderToolHandler({ enabled: true })
    const context = createContext({ modelCapabilities: { vision: false } })
    const result = await handler.handle(
      { id: 'call_raw_images', function: { name: 'read_url', arguments: '{}' } },
      { url: 'https://example.com/a' },
      context,
    )

    const content = String(result.message.content)
    expect(content).toContain('## 图片证据')
    expect(content).toContain('https://cdn.example.com/lead.png')
    expect(content).toContain('https://cdn.example.com/second.png')
    expect(content).not.toContain('图片证据（已识图筛选）')

    const resultEvents = (context.sendToolEvent as any).mock.calls
      .map(([payload]: any[]) => payload)
      .filter((payload: any) => payload.stage === 'result')
    expect(resultEvents).toHaveLength(1)
    expect(resultEvents[0].details).not.toHaveProperty('assessedImages')
  })

  it('leaves no image evidence section when the page has no images', async () => {
    jest.spyOn(urlReaderModule, 'readUrlContent').mockResolvedValue({
      title: '纯文本页',
      url: 'https://example.com/plain',
      content: '',
      textContent: '只有正文，没有任何配图。',
      resourceType: 'page',
      wordCount: 8,
      fallbackUsed: 'none',
    })

    const handler = new UrlReaderToolHandler({ enabled: true })
    const context = createContext({ modelCapabilities: { vision: false } })
    const result = await handler.handle(
      { id: 'call_plain_text', function: { name: 'read_url', arguments: '{}' } },
      { url: 'https://example.com/plain' },
      context,
    )

    const content = String(result.message.content)
    expect(content).not.toContain('## 图片证据')
    expect(content).not.toContain('\n\n\n')
    expect(content).toContain('## 正文内容')
    expect(content.endsWith('只有正文，没有任何配图。')).toBe(true)
  })
  it('defaults to current content and passes an explicit history request to the reader', async () => {
    const readSpy = jest.spyOn(urlReaderModule, 'readUrlContent').mockResolvedValue({
      title: 'Article', url: 'https://example.com/article', content: '', textContent: '正文内容',
    })
    const handler = new UrlReaderToolHandler({ enabled: true })
    const context = createContext({ modelCapabilities: { vision: false } })
    await handler.handle({ id: 'current' }, { url: 'https://example.com/article' }, context)
    expect(readSpy).toHaveBeenLastCalledWith('https://example.com/article', expect.objectContaining({
      purpose: 'current', freshness: 'current',
    }))
    await handler.handle({ id: 'history' }, { url: 'https://example.com/article', purpose: 'history' }, context)
    expect(readSpy).toHaveBeenLastCalledWith('https://example.com/article', expect.objectContaining({
      purpose: 'history', freshness: 'default',
    }))
  })

  it('keeps provenance and truncation on the final tool result', async () => {
    const evidence = { title: 'Archive', url: 'https://example.com/article', content: '', textContent: '历史正文',
      contentKind: 'article', fetchedAt: '2026-11-16T03:00:00Z', archivedAt: '20250102030405', truncated: true,
    }
    jest.spyOn(urlReaderModule, 'readUrlContent').mockResolvedValue(evidence)
    const context = createContext({ modelCapabilities: { vision: false } })
    await new UrlReaderToolHandler({ enabled: true }).handle(
      { id: 'history' }, { url: evidence.url, purpose: 'history' }, context,
    )
    expect(context.sendToolEvent).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'result', details: expect.objectContaining({
        contentKind: 'article', fetchedAt: evidence.fetchedAt, archivedAt: evidence.archivedAt, truncated: true,
      }),
    }))
  })

})
