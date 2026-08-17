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

  test('tavily requests include_images and maps per-result images', async () => {
    const fetchMock = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'))
      expect(body.include_images).toBe(true)
      return new Response(
        JSON.stringify({
          results: [
            {
              title: 'News A',
              url: 'https://example.com/a',
              content: 'snippet-a',
              images: ['https://cdn.example.com/a.jpg'],
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as jest.MockedFunction<typeof fetch>
    global.fetch = fetchMock

    const hits = await runWebSearch('news', {
      engine: 'tavily',
      apiKey: 'test-key',
      limit: 3,
    })

    expect(hits[0].imageUrl).toBe('https://cdn.example.com/a.jpg')
    expect(hits[0].thumbnailUrl).toBe('https://cdn.example.com/a.jpg')
  })

  test('tavily image scope maps top-level images with descriptions', async () => {
    const fetchMock = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'))
      expect(body.include_images).toBe(true)
      expect(body.include_image_descriptions).toBe(true)
      return new Response(
        JSON.stringify({
          images: [
            {
              url: 'https://cdn.example.com/top-a.jpg',
              description: '新闻配图 A',
            },
            'https://cdn.example.com/top-b.jpg',
          ],
          results: [
            {
              title: 'News A',
              url: 'https://example.com/a',
              content: 'snippet-a',
              images: ['https://cdn.example.com/page-a.jpg'],
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as jest.MockedFunction<typeof fetch>
    global.fetch = fetchMock

    const hits = await runWebSearch('news images', {
      engine: 'tavily',
      apiKey: 'test-key',
      scope: 'image',
      limit: 5,
    })

    expect(hits).toHaveLength(2)
    expect(hits[0].imageUrl).toBe('https://cdn.example.com/top-a.jpg')
    expect(hits[0].snippet).toBe('新闻配图 A')
    expect(hits[0].url).toBe('https://cdn.example.com/top-a.jpg')
    expect(hits[1].imageUrl).toBe('https://cdn.example.com/top-b.jpg')
  })

  test('brave maps nested thumbnail original/src', async () => {
    global.fetch = jest.fn(async () =>
      new Response(
        JSON.stringify({
          web: {
            results: [
              {
                title: 'Brave News',
                url: 'https://example.com/brave',
                description: 'desc',
                thumbnail: {
                  src: 'https://imgs.search.brave.com/thumb.jpg',
                  original: 'https://cdn.example.com/original.jpg',
                },
              },
            ],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as typeof fetch

    const hits = await runWebSearch('brave news', {
      engine: 'brave',
      apiKey: 'test-key',
      limit: 3,
    })

    expect(hits[0].imageUrl).toBe('https://cdn.example.com/original.jpg')
    expect(hits[0].thumbnailUrl).toBe('https://imgs.search.brave.com/thumb.jpg')
  })

  test('brave image scope calls image search endpoint and maps images', async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain('/res/v1/images/search')
      return new Response(
        JSON.stringify({
          results: [
            {
              title: 'Brave Image',
              url: 'https://example.com/brave-image-page',
              description: 'image desc',
              thumbnail: { src: 'https://imgs.search.brave.com/thumb.jpg' },
              imageUrl: 'https://cdn.example.com/full.jpg',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as jest.MockedFunction<typeof fetch>
    global.fetch = fetchMock

    const hits = await runWebSearch('brave image', {
      engine: 'brave',
      apiKey: 'test-key',
      scope: 'image',
      limit: 3,
    })

    expect(hits[0].url).toBe('https://example.com/brave-image-page')
    expect(hits[0].imageUrl).toBe('https://cdn.example.com/full.jpg')
    expect(hits[0].thumbnailUrl).toBe('https://imgs.search.brave.com/thumb.jpg')
  })

  test('exa requests imageLinks and maps image + extras', async () => {
    const fetchMock = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'))
      expect(body.contents?.extras?.imageLinks).toBe(5)
      return new Response(
        JSON.stringify({
          results: [
            {
              title: 'Exa Doc',
              url: 'https://example.com/exa',
              highlights: ['highlight'],
              image: 'https://cdn.example.com/cover.png',
              favicon: 'https://example.com/favicon.ico',
              extras: { imageLinks: ['https://cdn.example.com/extra.jpg'] },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as jest.MockedFunction<typeof fetch>
    global.fetch = fetchMock

    const hits = await runWebSearch('exa query', {
      engine: 'exa',
      apiKey: 'test-key',
      limit: 3,
    })

    expect(hits[0].imageUrl).toBe('https://cdn.example.com/cover.png')
    expect(hits[0].thumbnailUrl).toBe('https://example.com/favicon.ico')
  })

  test('exa image scope flattens page images into image hits', async () => {
    const fetchMock = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'))
      expect(body.contents?.extras?.imageLinks).toBe(10)
      return new Response(
        JSON.stringify({
          results: [
            {
              title: 'Exa News',
              url: 'https://example.com/exa-news',
              highlights: ['highlight'],
              image: 'https://cdn.example.com/cover.png',
              extras: {
                imageLinks: [
                  'https://cdn.example.com/extra1.jpg',
                  'https://cdn.example.com/extra2.jpg',
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as jest.MockedFunction<typeof fetch>
    global.fetch = fetchMock

    const hits = await runWebSearch('exa images', {
      engine: 'exa',
      apiKey: 'test-key',
      scope: 'image',
      limit: 5,
    })

    expect(hits.map((hit) => hit.imageUrl)).toEqual([
      'https://cdn.example.com/cover.png',
      'https://cdn.example.com/extra1.jpg',
      'https://cdn.example.com/extra2.jpg',
    ])
    expect(hits[0].url).toBe('https://example.com/exa-news')
    expect(hits[1].url).toBe('https://example.com/exa-news')
    expect(hits[1].title).toContain('Exa News')
  })
})
