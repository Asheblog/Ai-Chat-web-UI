import { runWebSearch } from '../web-search'

describe('runWebSearch image mapping', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  test('maps metaso image metadata fields', async () => {
    global.fetch = jest.fn(async () =>
      new Response(
        JSON.stringify({
          images: [
            {
              title: 'Image A',
              url: 'https://example.com/page-a',
              imageUrl: 'https://cdn.example.com/a.jpg',
              thumbnail: 'https://cdn.example.com/a-thumb.jpg',
              description: 'desc-a',
            },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    ) as typeof fetch

    const hits = await runWebSearch('image query', {
      engine: 'metaso',
      apiKey: 'test-key',
      scope: 'image',
      limit: 3,
    })

    expect(hits).toHaveLength(1)
    expect(hits[0].title).toBe('Image A')
    expect(hits[0].url).toBe('https://example.com/page-a')
    expect(hits[0].imageUrl).toBe('https://cdn.example.com/a.jpg')
    expect(hits[0].thumbnailUrl).toBe('https://cdn.example.com/a-thumb.jpg')
  })
})

