import { formatHitsForModel, resolveMetasoScope, runWebSearch } from '../web-search'
import { DEEPSEEK_SEARCH_ENDPOINT } from '../deepseek-tools'

const jsonResponse = (payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

const parseBody = (init?: RequestInit) => JSON.parse(String(init?.body || '{}')) as Record<string, any>

describe('provider conformance: Tavily', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  test('authenticates with Bearer header instead of a body api_key', async () => {
    const fetchMock = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const headers = (init?.headers || {}) as Record<string, string>
      expect(headers.Authorization).toBe('Bearer tavily-key')
      expect(parseBody(init)).not.toHaveProperty('api_key')
      return jsonResponse({ results: [] })
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await runWebSearch('q', { engine: 'tavily', apiKey: 'tavily-key', limit: 3 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('requests markdown raw content and maps it to hit content', async () => {
    const fetchMock = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = parseBody(init)
      expect(body.include_raw_content).toBe('markdown')
      expect(body).not.toHaveProperty('chunks_per_source')
      expect(body.include_published_date).toBe(true)
      return jsonResponse({
        results: [
          {
            title: 'Doc',
            url: 'https://example.com/doc',
            content: 'short snippet',
            raw_content: '# full markdown body',
            published_date: 'Tue, 11 Mar 2025 17:00:00 GMT',
          },
        ],
      })
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const hits = await runWebSearch('q', {
      engine: 'tavily',
      apiKey: 'k',
      limit: 3,
      includeRawContent: true,
    })

    expect(hits[0].content).toBe('# full markdown body')
    expect(hits[0].snippet).toBe('short snippet')
    expect(hits[0].publishedDate).toBe('Tue, 11 Mar 2025 17:00:00 GMT')
  })

  test('keeps chunks_per_source when raw content is not requested', async () => {
    const fetchMock = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = parseBody(init)
      expect(body.chunks_per_source).toBe(3)
      expect(body).not.toHaveProperty('include_raw_content')
      return jsonResponse({ results: [] })
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await runWebSearch('q', { engine: 'tavily', apiKey: 'k', limit: 2 })
  })

  test('normalizes whitelisted domains to hostnames', async () => {
    const fetchMock = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = parseBody(init)
      expect(body.include_domains).toEqual(['example.com', 'news.example.org'])
      return jsonResponse({ results: [] })
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await runWebSearch('q', {
      engine: 'tavily',
      apiKey: 'k',
      limit: 2,
      domains: ['https://example.com/path', '*.news.example.org', 'example.com'],
    })
  })
})

describe('provider conformance: Brave', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  test('sends documented snippet parameters and merges extra snippets into content', async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      expect(url.searchParams.get('text_decorations')).toBe('false')
      expect(url.searchParams.get('extra_snippets')).toBe('true')
      expect(url.searchParams.get('count')).toBe('3')
      return jsonResponse({
        web: {
          results: [
            {
              title: 'Brave Result',
              url: 'https://example.com/brave',
              description: 'main snippet',
              extra_snippets: ['extra one', 'extra two'],
              page_age: '2025-03-11T17:00:00',
              profile: { name: 'Example' },
            },
          ],
        },
      })
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const hits = await runWebSearch('q', { engine: 'brave', apiKey: 'k', limit: 3 })

    expect(hits[0].snippet).toBe('main snippet')
    expect(hits[0].content).toBe('main snippet\n\nextra one\n\nextra two')
    expect(hits[0].publishedDate).toBe('2025-03-11T17:00:00')
    expect(hits[0].siteName).toBe('Example')
  })

  test('expresses the domain whitelist with site: operators joined by OR', async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      expect(url.searchParams.get('q')).toBe('rust (site:example.com OR site:docs.example.org)')
      return jsonResponse({ web: { results: [] } })
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await runWebSearch('rust', {
      engine: 'brave',
      apiKey: 'k',
      limit: 3,
      domains: ['example.com', 'docs.example.org'],
    })
  })

  test('image search prefers the original image url from properties', async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain('/res/v1/images/search')
      return jsonResponse({
        results: [
          {
            title: 'Image',
            url: 'https://example.com/page',
            source: 'example.com',
            properties: { url: 'https://cdn.example.com/original.jpg' },
            thumbnail: { src: 'https://imgs.search.brave.com/thumb.jpg' },
          },
        ],
      })
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const hits = await runWebSearch('img', { engine: 'brave', apiKey: 'k', limit: 2, scope: 'image' })

    expect(hits[0].url).toBe('https://example.com/page')
    expect(hits[0].imageUrl).toBe('https://cdn.example.com/original.jpg')
    expect(hits[0].thumbnailUrl).toBe('https://imgs.search.brave.com/thumb.jpg')
  })
})

