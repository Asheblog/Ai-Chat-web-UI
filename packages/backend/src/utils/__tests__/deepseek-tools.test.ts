import {
  DEEPSEEK_FETCH_ENDPOINT,
  DEEPSEEK_SEARCH_ENDPOINT,
  DeepSeekToolError,
  runDeepSeekFetch,
  runDeepSeekSearch,
} from '../deepseek-tools'

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })

describe.each([
  {
    tool: 'search',
    request: (options: { signal?: AbortSignal; timeoutMs?: number }) =>
      runDeepSeekSearch('q', { apiKey: 'k', limit: 2, ...options }),
  },
  {
    tool: 'fetch',
    request: (options: { signal?: AbortSignal; timeoutMs?: number }) =>
      runDeepSeekFetch('https://example.com/article', { apiKey: 'k', ...options }),
  },
])('DeepSeek $tool response body', ({ request }) => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  const mockPendingJsonBody = () => {
    let markBodyStarted: () => void = () => undefined
    const bodyStarted = new Promise<void>((resolve) => { markBodyStarted = resolve })
    global.fetch = jest.fn(async (_input, init) => {
      const response = jsonResponse({})
      jest.spyOn(response, 'json').mockImplementation(() => {
        markBodyStarted()
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('body consumption aborted'), { name: 'AbortError' }))
          }, { once: true })
        })
      })
      return response
    }) as typeof fetch
    return bodyStarted
  }

  it('preserves CANCELLED when the caller aborts after headers arrive', async () => {
    const bodyStarted = mockPendingJsonBody()
    const controller = new AbortController()
    const pending = request({ signal: controller.signal })
    await bodyStarted

    controller.abort()

    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' })
  })

  it('preserves TIMEOUT when the deadline expires after headers arrive', async () => {
    jest.useFakeTimers()
    const bodyStarted = mockPendingJsonBody()
    const pending = request({ timeoutMs: 1000 })
    await bodyStarted

    jest.advanceTimersByTime(1000)

    await expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' })
  })

  it('keeps malformed JSON classified as INVALID_RESPONSE', async () => {
    global.fetch = jest.fn(async () => new Response('invalid json', { status: 200 })) as typeof fetch

    await expect(request({})).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })
})

