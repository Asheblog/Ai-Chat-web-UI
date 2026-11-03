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

describe('runWebSearchParallel deepseek', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  it('includes deepseek as the fifth engine and allows a max of five', async () => {
    global.fetch = jest.fn(async (input) => {
      const url = String(input)
      if (url.includes('deepseek')) {
        return new Response(
          JSON.stringify({ results: [{ title: 'DS', url: 'https://ds.test/a', snippet: 'ds' }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(JSON.stringify({ results: [], web: { results: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch

    const result = await runWebSearchParallel({
      engines: ['tavily', 'brave', 'metaso', 'exa', 'deepseek'],
      engineOrder: ['tavily', 'brave', 'metaso', 'exa', 'deepseek'],
      apiKeys: { tavily: 'k', brave: 'k', metaso: 'k', exa: 'k', deepseek: 'k' },
      queries: [{ query: 'q', queryLanguage: 'en' }],
      limit: 5,
      parallelMaxEngines: 5,
      timeoutMs: 5000,
    })

    expect(result.tasks).toHaveLength(5)
    expect(result.tasks.map((task) => task.task.engine)).toContain('deepseek')
  })

  it('isolates a deepseek failure while other engines succeed', async () => {
    global.fetch = jest.fn(async (input) => {
      if (String(input).includes('deepseek')) {
        return new Response(JSON.stringify({ error: { message: 'secret upstream' } }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(
        JSON.stringify({ results: [{ title: 'T', url: 'https://tavily.test/a', content: 't' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as typeof fetch

    const result = await runWebSearchParallel({
      engines: ['tavily', 'deepseek'],
      engineOrder: ['tavily', 'deepseek'],
      apiKeys: { tavily: 'k', deepseek: 'k' },
      queries: [{ query: 'q', queryLanguage: 'en' }],
      limit: 5,
      parallelMaxEngines: 5,
      timeoutMs: 5000,
    })

    const deepseekTask = result.tasks.find((task) => task.task.engine === 'deepseek')
    const tavilyTask = result.tasks.find((task) => task.task.engine === 'tavily')
    expect(deepseekTask?.status).toBe('error')
    expect(deepseekTask?.error).not.toContain('secret upstream')
    expect(tavilyTask?.status).toBe('success')
    expect(result.hits).toHaveLength(1)
  })
})
