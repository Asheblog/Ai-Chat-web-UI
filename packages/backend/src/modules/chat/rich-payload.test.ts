import { buildRichMessagePayload, extractExternalImageParts } from './rich-payload'

describe('buildRichMessagePayload web evidence images', () => {
  const baseUrl = 'https://chat.example.com'
  const resolveChatImageUrls = (relativePaths: string[], host: string) =>
    relativePaths.map((path) => `${host}${path}`)

  test('includes assessed web evidence images and uses stack layout', () => {
    const payload = buildRichMessagePayload({
      content: 'news',
      toolEvents: [
        {
          tool: 'web_search',
          summary: 'auto-read',
          url: 'https://news.example.com/article',
          details: {
            assessedImages: [
              {
                url: 'https://img.example.com/lead.jpg',
                title: '桥面航拍',
                confidence: 'high',
                description: '跨海大桥实景',
                sourceUrl: 'https://news.example.com/article',
              },
              {
                url: 'https://img.example.com/ad.jpg',
                confidence: 'low',
                description: '广告',
              },
            ],
          },
        },
      ],
      baseUrl,
      resolveChatImageUrls,
    })

    expect(payload?.layout).toBe('stack')
    const externalImageParts =
      payload?.parts.filter((part) => part.type === 'image' && part.source === 'external') || []
    expect(externalImageParts).toEqual([
      expect.objectContaining({
        type: 'image',
        source: 'external',
        sourceKind: 'web',
        url: 'https://img.example.com/lead.jpg',
        title: '桥面航拍',
        confidence: 'high',
        sourceUrl: 'https://news.example.com/article',
      }),
    ])
  })

  test('extractExternalImageParts prefers assessedImages over raw hits', () => {
    const parts = extractExternalImageParts([
      {
        tool: 'web_search',
        hits: [
          {
            title: 'Result A',
            url: 'https://example.com/article-a',
            imageUrl: 'https://cdn.example.com/a.jpg',
          },
        ],
        details: {
          assessedImages: [
            {
              url: 'https://cdn.example.com/kept.jpg',
              title: 'Kept',
              confidence: 'high',
            },
          ],
        },
      },
    ])

    expect(parts.map((part) => part.url)).toEqual(['https://cdn.example.com/kept.jpg'])
  })

  test('keeps attachment and generated images side-by-side without web evidence', () => {
    const payload = buildRichMessagePayload({
      content: 'mixed',
      attachmentRelativePaths: ['/img/upload-a.png'],
      generatedImages: [
        {
          url: 'https://cdn.example.com/generated-a.png',
          width: 1024,
          height: 768,
          revisedPrompt: 'generated prompt',
        },
      ],
      baseUrl,
      resolveChatImageUrls,
    })

    expect(payload?.layout).toBe('side-by-side')
    expect(payload?.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'image',
          source: 'attachment',
          url: 'https://chat.example.com/img/upload-a.png',
        }),
        expect.objectContaining({
          type: 'image',
          source: 'generated',
          url: 'https://cdn.example.com/generated-a.png',
        }),
      ]),
    )
  })
})