describe('runDeepSeekSearch', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  it('posts the documented request to the fixed endpoint and maps results', async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(DEEPSEEK_SEARCH_ENDPOINT)
      expect(init?.method).toBe('POST')
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer ds-key')
      expect(JSON.parse(String(init?.body))).toEqual({
        query: 'DeepSeek V4 发布',
        count: 5,
        need_content: true,
      })
      return jsonResponse({
        results: [
          {
            title: 'DeepSeek V4',
            url: 'https://example.com/news',
            snippet: '短摘要',
            summary: '长摘要',
            content: '完整正文',
            site_name: 'Example',
            site_icon: 'https://example.com/favicon.ico',
            date: '2026-06-01T00:00:00+00:00',
          },
        ],
      })
    }) as jest.MockedFunction<typeof fetch>
    global.fetch = fetchMock

    const hits = await runDeepSeekSearch('DeepSeek V4 发布', {
      apiKey: 'ds-key',
      limit: 5,
      includeRawContent: true,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({
      title: 'DeepSeek V4',
      url: 'https://example.com/news',
      snippet: '长摘要',
      content: '完整正文',
    })
    expect(hits[0].imageUrl).toBeUndefined()
    expect(hits[0].thumbnailUrl).toBeUndefined()
  })

  it('uses need_content only when raw content is requested for reuse', async () => {
    const bodies: any[] = []
    global.fetch = jest.fn(async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)))
      return jsonResponse({ results: [] })
    }) as typeof fetch

    await runDeepSeekSearch('q', { apiKey: 'k', limit: 2 })
    await runDeepSeekSearch('q', { apiKey: 'k', limit: 2, includeRawContent: true })

    expect(bodies[0].need_content).toBe(false)
    expect(bodies[1].need_content).toBe(true)
  })

  it('rejects queries longer than 128 Unicode code points without truncating or calling upstream', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>
    global.fetch = fetchMock

    await expect(
      runDeepSeekSearch('中'.repeat(129), { apiKey: 'k', limit: 3 }),
    ).rejects.toMatchObject({ code: 'INVALID_QUERY' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects image scope instead of silently searching the web', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>
    global.fetch = fetchMock

    await expect(
      runDeepSeekSearch('news image', { apiKey: 'k', limit: 3, scope: 'image' }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_SCOPE' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('filters result URLs by exact domain or subdomain', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({
        results: [
          { title: 'root', url: 'https://example.com/a' },
          { title: 'sub', url: 'https://docs.example.com/b' },
          { title: 'suffix', url: 'https://notexample.com/c' },
          { title: 'evil', url: 'https://example.com.evil.test/d' },
          { title: 'invalid', url: 'javascript:alert(1)' },
        ],
      }),
    ) as typeof fetch

    const hits = await runDeepSeekSearch('q', {
      apiKey: 'k',
      limit: 10,
      domains: ['example.com'],
    })

    expect(hits.map((hit) => hit.url)).toEqual([
      'https://example.com/a',
      'https://docs.example.com/b',
    ])
  })

  it('keeps empty summary and content as fallbacks without inventing evidence', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({
        results: [
          { title: 'No body', url: 'https://example.com/empty', snippet: 's', summary: '', content: '' },
        ],
      }),
    ) as typeof fetch

    const hits = await runDeepSeekSearch('q', { apiKey: 'k', limit: 2 })

    expect(hits[0].snippet).toBe('s')
    expect(hits[0].content).toBeUndefined()
  })

  it('maps upstream errors without leaking the upstream body, key, or request URL', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse(
        {
          error: {
            message: 'invalid api key sk-secret-upstream',
            type: 'invalid_request_error',
            code: 'invalid_request_error',
          },
        },
        401,
      ),
    ) as typeof fetch

    const error = await runDeepSeekSearch('q', { apiKey: 'sk-local-key', limit: 2 }).catch(
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(DeepSeekToolError)
    expect(error).toMatchObject({ code: 'HTTP_401', status: 401 })
    expect((error as Error).message).not.toContain('sk-secret-upstream')
    expect((error as Error).message).not.toContain('sk-local-key')
  })

  it('honours cancellation', async () => {
    const controller = new AbortController()
    global.fetch = jest.fn((_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        })
      }),
    ) as typeof fetch

    const pending = runDeepSeekSearch('q', { apiKey: 'k', limit: 2, signal: controller.signal })
    controller.abort()

    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' })
  })

  it('rejects a 200 response with a malformed results payload', async () => {
    global.fetch = jest.fn(async () => jsonResponse({ results: 'nope' })) as typeof fetch

    await expect(
      runDeepSeekSearch('q', { apiKey: 'k', limit: 2 }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('aborts an in-flight request when the caller signal fires', async () => {
    let receivedSignal: AbortSignal | undefined
    global.fetch = jest.fn(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          receivedSignal = init?.signal ?? undefined
          init?.signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          })
        }),
    ) as typeof fetch
    const controller = new AbortController()

    const pending = runDeepSeekSearch('q', { apiKey: 'k', limit: 2, signal: controller.signal })
    controller.abort()

    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(receivedSignal?.aborted).toBe(true)
  })

  it('passes the caller signal through without an extra local abort race', async () => {
    let receivedSignal: AbortSignal | undefined
    global.fetch = jest.fn(async (_input, init) => {
      receivedSignal = init?.signal ?? undefined
      return jsonResponse({ results: [] })
    }) as typeof fetch
    const controller = new AbortController()

    await runDeepSeekSearch('q', { apiKey: 'k', limit: 2, signal: controller.signal })

    expect(receivedSignal).toBeInstanceOf(AbortSignal)
    expect(receivedSignal?.aborted).toBe(false)
  })

  it('does not forward a global endpoint override', async () => {
    const fetchMock = jest.fn(async () => jsonResponse({ results: [] })) as jest.MockedFunction<typeof fetch>
    global.fetch = fetchMock

    await runDeepSeekSearch('q', { apiKey: 'k', limit: 2 })

    expect(String(fetchMock.mock.calls[0][0])).toBe(DEEPSEEK_SEARCH_ENDPOINT)
  })
})

