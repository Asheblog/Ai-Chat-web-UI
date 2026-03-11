import { buildRichMessagePayload } from './rich-payload'

describe('buildRichMessagePayload external evidence mapping', () => {
  const baseUrl = 'https://chat.example.com'
  const resolveChatImageUrls = (relativePaths: string[], host: string) =>
    relativePaths.map((path) => `${host}${path}`)

  test('uses web search hit url as sourceUrl', () => {
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
      ]),
      baseUrl,
      resolveChatImageUrls,
    })

    const imageParts = payload?.parts.filter(
      (part) => part.type === 'image' && part.source === 'external',
    )
    expect(imageParts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: 'https://cdn.example.com/a.jpg',
          sourceUrl: 'https://example.com/article-a',
          meta: expect.objectContaining({ evidenceOrder: 3 }),
        }),
      ]),
    )
  })

  test('maps read_url lead image to event url and ignores details.images noise', () => {
    const payload = buildRichMessagePayload({
      content: 'read_url',
      toolLogsJson: JSON.stringify([
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
    })

    const externalUrls =
      payload?.parts
        .filter((part) => part.type === 'image' && part.source === 'external')
        .map((part) => ({
          url: part.url,
          sourceUrl: part.sourceUrl,
        })) || []

    expect(externalUrls).toEqual([
      {
        url: 'https://img.example.com/lead.jpg',
        sourceUrl: 'https://news.example.com/article',
      },
    ])
  })

  test('does not fallback sourceUrl to image url', () => {
    const payload = buildRichMessagePayload({
      content: 'image only',
      toolLogsJson: JSON.stringify([
        {
          id: 'tool-3',
          tool: 'web_search',
          stage: 'result',
          createdAt: Date.now(),
          hits: [
            {
              title: 'Image Source',
              url: 'https://cdn.example.com/hero.png',
              imageUrl: 'https://cdn.example.com/hero.png',
            },
          ],
        },
      ]),
      baseUrl,
      resolveChatImageUrls,
    })

    const imagePart = payload?.parts.find(
      (part) => part.type === 'image' && part.source === 'external',
    )

    expect(imagePart).toBeTruthy()
    expect(imagePart?.sourceUrl).toBeUndefined()
  })
})
