import {
  isArticleContent,
  mergeWebSearchParallelResults,
  runWebSearch,
  type WebSearchHit,
  type WebSearchParallelResult,
} from '../web-search'

const jsonResponse = (payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

const resultWithHit = (hit: WebSearchHit, engine: string): WebSearchParallelResult => ({
  hits: [hit],
  tasks: [
    {
      task: { engine, query: 'q', queryLanguage: 'zh', queryIndex: 0, taskIndex: 0 },
      status: 'success',
      hits: [hit],
    },
  ],
})

describe('search content provenance', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  test('Tavily marks raw_content as article and keeps the short field as snippet', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({
        results: [
          {
            title: 'Doc',
            url: 'https://example.com/doc',
            content: 'chunk summary text',
            raw_content: '# markdown body paragraph '.repeat(20),
          },
        ],
      }),
    ) as unknown as typeof fetch

    const hits = await runWebSearch('q', { engine: 'tavily', apiKey: 'k', limit: 3, includeRawContent: true })

    expect(hits[0].contentKind).toBe('article')
    expect(hits[0].contentSource).toBe('tavily')
    expect(hits[0].snippet).toBe('chunk summary text')
    expect(isArticleContent(hits[0])).toBe(true)
    expect(hits[0].contentMetadata?.chars).toBe((hits[0].content || '').length)
  })

  test('Tavily without raw_content stays a snippet and never counts as an article', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({
        results: [{ title: 'Doc', url: 'https://example.com/doc', content: 'only chunk text' }],
      }),
    ) as unknown as typeof fetch

    const hits = await runWebSearch('q', { engine: 'tavily', apiKey: 'k', limit: 3 })

    expect(hits[0].contentKind).toBe('snippet')
    expect(isArticleContent(hits[0])).toBe(false)
  })

  test('Exa separates text, summary and highlights instead of calling every field a body', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({
        results: [
          { title: 'A', url: 'https://example.com/a', text: 'full page text', highlights: ['excerpt one'] },
          { title: 'B', url: 'https://example.com/b', summary: 'llm summary only', highlights: ['excerpt two'] },
          { title: 'C', url: 'https://example.com/c', highlights: ['excerpt three'] },
        ],
      }),
    ) as unknown as typeof fetch

    const hits = await runWebSearch('q', { engine: 'exa', apiKey: 'k', limit: 3, includeRawContent: true, includeSummary: true })

    expect(hits[0]).toMatchObject({ contentKind: 'article', contentSource: 'exa', content: 'full page text' })
    expect(hits[1]).toMatchObject({ contentKind: 'summary', contentSource: 'exa', content: 'llm summary only' })
    expect(hits[2]).toMatchObject({ contentKind: 'highlight', contentSource: 'exa' })
    expect(isArticleContent(hits[1])).toBe(false)
    expect(isArticleContent(hits[2])).toBe(false)
  })

  test('Exa marks a body that hits the provider character cap as truncated', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({
        results: [
          { title: 'Capped', url: 'https://example.com/capped', text: 'x'.repeat(4000) },
          { title: 'Short', url: 'https://example.com/short', text: 'short body' },
        ],
      }),
    ) as unknown as typeof fetch

    const hits = await runWebSearch('q', { engine: 'exa', apiKey: 'k', limit: 3, includeRawContent: true })

    expect(hits[0].contentMetadata).toMatchObject({ truncated: true, maxChars: 4000 })
    expect(hits[1].contentMetadata?.truncated).toBeUndefined()
  })

  test('Brave snippets and Metaso descriptions stay snippet content', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({
        web: { results: [{ title: 'B', url: 'https://example.com/brave', description: 'main', extra_snippets: ['extra'] }] },
      }),
    ) as unknown as typeof fetch

    const braveHits = await runWebSearch('q', { engine: 'brave', apiKey: 'k', limit: 2 })
    expect(braveHits[0].contentKind).toBe('snippet')
    expect(braveHits[0].contentSource).toBe('brave')

    global.fetch = jest.fn(async () =>
      jsonResponse({ webpages: [{ title: 'M', url: 'https://example.com/metaso', summary: '描述摘要' }] }),
    ) as unknown as typeof fetch

    const metasoHits = await runWebSearch('q', { engine: 'metaso', apiKey: 'k', limit: 2, scope: 'webpage' })
    expect(metasoHits[0].contentKind).toBe('snippet')
    expect(isArticleContent(metasoHits[0])).toBe(false)
  })

  test('Metaso raw content is an article only when raw content was requested', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({ webpages: [{ title: 'M', url: 'https://example.com/metaso', content: '网页正文'.repeat(50) }] }),
    ) as unknown as typeof fetch

    const withRaw = await runWebSearch('q', { engine: 'metaso', apiKey: 'k', limit: 2, scope: 'webpage', includeRawContent: true })
    expect(withRaw[0].contentKind).toBe('article')

    global.fetch = jest.fn(async () =>
      jsonResponse({ webpages: [{ title: 'M', url: 'https://example.com/metaso', content: '网页正文'.repeat(50) }] }),
    ) as unknown as typeof fetch

    const withoutRaw = await runWebSearch('q', { engine: 'metaso', apiKey: 'k', limit: 2, scope: 'webpage' })
    expect(withoutRaw[0].contentKind).toBe('snippet')
  })

  test('DeepSeek page content keeps the deepseek source marker', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({
        results: [{ title: 'D', url: 'https://example.com/deepseek', snippet: '摘要', content: 'DeepSeek 返回的页面正文' }],
      }),
    ) as unknown as typeof fetch

    const hits = await runWebSearch('q', { engine: 'deepseek', apiKey: 'k', limit: 2, deepseekNeedContent: true })

    expect(hits[0].contentKind).toBe('article')
    expect(hits[0].contentSource).toBe('deepseek')
  })

  test('merge keeps the provider that delivered the body instead of upgrading another engine', () => {
    const tavily = resultWithHit(
      {
        title: 'Same',
        url: 'https://example.com/same',
        snippet: 'tavily snippet',
        content: 'tavily snippet',
        contentKind: 'snippet',
        contentSource: 'tavily',
        sourceEngines: ['tavily'],
        engine: 'tavily',
        rank: 1,
      },
      'tavily',
    )
    const exa = resultWithHit(
      {
        title: 'Same',
        url: 'https://example.com/same',
        snippet: 'exa highlight',
        content: 'exa full page text',
        contentKind: 'article',
        contentSource: 'exa',
        sourceEngines: ['exa'],
        engine: 'exa',
        rank: 1,
      },
      'exa',
    )

    const merged = mergeWebSearchParallelResults([tavily, exa], 5, ['tavily', 'exa'])
    const hit = merged.hits[0]

    expect(hit.content).toBe('exa full page text')
    expect(hit.contentKind).toBe('article')
    expect(hit.contentSource).toBe('exa')
    expect(hit.sourceEngines).toEqual(expect.arrayContaining(['tavily', 'exa']))
  })

  test('merge never promotes a summary to article just because another engine returned a snippet', () => {
    const exa = resultWithHit(
      {
        title: 'Same',
        url: 'https://example.com/summary',
        snippet: 'exa highlight',
        content: 'llm summary text',
        contentKind: 'summary',
        contentSource: 'exa',
        sourceEngines: ['exa'],
        engine: 'exa',
        rank: 1,
      },
      'exa',
    )
    const brave = resultWithHit(
      {
        title: 'Same',
        url: 'https://example.com/summary',
        snippet: 'brave description',
        content: 'brave description\n\nextra snippet',
        contentKind: 'snippet',
        contentSource: 'brave',
        sourceEngines: ['brave'],
        engine: 'brave',
        rank: 1,
      },
      'brave',
    )

    const merged = mergeWebSearchParallelResults([brave, exa], 5, ['brave', 'exa'])
    const hit = merged.hits[0]

    expect(hit.contentKind).toBe('summary')
    expect(hit.contentSource).toBe('exa')
    expect(hit.content).toBe('llm summary text')
    expect(isArticleContent(hit)).toBe(false)
  })

  test('merge prefers the longer body when two providers both delivered articles', () => {
    const short = resultWithHit(
      {
        title: 'Same',
        url: 'https://example.com/two-bodies',
        snippet: 's',
        content: 'short article',
        contentKind: 'article',
        contentSource: 'exa',
        sourceEngines: ['exa'],
        engine: 'exa',
        rank: 1,
      },
      'exa',
    )
    const long = resultWithHit(
      {
        title: 'Same',
        url: 'https://example.com/two-bodies',
        snippet: 's',
        content: 'a much longer article body from tavily',
        contentKind: 'article',
        contentSource: 'tavily',
        sourceEngines: ['tavily'],
        engine: 'tavily',
        rank: 1,
      },
      'tavily',
    )

    const merged = mergeWebSearchParallelResults([short, long], 5, ['exa', 'tavily'])
    expect(merged.hits[0].content).toBe('a much longer article body from tavily')
    expect(merged.hits[0].contentSource).toBe('tavily')
  })
})
