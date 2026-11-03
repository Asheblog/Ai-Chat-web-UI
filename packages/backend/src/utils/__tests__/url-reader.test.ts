import { readUrlContent, formatUrlContentForModel } from '../url-reader'
import { Readability } from '@mozilla/readability'
import { DEEPSEEK_FETCH_ENDPOINT } from '../deepseek-tools'
import * as deepseekTools from '../deepseek-tools'
import * as browserExecutable from '../browser-executable'
import { chromium } from 'playwright-core'

jest.mock('playwright-core', () => ({ chromium: { launch: jest.fn() } }))

describe('readUrlContent shared deadline and cancellation', () => {
  const originalFetch = global.fetch
  const unavailable = () => new Response('unavailable', {
    status: 403,
    headers: { 'content-type': 'text/html' },
  })
  const options = { enableBrowser: false, enableDeepseekFallback: true, deepseekApiKey: 'test-key', timeout: 1000 }

  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  test.each(['native', 'crawler', 'feed', 'google_cache', 'wayback'])(
    'stops %s cancellation immediately without another fallback request', async (stage) => {
      const controller = new AbortController()
      let articleRequests = 0
      let cancelledAt = 0
      let activeSignal: AbortSignal | undefined
      const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const address = String(input)
        if (address === 'https://example.com/article') articleRequests++
        const shouldCancel = cancelledAt === 0 && (
          (stage === 'native' && articleRequests === 1) ||
          (stage === 'crawler' && articleRequests === 2) ||
          (stage === 'feed' && address.endsWith('/rss/')) ||
          (stage === 'google_cache' && address.includes('webcache.googleusercontent.com')) ||
          (stage === 'wayback' && address.includes('archive.org/wayback/available'))
        )
        if (shouldCancel) {
          activeSignal = init?.signal || undefined
          cancelledAt = fetchMock.mock.calls.length
          controller.abort()
          throw new DOMException('caller stopped', 'AbortError')
        }
        return unavailable()
      })
      global.fetch = fetchMock as typeof fetch

      const result = await readUrlContent('https://example.com/article', { ...options, signal: controller.signal })

      expect(result.errorCode).toBe('CANCELLED')
      expect(activeSignal?.aborted).toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(cancelledAt)
    },
  )

  test('cancels Wayback JSON body consumption without fetching the snapshot', async () => {
    const controller = new AbortController()
    let checkSignal: AbortSignal | undefined
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('archive.org/wayback/available')) {
        checkSignal = init?.signal || undefined
        return { ok: true, json: async () => {
          controller.abort()
          throw new DOMException('body cancelled', 'AbortError')
        } } as Response
      }
      return unavailable()
    })
    global.fetch = fetchMock as typeof fetch

    const result = await readUrlContent('https://example.com/article', { ...options, signal: controller.signal })

    expect(result.errorCode).toBe('CANCELLED')
    expect(checkSignal?.aborted).toBe(true)
    expect(fetchMock.mock.calls.some(([input]) => String(input) === DEEPSEEK_FETCH_ENDPOINT)).toBe(false)
  })

  test.each(['cancel', 'deadline'])('stops the Wayback rate limit wait on %s', async (stop) => {
    const controller = new AbortController()
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('archive.org/wayback/available')) {
        return new Response(JSON.stringify({ archived_snapshots: { closest: {
          available: true, url: 'https://web.archive.org/snapshot',
        } } }), { headers: { 'content-type': 'application/json' } })
      }
      return unavailable()
    })
    global.fetch = fetchMock as typeof fetch
    const pending = readUrlContent('https://example.com/article', { ...options, signal: controller.signal })
    await jest.advanceTimersByTimeAsync(0)
    const requestsBeforeStop = fetchMock.mock.calls.length
    if (stop === 'cancel') controller.abort()
    await jest.advanceTimersByTimeAsync(1200)
    const result = await pending

    expect(result.errorCode).toBe(stop === 'cancel' ? 'CANCELLED' : 'TIMEOUT')
    expect(fetchMock).toHaveBeenCalledTimes(requestsBeforeStop)
  })

  test('browser cancellation closes resources and releases a pending navigation', async () => {
    const controller = new AbortController()
    const context = {
      newPage: jest.fn(),
      close: jest.fn(async () => undefined),
    }
    const browser = { newContext: jest.fn(async () => context), close: jest.fn(async () => undefined) }
    const page = {
      route: jest.fn(async () => undefined),
      goto: jest.fn(() => { controller.abort(); return new Promise(() => undefined) }),
    }
    context.newPage.mockResolvedValue(page)
    jest.spyOn(browserExecutable, 'resolveBrowserExecutablePath').mockReturnValue('mock-chromium')
    jest.spyOn(chromium, 'launch').mockResolvedValue(browser as never)
    const fetchMock = jest.fn(async (_input: RequestInfo | URL) => unavailable())
    global.fetch = fetchMock as typeof fetch
    let result: Awaited<ReturnType<typeof readUrlContent>> | undefined
    void readUrlContent('https://example.com/article', { ...options, enableBrowser: true, signal: controller.signal })
      .then((value) => { result = value })
    await jest.advanceTimersByTimeAsync(0)

    expect(result?.errorCode).toBe('CANCELLED')
    expect(context.close).toHaveBeenCalledTimes(1)
    expect(browser.close).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('webcache.'))).toBe(false)
  })

  test('native timeout exhausts the overall deadline and starts no fallback', async () => {
    const fetchMock = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (fetchMock.mock.calls.length > 1) return Promise.resolve(unavailable())
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('deadline', 'AbortError')), { once: true })
      })
    })
    global.fetch = fetchMock as typeof fetch
    const pending = readUrlContent('https://example.com/article', options)
    await jest.advanceTimersByTimeAsync(1000)
    const result = await pending

    expect(result.errorCode).toBe('TIMEOUT')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('passes only the remaining time to DeepSeek Fetch after local attempts', async () => {
    let first = true
    global.fetch = jest.fn(async () => {
      if (first) { first = false; jest.setSystemTime(Date.now() + 800) }
      return unavailable()
    }) as typeof fetch
    const fetchTool = jest.spyOn(deepseekTools, 'runDeepSeekFetch').mockResolvedValue({ title: 'Fetched', content: 'page content' })

    const result = await readUrlContent('https://example.com/article', options)

    expect(result.engine).toBe('deepseek_fetch')
    expect(fetchTool).toHaveBeenCalledWith('https://example.com/article', expect.objectContaining({ timeoutMs: 200 }))
  })

  test('does not start any fallback when local processing has already used the deadline', async () => {
    global.fetch = jest.fn(async () => {
      jest.setSystemTime(Date.now() + 1001)
      return unavailable()
    }) as typeof fetch
    const fetchTool = jest.spyOn(deepseekTools, 'runDeepSeekFetch').mockResolvedValue({ title: 'Fetched', content: 'page content' })

    const result = await readUrlContent('https://example.com/article', options)

    expect(result.errorCode).toBe('TIMEOUT')
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(fetchTool).not.toHaveBeenCalled()
  })

  test.each(['cancel', 'deadline'])('keeps the overall %s error when Fetch body is still pending', async (stop) => {
    const controller = new AbortController()
    let first = true
    let fetchSignal: AbortSignal | undefined
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (first) { first = false; await new Promise((resolve) => setTimeout(resolve, 800)) }
      if (String(input) === DEEPSEEK_FETCH_ENDPOINT) {
        fetchSignal = init?.signal || undefined
        return { ok: true, json: () => new Promise((_resolve, reject) => {
          fetchSignal?.addEventListener('abort', () => reject(new DOMException('body stopped', 'AbortError')), { once: true })
        }) } as Response
      }
      return unavailable()
    }) as typeof fetch
    const pending = readUrlContent('https://example.com/article', { ...options, signal: controller.signal })
    let settled = false
    void pending.then(() => { settled = true })
    await jest.advanceTimersByTimeAsync(800)
    expect(fetchSignal).toBeDefined()
    if (stop === 'cancel') controller.abort()
    if (stop === 'deadline') {
      await jest.advanceTimersByTimeAsync(199)
      expect(settled).toBe(false)
    }
    await jest.advanceTimersByTimeAsync(stop === 'cancel' ? 0 : 1)
    expect(settled).toBe(true)
    const result = await pending

    expect(result.errorCode).toBe(stop === 'cancel' ? 'CANCELLED' : 'TIMEOUT')
    expect(result.attempts?.at(-1)).toMatchObject({ engine: 'deepseek_fetch', status: 'error', errorCode: result.errorCode })
  })
})

