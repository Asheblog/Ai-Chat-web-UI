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

  it('attaches multimodal followup when model supports vision', async () => {
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

    expect(result.followupMessages).toHaveLength(1)
    expect(result.followupMessages?.[0]).toMatchObject({
      role: 'user',
      content: [
        { type: 'text' },
        {
          type: 'image_url',
          image_url: {
            url: 'data:image/png;base64,ZmFrZQ==',
          },
        },
      ],
    })
    expect(context.sendToolEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          leadImageUrl: 'https://cdn.example.com/lead.png',
          visionFollowupAttached: true,
        }),
      }),
    )
  })

  it('does not attach followup when model lacks vision support', async () => {
    jest.spyOn(urlReaderModule, 'readUrlContent').mockResolvedValue({
      title: '',
      url: 'https://example.com/image.png',
      content: '',
      textContent: '',
      resourceType: 'image',
      contentType: 'image/png',
      leadImageUrl: 'https://example.com/image.png',
      images: [
        {
          url: 'https://example.com/image.png',
          source: 'direct',
        },
      ],
    })

    const handler = new UrlReaderToolHandler({ enabled: true })
    const context = createContext({ modelCapabilities: { vision: false } })
    const result = await handler.handle(
      { id: 'call_2', function: { name: 'read_url', arguments: '{}' } },
      { url: 'https://example.com/image.png' },
      context,
    )

    expect(result.followupMessages).toBeUndefined()
    expect(mockedReadRemoteImages).not.toHaveBeenCalled()
    expect(result.message.content).toContain('## 图片资源')
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
})
