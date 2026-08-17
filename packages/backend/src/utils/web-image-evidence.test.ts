jest.mock('./logger', () => ({
  BackendLogger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

jest.mock('./remote-image-reader', () => ({
  readRemoteImages: jest.fn(),
}))

import { BackendLogger as log } from './logger'
import { readRemoteImages } from './remote-image-reader'
import type { VisionProxyConfig, VisionProxyService } from '../modules/chat/services/vision-proxy-service'
import {
  assessWebImageRelevance,
  isDisplayableRelevance,
  parseImageRelevance,
  prefilterWebImageCandidates,
  relevanceToConfidence,
} from './web-image-evidence'

const readyVisionConfig: VisionProxyConfig = {
  enabled: true,
  connectionId: 1,
  modelId: 'vision-model',
  reasoningEnabled: false,
  reasoningEffort: '',
  ollamaThink: false,
}

describe('web-image-evidence', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('prefilter drops logos, tiny images and duplicates', () => {
    const kept = prefilterWebImageCandidates([
      { url: 'https://cdn.example.com/logo.png' },
      { url: 'https://cdn.example.com/favicon.ico' },
      { url: 'https://cdn.example.com/news-cover.jpg', width: 1200, height: 800 },
      { url: 'https://cdn.example.com/news-cover.jpg', width: 1200, height: 800 },
      { url: 'https://cdn.example.com/tiny.png', width: 16, height: 16 },
      { url: 'https://cdn.example.com/chart.png', width: 900, height: 600 },
      { url: 'https://cdn.example.com/crowd.jpg', width: 1000, height: 700 },
    ])

    expect(kept.map((item) => item.url)).toEqual([
      'https://cdn.example.com/news-cover.jpg',
      'https://cdn.example.com/chart.png',
      'https://cdn.example.com/crowd.jpg',
    ])
  })

  test('parseImageRelevance accepts json and chinese labels', () => {
    expect(parseImageRelevance('{"relevance":"related","description":"桥面航拍"}')).toEqual({
      relevance: 'related',
      description: '桥面航拍',
    })
    expect(parseImageRelevance('结论：弱相关，城市远景。')).toMatchObject({
      relevance: 'weakly_related',
    })
    expect(parseImageRelevance('这是广告图，无关')).toMatchObject({
      relevance: 'unrelated',
    })
  })

  test('only related and weakly_related are displayable', () => {
    expect(isDisplayableRelevance('related')).toBe(true)
    expect(isDisplayableRelevance('weakly_related')).toBe(true)
    expect(isDisplayableRelevance('unrelated')).toBe(false)
    expect(relevanceToConfidence('related')).toBe('high')
    expect(relevanceToConfidence('weakly_related')).toBe('medium')
    expect(relevanceToConfidence('unrelated')).toBe('low')
  })

  test('assessWebImageRelevance warns and skips when transcribe throws', async () => {
    const imageUrl = 'https://cdn.example.com/news-cover.jpg'
    ;(readRemoteImages as jest.Mock).mockResolvedValue([
      {
        url: imageUrl,
        requestedUrl: imageUrl,
        mime: 'image/jpeg',
        data: 'abc',
      },
    ])

    const visionProxy = {
      transcribeImages: jest.fn().mockRejectedValue(new Error('vision timeout')),
    } as unknown as VisionProxyService

    await expect(
      assessWebImageRelevance({
        candidates: [{ url: imageUrl, width: 1200, height: 800 }],
        contextText: '新闻上下文',
        visionProxy,
        visionConfig: readyVisionConfig,
      }),
    ).resolves.toEqual([])

    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('relevance'),
      expect.objectContaining({
        url: imageUrl.slice(0, 200),
        error: 'vision timeout',
      }),
    )
  })
})