describe('readUrlContent error classification', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  test('classifies 403 challenge page as JS_CHALLENGE', async () => {
    global.fetch = jest.fn(async () =>
      new Response('<html><title>Just a moment...</title>cf-chl-bypass</html>', {
        status: 403,
        statusText: 'Forbidden',
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    ) as typeof fetch

    const result = await readUrlContent('https://example.com/news')

    expect(result.errorCode).toBe('JS_CHALLENGE')
    expect(result.httpStatus).toBe(403)
  })

  test('classifies robots denied body as ROBOTS_DENIED', async () => {
    global.fetch = jest.fn(async () =>
      new Response('<html>blocked by robots policy</html>', {
        status: 403,
        statusText: 'Forbidden',
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    ) as typeof fetch

    const result = await readUrlContent('https://example.com/blocked')

    expect(result.errorCode).toBe('ROBOTS_DENIED')
    expect(result.httpStatus).toBe(403)
  })

  test('classifies dynamic challenge body with 200 status as JS_CHALLENGE', async () => {
    global.fetch = jest.fn(async () =>
      new Response('<html><body>Please enable JavaScript to continue</body></html>', {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    ) as typeof fetch

    const result = await readUrlContent('https://example.com/challenge')

    expect(result.errorCode).toBe('JS_CHALLENGE')
    expect(result.error).toContain('JavaScript challenge')
  })

  test('falls back to same-origin feed entry when article page is behind JS challenge', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const requestUrl = String(input)
      if (requestUrl.endsWith('/rss/')) {
        return new Response(
          `
          <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
            <channel>
              <title>Cloudflare Blog</title>
              <item>
                <title>Cyber Frontier Models</title>
                <link>https://blog.cloudflare.com/cyber-frontier-models/</link>
                <pubDate>Tue, 19 May 2026 01:00:00 GMT</pubDate>
                <content:encoded><![CDATA[
                  <article>
                    <p>Cyber Frontier Models 是一篇用于验证同源 RSS 兜底的文章正文。</p>
                    <p>即使原始页面返回 JavaScript challenge，也应该从站点自己的 feed 中稳定提取全文内容。</p>
                  </article>
                ]]></content:encoded>
              </item>
            </channel>
          </rss>
          `,
          {
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/rss+xml; charset=utf-8' },
          },
        )
      }
      return new Response('<html><title>Just a moment...</title><body>cf-chl-bypass</body></html>', {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    }) as typeof fetch

    const result = await readUrlContent('https://blog.cloudflare.com/cyber-frontier-models/')

    expect(result.error).toBeUndefined()
    expect(result.engine).toBe('feed')
    expect(result.fallbackUsed).toBe('document')
    expect(result.contentFormat).toBe('feed')
    expect(result.textContent).toContain('Cyber Frontier Models 是一篇用于验证同源 RSS 兜底的文章正文')
    expect(result.attempts?.some((attempt) => attempt.engine === 'feed' && attempt.status === 'success')).toBe(true)
  })

  test('falls back to crawler extraction when readability parsing returns null', async () => {
    global.fetch = jest.fn(async () =>
      new Response(
        `
        <html>
          <head><title>Example Article</title></head>
          <body>
            <main>
              <p>第一段：这是正文内容，不应该在回退时丢失。</p>
              <p>第二段：当 Readability 失败后，爬虫应提取这里的文本。</p>
            </main>
          </body>
        </html>
        `,
        {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }
      )
    ) as typeof fetch

    jest.spyOn(Readability.prototype, 'parse').mockReturnValue(null)

    const result = await readUrlContent('https://example.com/fallback')

    expect(result.error).toBeUndefined()
    expect(result.errorCode).toBeUndefined()
    expect(result.fallbackUsed).toBe('crawler')
    expect(result.textContent).toContain('第一段：这是正文内容')
    expect(result.textContent).toContain('第二段：当 Readability 失败后')
  })

  test('extracts lead image and content images when available', async () => {
    global.fetch = jest.fn(async () =>
      new Response(
        `
        <html>
          <head>
            <title>Image Article</title>
            <meta property="og:image" content="/cover.jpg" />
          </head>
          <body>
            <main>
              <p>这是一个用于测试图片提取的正文段落，长度足够让正文提取逻辑判定为有效内容。</p>
              <p>第二段继续补充信息，确保在 Readability 或回退提取中都能得到可用文本。</p>
              <img src="/images/a.png" alt="图A" width="640" height="360" />
              <img src="https://cdn.example.com/b.webp" alt="图B" />
            </main>
          </body>
        </html>
        `,
        {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'text/html; charset=utf-8' },
        },
      )
    ) as typeof fetch

    const result = await readUrlContent('https://example.com/article')

    expect(result.error).toBeUndefined()
    expect(result.leadImageUrl).toBe('https://example.com/cover.jpg')
    expect(Array.isArray(result.images)).toBe(true)
    expect(result.images?.[0]?.url).toBe('https://example.com/cover.jpg')
    expect(
      result.images?.some(
        (item) =>
          item.url === 'https://example.com/images/a.png' ||
          item.url === 'https://cdn.example.com/b.webp',
      ),
    ).toBe(true)
  })

  test('includes image evidence section in formatted model output', () => {
    const formatted = formatUrlContentForModel({
      title: 'Image Article',
      url: 'https://example.com/article',
      content: '',
      textContent: '这是一段正文内容。',
      wordCount: 8,
      fallbackUsed: 'none',
      leadImageUrl: 'https://example.com/cover.jpg',
      images: [
        {
          url: 'https://example.com/cover.jpg',
          source: 'meta',
        },
        {
          url: 'https://example.com/images/a.png',
          alt: '图A',
          source: 'content',
        },
      ],
    })

    expect(formatted).toContain('## 图片证据')
    expect(formatted).toContain('主图')
    expect(formatted).toContain('https://example.com/cover.jpg')
    expect(formatted).toContain('https://example.com/images/a.png')
  })

  test('supports direct image URL responses', async () => {
    global.fetch = jest.fn(async () =>
      new Response(Buffer.from('fake-image-binary'), {
        status: 200,
        statusText: 'OK',
        headers: {
          'content-type': 'image/png',
          'content-length': '17',
        },
      })
    ) as typeof fetch

    const result = await readUrlContent('https://example.com/image.png')

    expect(result.error).toBeUndefined()
    expect(result.resourceType).toBe('image')
    expect(result.contentType).toBe('image/png')
    expect(result.contentLength).toBe(17)
    expect(result.leadImageUrl).toBe('https://example.com/image.png')
    expect(result.images?.[0]?.source).toBe('direct')
  })

  test('filters private image URLs extracted from html', async () => {
    global.fetch = jest.fn(async () =>
      new Response(
        `
        <html>
          <head>
            <title>Unsafe Images</title>
            <meta property="og:image" content="http://127.0.0.1/lead.png" />
          </head>
          <body>
            <main>
              <p>这段正文足够长，确保页面会被成功提取而不是提前失败。</p>
              <p>第二段补充内容，避免正文长度不足触发空内容逻辑。</p>
              <img src="http://localhost/a.png" alt="内网图" />
              <img src="https://cdn.example.com/public.png" alt="公网图" />
            </main>
          </body>
        </html>
        `,
        {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'text/html; charset=utf-8' },
        },
      )
    ) as typeof fetch

    const result = await readUrlContent('https://example.com/article')

    expect(result.error).toBeUndefined()
    expect(result.leadImageUrl).toBe('https://cdn.example.com/public.png')
    expect(result.images).toEqual([
      expect.objectContaining({
        url: 'https://cdn.example.com/public.png',
      }),
    ])
  })

  test('does not treat 172.2.x.x as private network and allows fetching', async () => {
    global.fetch = jest.fn(async () =>
      new Response(
        `
        <html>
          <head><title>Public IP Article</title></head>
          <body>
            <main>
              <p>这是一段足够长的正文内容，用于验证 172.2 网段不会被误判为私网并被拦截。</p>
              <p>第二段补充文本，确保正文提取稳定通过最小长度阈值。</p>
            </main>
          </body>
        </html>
        `,
        {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'text/html; charset=utf-8' },
        },
      ),
    ) as typeof fetch

    const result = await readUrlContent('http://172.2.1.2/article')

    expect(result.error).toBeUndefined()
    expect(result.errorCode).toBeUndefined()
    expect(global.fetch).toHaveBeenCalled()
  })

  test('transforms medium URL to scribe.rip before fetching', async () => {
    const fetchMock = jest.fn(async () =>
      new Response(
        `
        <html>
          <head><title>Medium Mirror</title></head>
          <body>
            <article>
              <p>第一段用于验证 URL 改写逻辑生效，内容长度足够通过正文提取。</p>
              <p>第二段继续补齐文本，保证测试稳定。</p>
            </article>
          </body>
        </html>
        `,
        {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'text/html; charset=utf-8' },
        },
      ),
    ) as typeof fetch
    global.fetch = fetchMock

    const result = await readUrlContent('https://medium.com/someone/some-post')

    expect(result.error).toBeUndefined()
    expect(fetchMock).toHaveBeenCalled()
    const firstCallUrl = String(fetchMock.mock.calls[0]?.[0] ?? '')
    expect(firstCallUrl).toBe('https://scribe.rip/someone/some-post')
  })

  test('uses final redirected URL as base for relative assets', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        new Response('', {
          status: 302,
          headers: { location: 'https://example.com/news/final' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          `
          <html>
            <head>
              <title>Redirected Article</title>
              <meta property="og:image" content="/assets/cover.jpg" />
            </head>
            <body>
              <article>
                <p>重定向后的页面正文内容足够长，用于验证相对资源基于最终地址解析。</p>
                <p>第二段继续提供正文，让提取器稳定得到可读文本。</p>
              </article>
            </body>
          </html>
          `,
          {
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
          },
        ),
      ) as unknown as typeof fetch
    global.fetch = fetchMock

    const result = await readUrlContent('https://example.com/news/start')

    expect(result.error).toBeUndefined()
    expect(result.url).toBe('https://example.com/news/start')
    expect(result.finalUrl).toBe('https://example.com/news/final')
    expect(result.leadImageUrl).toBe('https://example.com/assets/cover.jpg')
    expect(result.attempts?.some((attempt) => attempt.status === 'success')).toBe(true)
  })

  test('reads JSON responses as structured text', async () => {
    global.fetch = jest.fn(async () =>
      new Response(JSON.stringify({ title: 'API result', items: [{ id: 1, value: 'alpha' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      }),
    ) as typeof fetch

    const result = await readUrlContent('https://example.com/api/data')

    expect(result.error).toBeUndefined()
    expect(result.resourceType).toBe('text')
    expect(result.contentFormat).toBe('json')
    expect(result.textContent).toContain('"title": "API result"')
  })

  test('reads RSS feed entries as feed content', async () => {
    global.fetch = jest.fn(async () =>
      new Response(
        `
        <rss version="2.0">
          <channel>
            <title>Example Feed</title>
            <item>
              <title>第一条新闻</title>
              <link>https://example.com/a</link>
              <description>这里是第一条新闻的摘要内容，长度足够用于验证 feed 提取。</description>
            </item>
            <item>
              <title>第二条新闻</title>
              <link>https://example.com/b</link>
              <description>这里是第二条新闻的摘要内容。</description>
            </item>
          </channel>
        </rss>
        `,
        {
          status: 200,
          headers: { 'content-type': 'application/rss+xml; charset=utf-8' },
        },
      ),
    ) as typeof fetch

    const result = await readUrlContent('https://example.com/feed.xml')

    expect(result.error).toBeUndefined()
    expect(result.resourceType).toBe('feed')
    expect(result.title).toBe('Example Feed')
    expect(result.textContent).toContain('第一条新闻')
    expect(result.textContent).toContain('https://example.com/a')
  })

  test('rejects localhost URL without attempting fetch', async () => {
    const fetchMock = jest.fn(async () =>
      new Response('<html><body>should not be fetched</body></html>', {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    ) as typeof fetch
    global.fetch = fetchMock

    const result = await readUrlContent('http://127.0.0.1:3000/secret')

    expect(result.errorCode).toBe('DISALLOWED_URL')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test.each([
    'http://[::1]/',
    'http://[fc00::1]/',
    'http://[fe80::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:7f00:1]/',
    'http://[0:0:0:0:0:0:0:1]/',
  ])('rejects private IPv6 URL %s without attempting fetch', async (target) => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>
    global.fetch = fetchMock

    const result = await readUrlContent(target, {
      enableDeepseekFallback: true,
      deepseekApiKey: 'k',
      timeout: 3000,
    })

    expect(result.errorCode).toBe('DISALLOWED_URL')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('readUrlContent DeepSeek Fetch fallback', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  test('does not call DeepSeek Fetch unless explicitly enabled with a key', async () => {
    const fetchMock = jest.fn(async () =>
      new Response('<html><body>blocked</body></html>', {
        status: 403,
        statusText: 'Forbidden',
        headers: { 'content-type': 'text/html' },
      }),
    ) as jest.MockedFunction<typeof fetch>
    global.fetch = fetchMock

    const disabled = await readUrlContent('https://example.com/a', {
      deepseekApiKey: 'k',
      enableDeepseekFallback: false,
    })
    const noKey = await readUrlContent('https://example.com/a', {
      enableDeepseekFallback: true,
    })

    expect(disabled.error).toBeTruthy()
    expect(noKey.error).toBeTruthy()
    expect(fetchMock.mock.calls.some(([input]) => String(input) === DEEPSEEK_FETCH_ENDPOINT)).toBe(false)
  })

  test('falls back to DeepSeek Fetch after the local read fails and records the attempt', async () => {
    global.fetch = jest.fn(async (input, init) => {
      if (String(input) === DEEPSEEK_FETCH_ENDPOINT) {
        expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer ds-key')
        return new Response(JSON.stringify({ title: 'Fetched', content: '# Fetched\n\n正文内容' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response('<html><title>Just a moment...</title>cf-chl-bypass</html>', {
        status: 403,
        statusText: 'Forbidden',
        headers: { 'content-type': 'text/html' },
      })
    }) as typeof fetch

    const result = await readUrlContent('https://example.com/protected', {
      enableDeepseekFallback: true,
      deepseekApiKey: 'ds-key',
      timeout: 5000,
    })

    expect(result.error).toBeUndefined()
    expect(result.title).toBe('Fetched')
    expect(result.fallbackUsed).toBe('deepseek_fetch')
    expect(result.engine).toBe('deepseek_fetch')
    expect(result.textContent).toContain('正文内容')
    expect(result.attempts?.some((attempt) => attempt.engine === 'deepseek_fetch')).toBe(true)
  })

  test('keeps the local failure when DeepSeek Fetch fails', async () => {
    global.fetch = jest.fn(async (input) => {
      if (String(input) === DEEPSEEK_FETCH_ENDPOINT) {
        return new Response(JSON.stringify({ error: { message: 'secret' } }), {
          status: 429,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response('<html><body>blocked by robots policy</body></html>', {
        status: 403,
        statusText: 'Forbidden',
        headers: { 'content-type': 'text/html' },
      })
    }) as typeof fetch

    const result = await readUrlContent('https://example.com/blocked', {
      enableDeepseekFallback: true,
      deepseekApiKey: 'ds-key',
      timeout: 5000,
    })

    expect(result.error).toBeTruthy()
    expect(result.errorCode).toBe('ROBOTS_DENIED')
    expect(result.error).not.toContain('secret')
    const attempt = result.attempts?.find((item) => item.engine === 'deepseek_fetch')
    expect(attempt?.status).toBe('error')
  })

  test('does not use DeepSeek Fetch for image or PDF results', async () => {
    const fetchMock = jest.fn(async () =>
      new Response('not-really-a-png', {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }),
    ) as jest.MockedFunction<typeof fetch>
    global.fetch = fetchMock

    const result = await readUrlContent('https://example.com/image.png', {
      enableDeepseekFallback: true,
      deepseekApiKey: 'k',
      timeout: 3000,
    })

    expect(result.resourceType).toBe('image')
    expect(fetchMock.mock.calls.some(([input]) => String(input) === DEEPSEEK_FETCH_ENDPOINT)).toBe(false)
  })

  test('does not use DeepSeek Fetch for unsupported binary resources', async () => {
    const fetchMock = jest.fn(async () =>
      new Response('binary', {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
      }),
    ) as jest.MockedFunction<typeof fetch>
    global.fetch = fetchMock

    const result = await readUrlContent('https://example.com/archive.zip', {
      enableDeepseekFallback: true,
      deepseekApiKey: 'k',
      timeout: 3000,
    })

    expect(result.errorCode).toBe('UNSUPPORTED_CONTENT_TYPE')
    expect(fetchMock.mock.calls.some(([input]) => String(input) === DEEPSEEK_FETCH_ENDPOINT)).toBe(false)
  })

  test.each([
    [404, 'application/pdf'],
    [404, 'image/png'],
    [403, 'application/pdf'],
    [403, 'image/png'],
  ])('does not Fetch an extensionless URL after HTTP %i with content type %s', async (status, contentType) => {
    const fetchMock = jest.fn(async () =>
      new Response('unavailable binary resource', {
        status,
        headers: { 'content-type': contentType },
      }),
    ) as jest.MockedFunction<typeof fetch>
    global.fetch = fetchMock

    const result = await readUrlContent('https://example.com/resource', {
      enableDeepseekFallback: true,
      deepseekApiKey: 'k',
      enableBrowser: false,
      timeout: 3000,
    })

    expect(fetchMock.mock.calls.some(([input]) => String(input) === DEEPSEEK_FETCH_ENDPOINT)).toBe(false)
    expect(result.httpStatus).toBe(status)
    expect(result.attempts?.find((attempt) => attempt.engine === 'native')).toMatchObject({
      status: 'error',
      contentType,
      httpStatus: status,
    })
  })

  test('rejects private URLs before invoking DeepSeek Fetch', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>
    global.fetch = fetchMock

    const result = await readUrlContent('http://127.0.0.1:3000/secret', {
      enableDeepseekFallback: true,
      deepseekApiKey: 'k',
      timeout: 3000,
    })

    expect(result.errorCode).toBe('DISALLOWED_URL')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('does not fall back when the caller cancels the read', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>
    global.fetch = fetchMock

    const result = await readUrlContent('https://example.com/a', {
      enableDeepseekFallback: true,
      deepseekApiKey: 'k',
      signal: controller.signal,
      timeout: 3000,
    })

    expect(result.errorCode).toBe('CANCELLED')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