describe('provider conformance: Metaso', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  test('maps project scopes onto the six official scopes', () => {
    expect(resolveMetasoScope('webpage')).toBe('webpage')
    expect(resolveMetasoScope('paper')).toBe('scholar')
    expect(resolveMetasoScope('scholar')).toBe('scholar')
    expect(resolveMetasoScope('image')).toBe('image')
    expect(resolveMetasoScope('nonsense')).toBe('webpage')
    expect(resolveMetasoScope(undefined)).toBe('webpage')
  })

  test('sends only documented search fields and webpage-only raw content', async () => {
    const fetchMock = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = parseBody(init)
      expect(body).toEqual({
        q: 'q',
        scope: 'webpage',
        includeSummary: true,
        size: 3,
        conciseSnippet: false,
        includeRawContent: true,
      })
      return jsonResponse({ webpages: [] })
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await runWebSearch('q', {
      engine: 'metaso',
      apiKey: 'k',
      limit: 3,
      scope: 'webpage',
      includeSummary: true,
      includeRawContent: true,
    })
  })

  test('omits includeRawContent outside the webpage scope', async () => {
    const fetchMock = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = parseBody(init)
      expect(body.scope).toBe('scholar')
      expect(body).not.toHaveProperty('includeRawContent')
      return jsonResponse({ scholars: [] })
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await runWebSearch('q', {
      engine: 'metaso',
      apiKey: 'k',
      limit: 3,
      scope: 'paper',
      includeRawContent: true,
    })
  })

  test('applies the domain whitelist locally because the API has no domain parameter', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({
        webpages: [
          { title: 'Keep', url: 'https://example.com/a' },
          { title: 'Drop', url: 'https://other.example.net/b' },
        ],
      }),
    ) as unknown as typeof fetch

    const hits = await runWebSearch('q', {
      engine: 'metaso',
      apiKey: 'k',
      limit: 3,
      domains: ['example.com'],
    })

    expect(hits.map((hit) => hit.title)).toEqual(['Keep'])
  })
})

describe('provider conformance: Exa', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  test('requests text and summary only when configured and maps published date', async () => {
    const fetchMock = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = parseBody(init)
      expect(body.contents.text).toEqual({ maxCharacters: 4000 })
      expect(body.contents.summary).toEqual({ query: 'q' })
      expect(body.includeDomains).toEqual(['example.com'])
      return jsonResponse({
        results: [
          {
            title: 'Exa',
            url: 'https://example.com/exa',
            text: 'full text',
            highlights: ['relevant excerpt'],
            summary: 'llm summary',
            publishedDate: '2025-03-11T17:00:00.000Z',
          },
        ],
      })
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const hits = await runWebSearch('q', {
      engine: 'exa',
      apiKey: 'k',
      limit: 3,
      includeRawContent: true,
      includeSummary: true,
      domains: ['https://example.com/page'],
    })

    expect(hits[0].content).toBe('full text')
    expect(hits[0].snippet).toBe('relevant excerpt')
    expect(hits[0].publishedDate).toBe('2025-03-11T17:00:00.000Z')
  })

  test('omits text and summary from contents by default', async () => {
    const fetchMock = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = parseBody(init)
      expect(body.contents).not.toHaveProperty('text')
      expect(body.contents).not.toHaveProperty('summary')
      return jsonResponse({ results: [] })
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await runWebSearch('q', { engine: 'exa', apiKey: 'k', limit: 2 })
  })
})

describe('provider conformance: DeepSeek', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  test('forwards the original user question as ori_question and maps result metadata', async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(DEEPSEEK_SEARCH_ENDPOINT)
      const body = parseBody(init)
      expect(body.ori_question).toBe('DeepSeek 发布了什么')
      return jsonResponse({
        results: [
          {
            title: 'DS',
            url: 'https://example.com/ds',
            snippet: 'short',
            summary: 'long summary',
            date: '2026-06-01T00:00:00+00:00',
            site_name: 'Example News',
            authority: 3,
          },
        ],
      })
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const hits = await runWebSearch('expanded query', {
      engine: 'deepseek',
      apiKey: 'k',
      limit: 3,
      oriQuestion: 'DeepSeek 发布了什么',
    })

    expect(hits[0].snippet).toBe('long summary')
    expect(hits[0].publishedDate).toBe('2026-06-01T00:00:00+00:00')
    expect(hits[0].siteName).toBe('Example News')
    expect(hits[0].authority).toBe(3)
  })

  test('omits ori_question when it exceeds the documented length', async () => {
    const fetchMock = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = parseBody(init)
      expect(body).not.toHaveProperty('ori_question')
      return jsonResponse({ results: [] })
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await runWebSearch('q', {
      engine: 'deepseek',
      apiKey: 'k',
      limit: 2,
      oriQuestion: 'x'.repeat(129),
    })
  })
})

describe('formatHitsForModel metadata', () => {
  test('surfaces site, published date and authority when present', () => {
    const text = formatHitsForModel('q', [
      {
        title: 'T',
        url: 'https://example.com/a',
        snippet: 's',
        engine: 'deepseek',
        publishedDate: '2026-06-01T00:00:00+00:00',
        siteName: 'Example News',
        authority: 3,
      },
    ])
    expect(text).toContain('Site: Example News')
    expect(text).toContain('Published: 2026-06-01T00:00:00+00:00')
    expect(text).toContain('Authority: 3')
  })

  test('keeps the line unchanged when metadata is absent', () => {
    const text = formatHitsForModel('q', [{ title: 'T', url: 'https://example.com/a', snippet: 's' }])
    expect(text).toContain('Engine: unknown | QueryLang: unknown')
    expect(text).not.toContain('Site:')
  })
})