describe('runDeepSeekFetch', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  it('posts the URL to the fixed fetch endpoint and returns Markdown content', async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(DEEPSEEK_FETCH_ENDPOINT)
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer ds-key')
      expect(JSON.parse(String(init?.body))).toEqual({ url: 'https://example.com/article' })
      return jsonResponse({ title: 'Article', content: '# Article\n\nBody' })
    }) as jest.MockedFunction<typeof fetch>
    global.fetch = fetchMock

    const result = await runDeepSeekFetch('https://example.com/article', { apiKey: 'ds-key' })

    expect(result).toEqual({ title: 'Article', content: '# Article\n\nBody' })
  })

  it('treats a 200 response with empty content as an explicit failure', async () => {
    global.fetch = jest.fn(async () => jsonResponse({ title: 'Empty', content: '   ' })) as typeof fetch

    await expect(
      runDeepSeekFetch('https://example.com/empty', { apiKey: 'k' }),
    ).rejects.toMatchObject({ code: 'EMPTY_CONTENT' })
  })

  it('rejects private and credentialed URLs before calling upstream', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>
    global.fetch = fetchMock

    await expect(
      runDeepSeekFetch('http://127.0.0.1:3000/secret', { apiKey: 'k' }),
    ).rejects.toMatchObject({ code: 'DISALLOWED_URL' })
    await expect(
      runDeepSeekFetch('https://user:pass@example.com/a', { apiKey: 'k' }),
    ).rejects.toMatchObject({ code: 'INVALID_URL' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    'http://[::1]/',
    'http://[fc00::1]/',
    'http://[fe80::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:7f00:1]/',
    'http://[0:0:0:0:0:0:0:1]/',
  ])('rejects private IPv6 fetch target %s before calling upstream', async (target) => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>
    global.fetch = fetchMock

    await expect(runDeepSeekFetch(target, { apiKey: 'k' })).rejects.toMatchObject({
      code: 'DISALLOWED_URL',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps 429 without exposing upstream text', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({ error: { message: 'upstream details not for clients' } }, 429),
    ) as typeof fetch

    const error = await runDeepSeekFetch('https://example.com/a', { apiKey: 'k' }).catch(
      (caught: unknown) => caught,
    )
    expect(error).toMatchObject({ code: 'HTTP_429', status: 429 })
    expect((error as Error).message).not.toContain('upstream details')
  })

  it('rejects malformed 200 responses and oversized URLs', async () => {
    global.fetch = jest.fn(async () => jsonResponse({ title: 'x', content: 42 })) as typeof fetch
    await expect(
      runDeepSeekFetch('https://example.com/a', { apiKey: 'k' }),
    ).rejects.toMatchObject({ code: 'EMPTY_CONTENT' })

    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>
    global.fetch = fetchMock
    await expect(
      runDeepSeekFetch(`https://example.com/${'a'.repeat(9000)}`, { apiKey: 'k' }),
    ).rejects.toMatchObject({ code: 'INVALID_URL' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('times out instead of hanging when upstream never responds', async () => {
    global.fetch = jest.fn(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          })
        }),
    ) as typeof fetch

    await expect(
      runDeepSeekFetch('https://example.com/slow', { apiKey: 'k', timeoutMs: 1000 }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' })
  }, 5000)
})
