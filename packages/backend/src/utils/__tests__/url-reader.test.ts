import { readUrlContent, formatUrlContentForModel } from '../url-reader'
import { Readability } from '@mozilla/readability'

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
})
