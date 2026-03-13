import { buildRichMessagePayload } from './rich-payload'

describe('buildRichMessagePayload external evidence disabled', () => {
  const baseUrl = 'https://chat.example.com'
  const resolveChatImageUrls = (relativePaths: string[], host: string) =>
    relativePaths.map((path) => `${host}${path}`)

  test('ignores external image fields from web tool logs', () => {
    const payload = buildRichMessagePayload({
      content: 'news',
      toolLogsJson: JSON.stringify([
        {
          id: 'tool-1',
          tool: 'web_search',
          stage: 'result',
          summary: 'web results',
          createdAt: Date.now(),
          hits: [
            {
              title: 'Result A',
              url: 'https://example.com/article-a',
              imageUrl: 'https://cdn.example.com/a.jpg',
              rank: 3,
            },
          ],
        },
        {
          id: 'tool-2',
          tool: 'read_url',
          stage: 'result',
          url: 'https://news.example.com/article',
          createdAt: Date.now(),
          details: {
            leadImageUrl: 'https://img.example.com/lead.jpg',
            images: [
              { url: 'https://img.example.com/noise-1.jpg' },
              { url: 'https://img.example.com/noise-2.jpg' },
            ],
          },
        },
      ]),
      baseUrl,
      resolveChatImageUrls,
    } as any)

    const externalImageParts =
      payload?.parts.filter((part) => part.type === 'image' && part.source === 'external') || []

    expect(externalImageParts).toEqual([])
  })

  test('keeps attachment and generated images', () => {
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

    const externalImageParts =
      payload?.parts.filter((part) => part.type === 'image' && part.source === 'external') || []
    expect(externalImageParts).toEqual([])
  })
})
