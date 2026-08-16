/**
 * PDF report renderer for deep research reports.
 *
 * Markdown -> print-oriented HTML -> Chromium page.pdf().
 * Uses playwright-core with an explicit system Chromium executable in
 * production; development environments can point the executable path through
 * DEEP_RESEARCH_PDF_CHROMIUM_EXECUTABLE or the existing
 * URL_READER_BROWSER_EXECUTABLE_PATH variable.
 */

import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import MarkdownIt from 'markdown-it'
import { chromium } from 'playwright-core'

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
})

// Do not let Chromium fetch remote images while rendering the report. This
// keeps the PDF render offline and prevents the generated HTML from being able
// to trigger requests to arbitrary hosts (SSRF/leak vector).
export type ReportImageSources = Record<string, string>

// When the caller supplies a safe allowlist (`imageSources`), the original
// remote URL is replaced with an embedded `data:` URL so Chromium never needs
// to fetch remote images while rendering the PDF.
md.renderer.rules.image = (tokens, idx, options, env: any) => {
  const token = tokens[idx]
  const rawSrc = token?.attrGet('src')
  const src: string = typeof rawSrc === 'string' ? rawSrc : ''
  const rawAlt = token?.content
  const alt: string = typeof rawAlt === 'string' ? rawAlt : ''
  const safeSource = env?.imageSources?.[src]

  if (safeSource) {
    const figure = `<figure class="report-figure"><img src="${escapeHtml(safeSource)}" alt="${escapeHtml(alt)}" loading="lazy" />`
    const caption = alt.trim() ? `<figcaption>${escapeHtml(alt.trim())}</figcaption>` : ''
    return `${figure}${caption}</figure>`
  }

  const label = alt.trim() || src.trim() || 'image'
  return `<span class="report-image-placeholder">[${escapeHtml(label)}]</span>`
}

export interface ReportHtmlInput {
  title: string
  markdownHtml: string
  generatedAt?: string
}

export interface ReportPdfOptions {
  title?: string
  generatedAt?: string
  executablePath?: string
  imageSources?: ReportImageSources
}

export interface ReportPdfResult {
  bytes: Buffer
  sizeBytes: number
}

interface PdfPageLike {
  setContent(html: string, options?: { waitUntil?: string; timeout?: number }): Promise<void>
  pdf(options: Record<string, unknown>): Promise<Buffer | Uint8Array>
}

interface PdfContextLike {
  newPage(): Promise<PdfPageLike>
}

interface PdfBrowserLike {
  newContext(options?: Record<string, unknown>): Promise<PdfContextLike>
  close(): Promise<void>
}

