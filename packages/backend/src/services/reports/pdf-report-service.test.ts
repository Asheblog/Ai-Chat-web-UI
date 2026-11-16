import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  buildReportHtml,
  renderHtmlToPdfBuffer,
  renderMarkdownToHtml,
} from './pdf-report-service'
import {
  configureSharedBrowser,
  getSharedBrowserStats,
  resetSharedBrowserForTests,
} from '../../utils/web-retrieval/browser/pool'

describe('pdf-report-service', () => {
  it('renders markdown tables and escapes raw html', () => {
    const html = renderMarkdownToHtml('# Title\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n<script>alert(1)</script>\n\n![x](https://example.com/a.png)')
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<table>')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).toContain('report-image-placeholder')
  })

  it('embeds allowlisted markdown images as inline figures', () => {
    const html = renderMarkdownToHtml(
      '![新闻配图](https://example.com/news.png)\n\n正文',
      { 'https://example.com/news.png': 'data:image/png;base64,abc' },
    )
    expect(html).toContain('<figure class="report-figure">')
    expect(html).toContain('src="data:image/png;base64,abc"')
    expect(html).toContain('<figcaption>新闻配图</figcaption>')
    expect(html).toContain('<img')
  })

  it('builds a CJK print template with escaped metadata', () => {
    const html = buildReportHtml({
      title: '深度研究 <报告>',
      markdownHtml: '<h1>正文</h1>',
      generatedAt: '2026-08-15 10:00',
    })
    expect(html).toContain('深度研究 &lt;报告&gt;')
    expect(html).toContain('<h1>正文</h1>')
    expect(html).toContain('Noto Sans CJK SC')
    expect(html).toContain('@media print')
  })

  it('renders html to a pdf buffer through the injected chromium', async () => {
    const pdfBytes = Buffer.from('%PDF-1.4\nfake')
    let closed = false
    const setContent = jest.fn().mockResolvedValue(undefined)
    const fakeChrome = path.join(os.tmpdir(), `aichat-pdf-chrome-${Date.now()}`)
    fs.writeFileSync(fakeChrome, 'chrome')
    const closeContext = jest.fn()
    const chromiumLike = {
      executablePath: () => fakeChrome,
      launch: jest.fn().mockResolvedValue({
        newContext: jest.fn().mockResolvedValue({
          newPage: jest.fn().mockResolvedValue({
            setContent,
            pdf: jest.fn().mockResolvedValue(pdfBytes),
          }),
          close: closeContext,
        }),
        close: jest.fn().mockImplementation(async () => {
          closed = true
        }),
      }),
    }

    try {
      const result = await renderHtmlToPdfBuffer('<html></html>', {
        chromiumLike: chromiumLike as any,
      })

      expect(result.toString('utf8')).toContain('%PDF')
      expect(chromiumLike.launch).toHaveBeenCalledWith(
        expect.objectContaining({ executablePath: fakeChrome }),
      )
      expect(setContent).toHaveBeenCalledWith('<html></html>', { waitUntil: 'load', timeout: 30_000 })
      expect(closeContext).toHaveBeenCalledTimes(1)
      expect(closed).toBe(true)
    } finally {
      fs.rmSync(fakeChrome, { force: true })
    }
  })

  it('accepts an explicit executablePath for launch', async () => {
    const pdfBytes = Buffer.from('%PDF-1.4\nfake')
    const fakeChrome = path.join(os.tmpdir(), `aichat-pdf-alias-${Date.now()}`)
    fs.writeFileSync(fakeChrome, 'chrome')
    const chromiumLike = {
      launch: jest.fn().mockResolvedValue({
        newContext: jest.fn().mockResolvedValue({
          newPage: jest.fn().mockResolvedValue({
            setContent: jest.fn().mockResolvedValue(undefined),
            pdf: jest.fn().mockResolvedValue(pdfBytes),
          }),
          close: jest.fn().mockResolvedValue(undefined),
        }),
        close: jest.fn().mockResolvedValue(undefined),
      }),
    }

    try {
      await renderHtmlToPdfBuffer('<html></html>', {
        executablePath: fakeChrome,
        chromiumLike: chromiumLike as any,
      })
      expect(chromiumLike.launch).toHaveBeenCalledWith(
        expect.objectContaining({ executablePath: fakeChrome }),
      )
    } finally {
      fs.rmSync(fakeChrome, { force: true })
    }
  })
})
describe('pdf-report-service shared browser pool', () => {
  const MiB = 1024 * 1024
  const allowMemory = () => Promise.resolve({
    allowed: true,
    advisory: true as const,
    snapshot: { signal: 'freemem' as const, headroomBytes: 2048 * MiB, advisory: true as const },
    minHeadroomBytes: 256 * MiB,
    minContainerLimitBytes: 768 * MiB,
  })

  const makePdfBrowser = () => {
    const pages: any[] = []
    const contexts: any[] = []
    const browser = {
      newContext: jest.fn(async () => {
        const page = {
          route: jest.fn(async () => undefined),
          setContent: jest.fn(async () => undefined),
          pdf: jest.fn(async () => Buffer.from('%PDF-1.4 pooled')),
          content: jest.fn(async () => ''),
          title: jest.fn(async () => ''),
          url: jest.fn(() => 'about:blank'),
        }
        pages.push(page)
        const context = { newPage: jest.fn(async () => page), close: jest.fn(async () => undefined) }
        contexts.push(context)
        return context
      }),
      close: jest.fn(async () => undefined),
      on: jest.fn(),
    }
    return { browser, pages, contexts }
  }

  const writeFakeChrome = (): string => {
    const fakeChrome = path.join(os.tmpdir(), `aichat-pdf-pool-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    fs.writeFileSync(fakeChrome, 'chrome')
    return fakeChrome
  }

  afterEach(async () => {
    await resetSharedBrowserForTests()
  })

  it('renders through the shared pool, reusing one browser across reports', async () => {
    const fake = makePdfBrowser()
    const launch = jest.fn(async () => fake.browser as never)
    configureSharedBrowser({ launch, assessMemory: allowMemory })
    const fakeChrome = writeFakeChrome()
    try {
      const first = await renderHtmlToPdfBuffer('<html>first</html>', { executablePath: fakeChrome })
      const second = await renderHtmlToPdfBuffer('<html>second</html>', { executablePath: fakeChrome })

      expect(first.toString()).toContain('%PDF')
      expect(second.toString()).toContain('%PDF')
      expect(launch).toHaveBeenCalledTimes(1)
      expect(getSharedBrowserStats()).toMatchObject({ launched: 1, contextsOpened: 2, contextsClosed: 2 })
      expect(fake.contexts.every((context) => context.close.mock.calls.length === 1)).toBe(true)
      expect(fake.pages[0].setContent).toHaveBeenCalledWith('<html>first</html>', { waitUntil: 'load', timeout: 30_000 })
      expect(fake.pages[1].setContent).toHaveBeenCalledWith('<html>second</html>', { waitUntil: 'load', timeout: 30_000 })
    } finally {
      fs.rmSync(fakeChrome, { force: true })
    }
  })

  it('keeps the pdf render offline through the shared pool', async () => {
    const fake = makePdfBrowser()
    configureSharedBrowser({ launch: async () => fake.browser as never, assessMemory: allowMemory })
    const fakeChrome = writeFakeChrome()
    try {
      await renderHtmlToPdfBuffer('<html>offline</html>', { executablePath: fakeChrome })
      const handler = fake.pages[0].route.mock.calls[0][1] as (route: any) => Promise<void>
      const remote = { request: () => ({ url: () => 'https://evil.example/a.png', resourceType: () => 'image' }), abort: jest.fn(), continue: jest.fn() }
      await handler(remote)
      expect(remote.abort).toHaveBeenCalledTimes(1)
      expect(remote.continue).not.toHaveBeenCalled()

      const inline = { request: () => ({ url: () => 'data:image/png;base64,abc', resourceType: () => 'image' }), abort: jest.fn(), continue: jest.fn() }
      await handler(inline)
      expect(inline.continue).toHaveBeenCalledTimes(1)
      expect(inline.abort).not.toHaveBeenCalled()
    } finally {
      fs.rmSync(fakeChrome, { force: true })
    }
  })

  it('returns an explicit resource error when the pool has no memory headroom', async () => {
    const launch = jest.fn()
    configureSharedBrowser({
      launch,
      assessMemory: async () => ({
        allowed: false,
        reason: 'low-headroom',
        advisory: true as const,
        snapshot: { signal: 'cgroup-v2' as const, usageBytes: 900 * MiB, limitBytes: 1024 * MiB, headroomBytes: 124 * MiB, advisory: true as const },
        minHeadroomBytes: 256 * MiB,
        minContainerLimitBytes: 768 * MiB,
      }),
    })
    const fakeChrome = writeFakeChrome()
    try {
      await expect(
        renderHtmlToPdfBuffer('<html>oom</html>', { executablePath: fakeChrome }),
      ).rejects.toMatchObject({ code: 'BROWSER_MEMORY' })
      expect(launch).not.toHaveBeenCalled()
    } finally {
      fs.rmSync(fakeChrome, { force: true })
    }
  })
})