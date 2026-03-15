import {
  mergeWebSearchParallelResults,
  runWebSearchParallel,
  type WebSearchParallelResult,
} from '../web-search'

describe('runWebSearchParallel queryPlans', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  it('runs only planned query-engine tasks instead of full cartesian product', async () => {
    global.fetch = jest.fn(async (_input, init) => {
      const headers = init?.headers as Record<string, string> | undefined
      if (headers?.Authorization) {
        return new Response(
          JSON.stringify({
            results: [{ title: 'Metaso Hit', url: 'https://metaso.test/a', summary: 'm' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (headers?.['X-Subscription-Token']) {
        return new Response(
          JSON.stringify({
            web: { results: [{ title: 'Brave Hit', url: 'https://brave.test/b', description: 'b' }] },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(
        JSON.stringify({
          results: [{ title: 'Tavily Hit', url: 'https://tavily.test/c', content: 't' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as typeof fetch

    const result = await runWebSearchParallel({
      engines: ['tavily', 'brave', 'metaso'],
      engineOrder: ['tavily', 'brave', 'metaso'],
      apiKeys: {
        tavily: 'k1',
        brave: 'k2',
        metaso: 'k3',
      },
      queries: [
        { query: 'q-zh', queryLanguage: 'zh' },
        { query: 'q-en', queryLanguage: 'en' },
      ],
      queryPlans: [
        { query: 'q-zh', queryLanguage: 'zh', engines: ['metaso', 'tavily'] },
        { query: 'q-en', queryLanguage: 'en', engines: ['tavily'] },
      ],
      limit: 5,
      parallelMaxEngines: 3,
      timeoutMs: 5000,
    })

    expect(result.tasks).toHaveLength(3)
    expect(result.tasks.map((item) => item.task.engine)).toEqual(['metaso', 'tavily', 'tavily'])
    expect(result.tasks.map((item) => item.task.query)).toEqual(['q-zh', 'q-zh', 'q-en'])
  })
})

describe('mergeWebSearchParallelResults', () => {
  it('merges task hits across rounds and preserves source engines', () => {
    const round1: WebSearchParallelResult = {
      hits: [],
      tasks: [
        {
          task: {
            engine: 'metaso',
            query: 'q',
            queryLanguage: 'zh',
            queryIndex: 0,
            taskIndex: 0,
          },
          status: 'success',
          hits: [
            {
              title: 'Same URL',
              url: 'https://example.com/news?a=1&utm_source=test',
              snippet: 'metaso snippet',
              engine: 'metaso',
              rank: 1,
            },
          ],
        },
      ],
    }

    const round2: WebSearchParallelResult = {
      hits: [],
      tasks: [
        {
          task: {
            engine: 'tavily',
            query: 'q',
            queryLanguage: 'zh',
            queryIndex: 0,
            taskIndex: 0,
          },
          status: 'success',
          hits: [
            {
              title: 'Same URL Better',
              url: 'https://example.com/news?a=1',
              snippet: 'tavily snippet with more details',
              engine: 'tavily',
              rank: 1,
            },
          ],
        },
      ],
    }

    const merged = mergeWebSearchParallelResults([round1, round2], 5, ['tavily', 'metaso'])

    expect(merged.tasks).toHaveLength(2)
    expect(merged.hits).toHaveLength(1)
    expect(merged.hits[0].sourceEngines).toEqual(['metaso', 'tavily'])
    expect(merged.hits[0].snippet).toContain('more details')
  })
})