type PdfChromiumLike = {
  launch(options: {
    executablePath?: string
    headless?: boolean
    args?: string[]
  }): Promise<PdfBrowserLike>
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const normalizeTitle = (value: string | undefined): string => {
  const trimmed = (value || '').trim()
  return trimmed || 'Research Report'
}

const normalizeGeneratedAt = (value: string | undefined): string => {
  const trimmed = (value || '').trim()
  return trimmed || new Date().toISOString().slice(0, 16).replace('T', ' ')
}

export const renderMarkdownToHtml = (markdown: string, imageSources?: ReportImageSources): string =>
  md.render((markdown || '').trim(), { imageSources })

export const buildReportHtml = (input: ReportHtmlInput): string => {
  const title = normalizeTitle(input.title)
  const generatedAt = normalizeGeneratedAt(input.generatedAt)
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  :root {
    --ink: #1f2937;
    --muted: #6b7280;
    --line: #e5e7eb;
    --accent: #4f46e5;
    --code-bg: #f3f4f6;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    color: var(--ink);
    background: #ffffff;
    font-family: "Noto Sans CJK SC", "Noto Sans SC", "PingFang SC",
      "Hiragino Sans GB", "Microsoft YaHei", "WenQuanYi Micro Hei", sans-serif;
    font-size: 10.5pt;
    line-height: 1.7;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .report { padding: 4mm 2mm; }
  header.report-header {
    border-bottom: 2px solid var(--accent);
    margin-bottom: 8mm;
    padding-bottom: 4mm;
  }
  h1 {
    font-size: 22pt;
    line-height: 1.3;
    margin: 0 0 2mm;
    letter-spacing: 0.01em;
  }
  .generated-at {
    color: var(--muted);
    font-size: 9pt;
  }
  h2 {
    font-size: 15pt;
    margin: 8mm 0 2mm;
    padding-bottom: 1.5mm;
    border-bottom: 1px solid var(--line);
  }
  h3 {
    font-size: 12.5pt;
    margin: 5mm 0 1.5mm;
  }
  p { margin: 0 0 2.5mm; }
  a { color: var(--accent); text-decoration: none; }
  blockquote {
    border-left: 3px solid var(--line);
    color: #374151;
    margin: 3mm 0;
    padding: 1.5mm 4mm;
  }
  code {
    background: var(--code-bg);
    border-radius: 2px;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
    font-size: 9pt;
    padding: 0.2mm 1mm;
  }
  pre {
    background: var(--code-bg);
    border: 1px solid var(--line);
    border-radius: 3px;
    overflow-x: auto;
    padding: 3mm;
  }
  pre code { background: transparent; padding: 0; }
  table {
    border-collapse: collapse;
    font-size: 9.5pt;
    margin: 3mm 0;
    width: 100%;
  }
  th, td {
    border: 1px solid var(--line);
    padding: 1.5mm 2mm;
    text-align: left;
    vertical-align: top;
  }
  th { background: #f9fafb; font-weight: 600; }
  img, .report-image-placeholder { max-width: 100%; }
  .report-image-placeholder { color: var(--muted); font-style: italic; }
  .report-figure {
    margin: 4mm 0;
    text-align: center;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .report-figure img {
    max-width: 100%;
    max-height: 140mm;
    object-fit: contain;
    border: 1px solid var(--line);
    border-radius: 3px;
  }
  .report-figure figcaption {
    color: var(--muted);
    font-size: 9pt;
    margin-top: 1.5mm;
  }
  hr {
    border: 0;
    border-top: 1px solid var(--line);
    margin: 5mm 0;
  }
  ol, ul { margin: 1.5mm 0 3mm; padding-left: 6mm; }
  li { margin: 0.8mm 0; }
  @media print {
    h1, h2, h3, h4 { break-after: avoid; page-break-after: avoid; }
    pre, blockquote, table, img { break-inside: avoid; page-break-inside: avoid; }
    a { color: inherit; }
  }
</style>
</head>
<body>
  <main class="report">
    <header class="report-header">
      <h1>${escapeHtml(title)}</h1>
      <div class="generated-at">Generated at ${escapeHtml(generatedAt)}</div>
    </header>
    ${input.markdownHtml}
  </main>
</body>
</html>`
}

const resolveExecutablePath = (explicit?: string): string | undefined => {
  const candidates = [
    explicit,
    process.env.DEEP_RESEARCH_PDF_CHROMIUM_EXECUTABLE,
    process.env.URL_READER_BROWSER_EXECUTABLE_PATH,
    process.platform === 'linux' ? '/usr/bin/chromium' : undefined,
  ]
  for (const candidate of candidates) {
    const normalized = (candidate || '').trim()
    if (normalized && existsSync(normalized)) {
      return normalized
    }
  }
  return undefined
}

export const renderHtmlToPdfBuffer = async (
  html: string,
  options: {
    executablePath?: string
    chromiumLike?: PdfChromiumLike
  } = {},
): Promise<Buffer> => {
  const browser = await (options.chromiumLike ?? chromium).launch({
    headless: true,
    executablePath: resolveExecutablePath(options.executablePath),
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  })

  try {
    const context = await browser.newContext({ locale: 'zh-CN' })
    const page = await context.newPage()
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 })
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '18mm',
        bottom: '18mm',
        left: '16mm',
        right: '16mm',
      },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `<div style="font-family:'Noto Sans CJK SC',sans-serif;font-size:8px;width:100%;text-align:center;color:#6b7280;">第 <span class="pageNumber"></span> 页 / 共 <span class="totalPages"></span> 页</div>`,
    })
    return Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf)
  } finally {
    await browser.close()
  }
}

export const renderMarkdownToPdfBuffer = async (
  markdown: string,
  options: ReportPdfOptions & { chromiumLike?: PdfChromiumLike } = {},
): Promise<ReportPdfResult> => {
  const title = normalizeTitle(options.title)
  const html = buildReportHtml({
    title,
    generatedAt: options.generatedAt,
    markdownHtml: renderMarkdownToHtml(markdown, options.imageSources),
  })
  const bytes = await renderHtmlToPdfBuffer(html, options)
  return { bytes, sizeBytes: bytes.length }
}

export const renderMarkdownToPdfFile = async (
  markdown: string,
  outputPath: string,
  options: ReportPdfOptions & { chromiumLike?: PdfChromiumLike } = {},
): Promise<ReportPdfResult> => {
  const result = await renderMarkdownToPdfBuffer(markdown, options)
  await fs.writeFile(outputPath, result.bytes)
  return result
}
