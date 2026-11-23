import { runWebSearchParallel } from '../web-search'

const apiKeys = { tavily: 'tv', brave: 'br', metaso: 'mt', exa: 'ex' }

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })

const run = (overrides: Record<string, unknown> = {}) =>
  runWebSearchParallel({
    engines: ['tavily'],
    apiKeys,
    queries: [{ query: 'q', queryLanguage: 'en' }],
    limit: 5,
    timeoutMs: 2000,
    ...overrides,
  } as any)

describe('runWebSearchParallel 任务失败分类', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  test('HTTP 5xx 归为 upstream_error 并保留状态码', async () => {
    global.fetch = jest.fn(async () => new Response('boom', { status: 503 })) as any
    const result = await run()
    expect(result.tasks[0]).toMatchObject({
      status: 'error',
      failureKind: 'upstream_error',
      errorCode: 'HTTP_503',
      httpStatus: 503,
    })
  })

  test('429 归为 rate_limited 并带 Retry-After 毫秒数', async () => {
    global.fetch = jest.fn(async () =>
      new Response('slow down', { status: 429, headers: { 'retry-after': '2' } })) as any
    const result = await run()
    expect(result.tasks[0]).toMatchObject({
      failureKind: 'rate_limited',
      httpStatus: 429,
      retryAfterMs: 2000,
    })
  })

  test('请求级取消归为 cancelled，而不是 upstream_error', async () => {
    global.fetch = jest.fn((_input: any, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const fail = () => reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }))
      if (init?.signal?.aborted) return fail()
      init?.signal?.addEventListener('abort', fail, { once: true })
    })) as any
    const controller = new AbortController()
    controller.abort()
    const result = await run({ signal: controller.signal })
    expect(result.tasks[0]).toMatchObject({ failureKind: 'cancelled' })
  })

  test('子任务超时归为 timeout', async () => {
    global.fetch = jest.fn((_input: any, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const fail = () => reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }))
      if (init?.signal?.aborted) return fail()
      init?.signal?.addEventListener('abort', fail, { once: true })
    })) as any
    const result = await run({ timeoutMs: 1000 })
    expect(result.tasks[0]).toMatchObject({ status: 'error', failureKind: 'timeout' })
  })

  test('网络层失败归为 network', async () => {
    global.fetch = jest.fn(async () => { throw new TypeError('fetch failed') }) as any
    const result = await run()
    expect(result.tasks[0]).toMatchObject({ failureKind: 'network', errorCode: 'FETCH_FAILED' })
  })
})

describe('runWebSearchParallel 时间窗下发', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  test('Tavily 使用 start_date/end_date', async () => {
    let body: any
    global.fetch = jest.fn(async (_input: any, init?: RequestInit) => {
      body = JSON.parse(String(init?.body || '{}'))
      return jsonResponse({ results: [] })
    }) as any
    const result = await run({ timeRange: { start: '2026-01-01', end: '2026-01-31' } })
    expect(body).toMatchObject({ start_date: '2026-01-01', end_date: '2026-01-31' })
    expect(result.tasks[0].timeRangeApplied).toBe(true)
  })

  test('Brave 只在双边齐全时使用 freshness', async () => {
    const urls: string[] = []
    global.fetch = jest.fn(async (input: any) => {
      urls.push(String(input))
      return jsonResponse({ web: { results: [] } })
    }) as any
    await run({
      engines: ['brave'],
      queries: [{ query: 'q', queryLanguage: 'en' }],
      timeRange: { start: '2026-01-01', end: '2026-01-31' },
    })
    expect(urls[0]).toContain('freshness=2026-01-01to2026-01-31')

    urls.length = 0
    const single = await run({
      engines: ['brave'],
      queries: [{ query: 'q', queryLanguage: 'en' }],
      timeRange: { start: '2026-01-01' },
    })
    expect(urls[0]).not.toContain('freshness=')
    expect(single.tasks[0].timeRangeApplied).toBe(false)
  })

  test('Exa 使用 startPublishedDate/endPublishedDate', async () => {
    let body: any
    global.fetch = jest.fn(async (_input: any, init?: RequestInit) => {
      body = JSON.parse(String(init?.body || '{}'))
      return jsonResponse({ results: [] })
    }) as any
    const result = await run({
      engines: ['exa'],
      queries: [{ query: 'q', queryLanguage: 'en' }],
      timeRange: { start: '2026-01-01' },
    })
    expect(body.startPublishedDate).toBe('2026-01-01T00:00:00.000Z')
    expect(body).not.toHaveProperty('endPublishedDate')
    expect(result.tasks[0].timeRangeApplied).toBe(true)
  })

  test('Metaso 没有文档参数：timeRangeApplied=false 且不改请求体', async () => {
    let body: any
    global.fetch = jest.fn(async (_input: any, init?: RequestInit) => {
      body = JSON.parse(String(init?.body || '{}'))
      return jsonResponse({ webpages: [] })
    }) as any
    const result = await run({
      engines: ['metaso'],
      queries: [{ query: 'q', queryLanguage: 'zh' }],
      timeRange: { start: '2026-01-01', end: '2026-01-31' },
    })
    expect(body).not.toHaveProperty('start_date')
    expect(result.tasks[0].timeRangeApplied).toBe(false)
  })

  test('不带时间窗时请求体保持原样', async () => {
    let body: any
    global.fetch = jest.fn(async (_input: any, init?: RequestInit) => {
      body = JSON.parse(String(init?.body || '{}'))
      return jsonResponse({ results: [] })
    }) as any
    const result = await run()
    expect(body).not.toHaveProperty('start_date')
    expect(result.tasks[0].timeRangeApplied).toBeUndefined()
  })
})
