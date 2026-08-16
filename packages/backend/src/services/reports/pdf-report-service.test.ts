import {
  buildReportHtml,
  renderHtmlToPdfBuffer,
  renderMarkdownToHtml,
} from './pdf-report-service'

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
    const chromiumLike = {
      launch: jest.fn().mockResolvedValue({
        newContext: jest.fn().mockResolvedValue({
          newPage: jest.fn().mockResolvedValue({
            setContent,
            pdf: jest.fn().mockResolvedValue(pdfBytes),
          }),
        }),
        close: jest.fn().mockImplementation(async () => {
          closed = true
        }),
      }),
    }

    const result = await renderHtmlToPdfBuffer('<html></html>', {
      chromiumLike: chromiumLike as any,
    })

    expect(result.toString('utf8')).toContain('%PDF')
    expect(setContent).toHaveBeenCalledWith('<html></html>', { waitUntil: 'load', timeout: 30_000 })
    expect(closed).toBe(true)
  })
})
