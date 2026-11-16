/**
 * URL 内容读取工具
 * 使用 @mozilla/readability + jsdom 自建实现
 * 无需外部 API，完全本地处理
 */

import { JSDOM } from 'jsdom'
import { isDisallowedHostname } from './host-safety'
import { BackendLogger as log } from './logger'
import {
  readPlaywrightChromiumExecutablePath,
  resolveBrowserExecutablePath as resolveSharedBrowserExecutablePath,
} from './browser-executable'
import { DeepSeekToolError, runDeepSeekFetch } from './deepseek-tools'
import { combineAbortSignals } from './abort-signal'
import { createReadBudget, type ReadBudget } from './web-retrieval/budget'
import { classifyChallenge } from './web-retrieval/challenge'
import { sniffContentType } from './web-retrieval/mime'
import {
  assessPlainTextQuality,
  extractDocumentFromHtml,
  type ExtractedDocument,
} from './web-retrieval/html-document'
import { discoverFeedCandidates } from './web-retrieval/feed'
import { extractHtmlWithPython, getPythonHtmlExtractor } from './web-retrieval/python-extractor'
import { BrowserCapacityError, renderWithSharedBrowser } from './web-retrieval/browser/pool'
import {
  BoundedMemoryStore,
  InFlightReads,
  isTimeSensitiveUrl,
  resolveReadCacheTtlMs,
} from './web-retrieval/cache'
import type {
  UrlReadAttempt,
  UrlReadEngineName,
  UrlReadErrorCode,
  UrlReadImage,
  UrlReadResult,
  UrlReaderOptions,
} from './web-retrieval/types'

export type {
  ProvidedContent,
  UrlReadAttempt,
  UrlReadContentKind,
  UrlReadEngineName,
  UrlReadErrorCode,
  UrlReadImage,
  UrlReadResult,
  UrlReaderOptions,
} from './web-retrieval/types'


const DEFAULT_TIMEOUT = 30000
const PYTHON_EXTRACTION_TIMEOUT_MS = 1500
const PYTHON_COLD_START_TIMEOUT_MS = 4000
const MIN_PROVIDED_CONTENT_CHARS = 80
const MAX_CACHE_ENTRY_BYTES = 512 * 1024
const DEFAULT_MAX_CONTENT_LENGTH = 100000
const DEFAULT_MAX_BODY_BYTES = 8 * 1024 * 1024
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; AIChat/1.0; +https://github.com/Asheblog/aichat)'
const CRAWLER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
const WAYBACK_TIMEOUT = 20000
const WAYBACK_CHECK_TIMEOUT = 10000
const WAYBACK_RATE_LIMIT_DELAY_MS = 1200
const CRAWLER_MIN_TEXT_LENGTH = 40
const MAX_FETCH_REDIRECTS = 5
const withAbortSignal = <T>(operation: () => Promise<T>, signal?: AbortSignal | null): Promise<T> => {
  if (signal?.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal?.reason)
    signal?.addEventListener('abort', onAbort, { once: true })
    const cleanup = () => signal?.removeEventListener('abort', onAbort)
    try {
      operation().then(
        (value) => { cleanup(); resolve(value) },
        (error) => { cleanup(); reject(error) },
      )
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}

const waitWithSignal = async (ms: number, signal?: AbortSignal): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await withAbortSignal(() => new Promise<void>((resolve) => { timer = setTimeout(resolve, ms) }), signal)
  } finally {
    if (timer) clearTimeout(timer)
  }
}

interface UrlTransformRule {
  id: 'medium_to_scribe' | 'github_blob_to_raw'
  pattern: RegExp
  transform: (match: RegExpMatchArray) => string
}

interface DomLikeElement {
  textContent?: string | null
  innerHTML?: string
  getAttribute(name: string): string | null
  querySelectorAll(selector: string): ArrayLike<DomLikeElement> | Iterable<DomLikeElement>
  remove?: () => void
}

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308])

const URL_TRANSFORM_RULES: UrlTransformRule[] = [
  {
    id: 'medium_to_scribe',
    pattern: /^https?:\/\/(?:[^/]+\.)?medium\.com\/(.+)$/i,
    transform: (match) => `https://scribe.rip/${match[1] || ''}`,
  },
  {
    id: 'github_blob_to_raw',
    pattern: /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i,
    transform: (match) =>
      `https://github.com/${match[1] || ''}/${match[2] || ''}/raw/refs/heads/${match[3] || ''}/${match[4] || ''}`,
  },
]


const applyUrlTransformRules = (
  url: string,
): { fetchUrl: string; transformedBy?: UrlTransformRule['id'] } => {
  for (const rule of URL_TRANSFORM_RULES) {
    const match = url.match(rule.pattern)
    if (!match) continue
    const transformed = rule.transform(match)
    if (transformed && transformed !== url) {
      return { fetchUrl: transformed, transformedBy: rule.id }
    }
  }
  return { fetchUrl: url }
}

export function validatePublicHttpUrl(url: string): string {
  let normalized = url.trim()

  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `https://${normalized}`
  }

  try {
    const parsed = new URL(normalized)
    const hostname = parsed.hostname

    if (isDisallowedHostname(hostname)) {
      throw new Error('Access to local/internal URLs is not allowed for security reasons')
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Only HTTP and HTTPS URLs are supported')
    }

    return parsed.toString()
  } catch (error) {
    if (error instanceof Error && error.message.includes('not allowed')) {
      throw error
    }
    throw new Error(`Invalid URL format: ${url}`)
  }
}

function classifyHttpErrorCode(status: number, bodySnippet: string): UrlReadErrorCode {
  if (status === 403) {
    if (/robots/i.test(bodySnippet)) return 'ROBOTS_DENIED'
    return 'HTTP_403'
  }
  if (status === 404) return 'HTTP_404'
  if (status >= 400 && status < 500) return 'HTTP_4XX'
  if (status >= 500) return 'HTTP_5XX'
  return 'HTTP_ERROR'
}

function classifyThrownError(error: unknown): { message: string; errorCode: UrlReadErrorCode } {
  if (error && typeof error === 'object' && 'name' in error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return { message: 'Request timed out', errorCode: 'TIMEOUT' }
  }
  if (error instanceof Error) {
    const message = error.message || 'Unknown error occurred'
    if (message.includes('Invalid URL format')) return { message, errorCode: 'INVALID_URL' }
    if (message.includes('not allowed')) return { message, errorCode: 'DISALLOWED_URL' }
    if (message.includes('Only HTTP and HTTPS URLs are supported')) {
      return { message, errorCode: 'INVALID_URL' }
    }
    if (message.includes('Unsupported content type')) {
      return { message, errorCode: 'UNSUPPORTED_CONTENT_TYPE' }
    }
    if (message.includes('Response body is too large')) {
      return { message, errorCode: 'BODY_TOO_LARGE' }
    }
    if (message.includes('Local browser renderer is unavailable')) {
      return { message, errorCode: 'BROWSER_UNAVAILABLE' }
    }
    if (message.includes('Page content is empty or too short')) {
      return { message, errorCode: 'EMPTY_CONTENT' }
    }
    if (message.includes('Failed to extract article content')) {
      return { message, errorCode: 'PARSE_EMPTY' }
    }
    if (message.toLowerCase().includes('fetch failed')) {
      return { message, errorCode: 'FETCH_FAILED' }
    }
    return { message, errorCode: 'UNKNOWN' }
  }
  return { message: 'Unknown error occurred', errorCode: 'UNKNOWN' }
}

const normalizeTextContent = (value: string, maxContentLength: number): string => {
  let normalized = (value || '')
    .replace(/\u00A0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (normalized.length > maxContentLength) {
    normalized = normalized.slice(0, maxContentLength) + '\n\n[内容已截断，原文过长...]'
  }
  return normalized
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const countWords = (value: string): number => value.split(/\s+/).filter(Boolean).length

const isHtmlContentType = (contentType: string): boolean => {
  const normalized = (contentType || '').toLowerCase()
  return normalized.includes('text/html') || normalized.includes('application/xhtml')
}

const isTextLikeContentType = (contentType: string): boolean => {
  const normalized = (contentType || '').toLowerCase()
  if (!normalized) return false
  if (normalized.startsWith('text/')) return true
  return (
    normalized.includes('application/json') ||
    normalized.includes('+json') ||
    normalized.includes('application/xml') ||
    normalized.includes('+xml') ||
    normalized.includes('application/xhtml')
  )
}

const isImageContentType = (contentType: string): boolean => {
  const normalized = (contentType || '').toLowerCase()
  return normalized.startsWith('image/')
}

const isPdfContentType = (contentType: string): boolean => {
  const normalized = (contentType || '').toLowerCase()
  return normalized.includes('application/pdf')
}

const isDocxContentType = (contentType: string): boolean => {
  const normalized = (contentType || '').toLowerCase()
  return normalized.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
}

const isCsvContentType = (contentType: string): boolean => {
  const normalized = (contentType || '').toLowerCase()
  return normalized.includes('text/csv') || normalized.includes('application/csv')
}

const isFeedContentType = (contentType: string): boolean => {
  const normalized = (contentType || '').toLowerCase()
  return (
    normalized.includes('application/rss+xml') ||
    normalized.includes('application/atom+xml') ||
    normalized.includes('application/feed+json')
  )
}

const isLikelyPdfUrl = (url: string): boolean => /\.pdf(?:[?#]|$)/i.test(url)
const isLikelyDocxUrl = (url: string): boolean => /\.docx(?:[?#]|$)/i.test(url)
const isLikelyCsvUrl = (url: string): boolean => /\.csv(?:[?#]|$)/i.test(url)

const buildPrimaryHeaders = (userAgent: string): Record<string, string> => ({
  'User-Agent': userAgent,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate',
  'Cache-Control': 'no-cache',
})

const buildCrawlerHeaders = (): Record<string, string> => ({
  'User-Agent': CRAWLER_USER_AGENT,
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
  'Upgrade-Insecure-Requests': '1',
})

const buildExcerpt = (value: string): string | undefined => {
  const normalized = value.trim()
  if (!normalized) return undefined
  return normalized.length > 220 ? `${normalized.slice(0, 220)}...` : normalized
}

const parsePositiveInt = (value: string | null): number | undefined => {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return parsed
}


const sanitizeContentType = (contentType: string | null | undefined): string | undefined => {
  const normalized = (contentType || '').trim().toLowerCase()
  if (!normalized) return undefined
  return normalized.split(';')[0]?.trim() || undefined
}

const resolveImageDimensionsFromResponse = (response: Response): { width?: number; height?: number } => {
  const widthHeader = response.headers.get('x-img-width') || response.headers.get('width')
  const heightHeader = response.headers.get('x-img-height') || response.headers.get('height')
  const width = parsePositiveInt(widthHeader)
  const height = parsePositiveInt(heightHeader)
  return {
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
  }
}

const buildDirectImageResult = (
  response: Response,
  validatedUrl: string,
): UrlReadResult => {
  const contentType = sanitizeContentType(response.headers.get('content-type'))
  const contentLengthHeader = response.headers.get('content-length')
  const contentLength = parsePositiveInt(contentLengthHeader)
  const dims = resolveImageDimensionsFromResponse(response)
  return {
    title: '',
    url: validatedUrl,
    content: '',
    textContent: '',
    resourceType: 'image',
    contentType,
    ...(typeof contentLength === 'number' ? { contentLength } : {}),
    leadImageUrl: validatedUrl,
    images: [
      {
        url: validatedUrl,
        source: 'direct',
        ...dims,
      },
    ],
  }
}

const parseContentLength = (response: Response): number | undefined =>
  parsePositiveInt(response.headers.get('content-length'))

async function readResponseBufferWithLimit(
  response: Response,
  maxBodyBytes: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  const declaredLength = parseContentLength(response)
  if (typeof declaredLength === 'number' && declaredLength > maxBodyBytes) {
    throw new Error(`Response body is too large: ${declaredLength} bytes exceeds ${maxBodyBytes}`)
  }

  if (!response.body || typeof response.body.getReader !== 'function') {
    const buffer = Buffer.from(await withAbortSignal(() => response.arrayBuffer(), signal))
    if (buffer.length > maxBodyBytes) {
      throw new Error(`Response body is too large: ${buffer.length} bytes exceeds ${maxBodyBytes}`)
    }
    return buffer
  }

  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  const cancel = () => { void reader.cancel(signal?.reason).catch(() => undefined) }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    while (true) {
      const { done, value } = await withAbortSignal(() => reader.read(), signal)
      signal?.throwIfAborted()
      if (done) break
      if (!value) continue
      const chunk = Buffer.from(value)
      total += chunk.length
      if (total > maxBodyBytes) {
        await reader.cancel().catch(() => undefined)
        throw new Error(`Response body is too large: ${total} bytes exceeds ${maxBodyBytes}`)
      }
      chunks.push(chunk)
    }
    return Buffer.concat(chunks, total)
  } finally {
    signal?.removeEventListener('abort', cancel)
    reader.releaseLock()
  }
}

const extractCharsetFromContentType = (contentType: string): string | undefined => {
  const match = contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/i)
  return match?.[1]?.trim().toLowerCase()
}

const extractCharsetFromHtml = (buffer: Buffer): string | undefined => {
  const head = buffer.subarray(0, Math.min(buffer.length, 8192)).toString('latin1')
  const direct = head.match(/<meta[^>]+charset\s*=\s*["']?([^"'\s/>]+)/i)?.[1]
  if (direct) return direct.trim().toLowerCase()
  const equiv = head.match(/<meta[^>]+http-equiv=["']?content-type["']?[^>]+content=["'][^"']*charset=([^"']+)["']/i)?.[1]
  return equiv?.trim().toLowerCase()
}

const decodeResponseBuffer = (
  buffer: Buffer,
  contentType: string,
): string => {
  const charset = extractCharsetFromContentType(contentType) || extractCharsetFromHtml(buffer)
  const candidates = Array.from(new Set([charset, 'utf-8', 'gb18030', 'gbk'].filter(Boolean) as string[]))
  for (const encoding of candidates) {
    try {
      return new TextDecoder(encoding).decode(buffer)
    } catch {
      // try the next decoder
    }
  }
  return buffer.toString('utf8')
}

async function fetchPageBody(
  url: string,
  timeout: number,
  headers: Record<string, string>,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
  externalSignal?: AbortSignal,
): Promise<{ response: Response; body: string; buffer?: Buffer; finalUrl: string; contentType: string }> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)
  const combined = combineAbortSignals(controller.signal, externalSignal)

  try {
    const { response, finalUrl } = await fetchWithValidatedRedirectsDetailed(url, {
      headers,
      signal: combined.signal,
      redirect: 'manual',
    })
    const declaredContentType = response.headers.get('content-type') || ''
    const declared = sanitizeContentType(declaredContentType) || ''
    const genericContentType =
      !declared ||
      [
        'application/octet-stream',
        'binary/octet-stream',
        'application/binary',
        'application/unknown',
        'unknown/unknown',
        'unknown',
      ].includes(declared)
    const urlImpliesDocument = isLikelyPdfUrl(finalUrl) || isLikelyDocxUrl(finalUrl) || isLikelyCsvUrl(finalUrl)
    const shouldReadBody =
      !response.ok ||
      genericContentType ||
      isHtmlContentType(declared) ||
      isTextLikeContentType(declared) ||
      isFeedContentType(declared) ||
      isPdfContentType(declared) ||
      isDocxContentType(declared) ||
      isCsvContentType(declared) ||
      urlImpliesDocument
    if (!shouldReadBody) {
      return { response, body: '', finalUrl, contentType: declared }
    }
    const buffer = await readResponseBufferWithLimit(response, maxBodyBytes, combined.signal)
    // 有些服务端把 HTML 标成 text/plain；此时用前缀内容重新判断。
    const shouldSniff = genericContentType || declared === 'text/plain'
    const snack = sniffContentType({
      buffer,
      headerContentType: shouldSniff ? '' : declaredContentType,
      url: finalUrl,
    })
    const contentType = snack.contentType
    if (snack.sniffed) {
      log.debug('url reader: sniffed response content type', {
        url,
        declared: snack.declared,
        contentType,
      })
    }
    const shouldDecodeText =
      !response.ok ||
      isHtmlContentType(contentType) ||
      isTextLikeContentType(contentType) ||
      isFeedContentType(contentType) ||
      isCsvContentType(contentType)
    const body = shouldDecodeText ? decodeResponseBuffer(buffer, contentType) : ''
    return { response, body, buffer, finalUrl, contentType }
  } finally {
    clearTimeout(timeoutId)
    combined.cleanup()
  }
}

export async function fetchWithValidatedRedirectsDetailed(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch = fetch,
): Promise<{ response: Response; finalUrl: string }> {
  let currentUrl = validatePublicHttpUrl(url)
  let redirects = 0

  while (true) {
    const response = await withAbortSignal(() => fetchImpl(currentUrl, {
      ...init,
      redirect: 'manual',
    }), init.signal)
    if (!REDIRECT_STATUS_CODES.has(response.status)) {
      return { response, finalUrl: currentUrl }
    }
    const location = response.headers.get('location')
    if (!location) {
      return { response, finalUrl: currentUrl }
    }
    redirects += 1
    if (redirects > MAX_FETCH_REDIRECTS) {
      throw new Error(`Too many redirects while fetching URL: ${url}`)
    }
    currentUrl = validatePublicHttpUrl(new URL(location, currentUrl).toString())
  }
}

export async function fetchWithValidatedRedirects(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const { response } = await fetchWithValidatedRedirectsDetailed(url, init, fetchImpl)
  return response
}

const buildCrawlerResultFromText = (
  text: string,
  url: string,
  maxContentLength: number,
  title = '',
  contentType?: string,
): UrlReadResult | null => {
  const normalized = normalizeTextContent(text, maxContentLength)
  if (normalized.length < CRAWLER_MIN_TEXT_LENGTH) return null
  return {
    title: title.trim(),
    url,
    content: '',
    textContent: normalized,
    resourceType: 'text',
    ...(contentType ? { contentType } : {}),
    excerpt: buildExcerpt(normalized),
    wordCount: countWords(normalized),
    fallbackUsed: 'crawler',
  }
}

const extractTitleFromDocument = (doc: any): string => {
  const ogTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute('content')
  const twitterTitle = doc.querySelector('meta[name="twitter:title"]')?.getAttribute('content')
  const h1Title = doc.querySelector('h1')?.textContent
  return (ogTitle || twitterTitle || doc.title || h1Title || '').trim()
}

const getElementText = (root: any, selector: string): string => {
  const value = root.querySelector(selector)?.textContent || ''
  return normalizeTextContent(value, 1000)
}

const buildFeedResultFromXml = (
  xml: string,
  url: string,
  maxContentLength: number,
): UrlReadResult | null => {
  try {
    const dom = new JSDOM(xml, {
      url,
      contentType: 'text/xml',
    })
    try {
      const doc = dom.window.document
      const parserError = doc.querySelector('parsererror')
      if (parserError) return null
      const channelTitle =
        getElementText(doc, 'channel > title') ||
        getElementText(doc, 'feed > title') ||
        extractTitleFromDocument(doc)
      const entries = Array.from(doc.querySelectorAll('item, entry') as any).slice(0, 50) as any[]
      if (entries.length === 0) return null

      const blocks: string[] = []
      for (const [index, entry] of entries.entries()) {
        const title = getElementText(entry, 'title') || `Item ${index + 1}`
        const link =
          entry.querySelector('link[href]')?.getAttribute('href') ||
          getElementText(entry, 'link') ||
          ''
        const published =
          getElementText(entry, 'pubDate') ||
          getElementText(entry, 'published') ||
          getElementText(entry, 'updated')
        const summary =
          getElementText(entry, 'description') ||
          getElementText(entry, 'summary') ||
          getElementText(entry, 'content')
        const lines = [`${index + 1}. ${title}`]
        if (published) lines.push(`   时间: ${published}`)
        if (link) lines.push(`   链接: ${link}`)
        if (summary) lines.push(`   摘要: ${summary}`)
        blocks.push(lines.join('\n'))
      }

      const textContent = normalizeTextContent(blocks.join('\n\n'), maxContentLength)
      if (textContent.length < CRAWLER_MIN_TEXT_LENGTH) return null
      return {
        title: channelTitle,
        url,
        content: '',
        textContent,
        resourceType: 'feed',
        contentType: 'application/rss+xml',
        excerpt: buildExcerpt(textContent),
        wordCount: countWords(textContent),
        fallbackUsed: 'document',
        engine: 'feed',
        contentFormat: 'feed',
        confidence: 0.9,
      }
    } finally {
      dom.window.close()
    }
  } catch {
    return null
  }
}

const buildJsonResultFromText = (
  text: string,
  url: string,
  maxContentLength: number,
  contentType?: string,
): UrlReadResult | null => {
  try {
    const parsed = JSON.parse(text)
    const normalized = normalizeTextContent(JSON.stringify(parsed, null, 2), maxContentLength)
    if (normalized.length < CRAWLER_MIN_TEXT_LENGTH) return null
    return {
      title: '',
      url,
      content: '',
      textContent: normalized,
      resourceType: 'text',
      contentType,
      excerpt: buildExcerpt(normalized),
      wordCount: countWords(normalized),
      fallbackUsed: 'document',
      engine: 'text',
      contentFormat: 'json',
      confidence: 0.95,
    }
  } catch {
    return null
  }
}

const normalizeUrlForFeedMatch = (value: string): string | null => {
  try {
    const parsed = new URL(value)
    parsed.hash = ''
    parsed.search = ''
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/'
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

const getFeedEntryLink = (entry: any, baseUrl: string): string => {
  const href = entry.querySelector('link[href]')?.getAttribute('href')
  const text = getElementText(entry, 'link')
  const raw = href || text
  if (!raw) return ''
  try {
    return new URL(raw, baseUrl).toString()
  } catch {
    return raw
  }
}

const extractFeedEntryHtml = (entry: any): string => {
  const candidates = [
    entry.getElementsByTagName('content:encoded')?.[0]?.textContent,
    entry.querySelector('encoded')?.textContent,
    entry.querySelector('content')?.textContent,
    entry.querySelector('description')?.textContent,
    entry.querySelector('summary')?.textContent,
  ]
  return candidates.map((item) => (item || '').trim()).find(Boolean) || ''
}

const buildFeedItemResultFromXml = (
  xml: string,
  targetUrl: string,
  maxContentLength: number,
  feedUrl: string,
): UrlReadResult | null => {
  try {
    const targetKey = normalizeUrlForFeedMatch(targetUrl)
    if (!targetKey) return null

    const dom = new JSDOM(xml, {
      url: feedUrl,
      contentType: 'text/xml',
    })
    try {
      const doc = dom.window.document
      const entries = Array.from(doc.querySelectorAll('item, entry') as any) as any[]
      for (const entry of entries) {
        const link = getFeedEntryLink(entry, feedUrl)
        const linkKey = normalizeUrlForFeedMatch(link)
        if (!linkKey || linkKey !== targetKey) continue

        const title = getElementText(entry, 'title')
        const publishedTime =
          getElementText(entry, 'pubDate') ||
          getElementText(entry, 'published') ||
          getElementText(entry, 'updated') ||
          undefined
        const html = extractFeedEntryHtml(entry)
        if (!html) return null
        const wrappedHtml = `<article><h1>${escapeHtml(title)}</h1>${html}</article>`
        const extracted = extractDocumentFromHtml(wrappedHtml, targetUrl, { maxContentLength })
        if (!extracted) return null
        return {
          ...buildDocumentResult(extracted, {
            url: targetUrl,
            finalUrl: targetUrl,
            engine: 'feed',
            fallbackUsed: 'document',
            confidence: 0.85,
          }),
          title: extracted.title || title,
          url: targetUrl,
          resourceType: 'page',
          contentType: 'application/rss+xml',
          publishedTime,
          fallbackUsed: 'document',
          engine: 'feed',
          contentFormat: 'feed',
          confidence: 0.86,
        }
      }
      return null
    } finally {
      dom.window.close()
    }
  } catch {
    return null
  }
}

const buildJsonFeedResultFromText = (
  text: string,
  url: string,
  maxContentLength: number,
  contentType?: string,
): UrlReadResult | null => {
  try {
    const parsed = JSON.parse(text) as {
      title?: string
      items?: Array<{
        title?: string
        url?: string
        external_url?: string
        date_published?: string
        date_modified?: string
        summary?: string
        content_text?: string
        content_html?: string
      }>
    }
    const items = Array.isArray(parsed.items) ? parsed.items.slice(0, 50) : []
    if (items.length === 0) return null
    const blocks = items.map((item, index) => {
      const title = normalizeTextContent(item.title || `Item ${index + 1}`, 1000)
      const link = item.url || item.external_url || ''
      const published = item.date_published || item.date_modified || ''
      const summary = normalizeTextContent(item.summary || item.content_text || item.content_html || '', 1600)
      const lines = [`${index + 1}. ${title}`]
      if (published) lines.push(`   时间: ${published}`)
      if (link) lines.push(`   链接: ${link}`)
      if (summary) lines.push(`   摘要: ${summary}`)
      return lines.join('\n')
    })
    const normalized = normalizeTextContent(blocks.join('\n\n'), maxContentLength)
    if (normalized.length < CRAWLER_MIN_TEXT_LENGTH) return null
    return {
      title: normalizeTextContent(parsed.title || '', 1000),
      url,
      content: '',
      textContent: normalized,
      resourceType: 'feed',
      contentType,
      excerpt: buildExcerpt(normalized),
      wordCount: countWords(normalized),
      fallbackUsed: 'document',
      engine: 'feed',
      contentFormat: 'feed',
      confidence: 0.9,
    }
  } catch {
    return null
  }
}

const buildXmlTextResult = (
  text: string,
  url: string,
  maxContentLength: number,
  contentType?: string,
): UrlReadResult | null => {
  const feedResult = buildFeedResultFromXml(text, url, maxContentLength)
  if (feedResult) return feedResult
  const normalized = normalizeTextContent(text, maxContentLength)
  if (normalized.length < CRAWLER_MIN_TEXT_LENGTH) return null
  return {
    title: '',
    url,
    content: '',
    textContent: normalized,
    resourceType: 'text',
    contentType,
    excerpt: buildExcerpt(normalized),
    wordCount: countWords(normalized),
    fallbackUsed: 'document',
    engine: 'text',
    contentFormat: 'xml',
    confidence: 0.75,
  }
}

async function buildCsvResultFromText(
  text: string,
  url: string,
  maxContentLength: number,
  contentType?: string,
): Promise<UrlReadResult | null> {
  try {
    const papaparse = await import('papaparse')
    const parsed = papaparse.parse<Record<string, unknown>>(text, {
      header: true,
      skipEmptyLines: true,
      preview: 1000,
    })
    const fields = parsed.meta.fields || []
    const rows = Array.isArray(parsed.data) ? parsed.data : []
    const rendered = rows
      .map((row, index) => {
        const cells = Object.entries(row)
          .filter(([, value]) => value !== undefined && value !== null && String(value).trim())
          .map(([key, value]) => `${key}: ${String(value)}`)
          .join(', ')
        return `Row ${index + 1}: ${cells}`
      })
      .join('\n')
    const heading = fields.length > 0 ? `Columns: ${fields.join(', ')}\n\n` : ''
    const normalized = normalizeTextContent(`${heading}${rendered}`, maxContentLength)
    if (normalized.length < CRAWLER_MIN_TEXT_LENGTH) return null
    return {
      title: '',
      url,
      content: '',
      textContent: normalized,
      resourceType: 'table',
      contentType,
      excerpt: buildExcerpt(normalized),
      wordCount: countWords(normalized),
      fallbackUsed: 'document',
      engine: 'csv',
      contentFormat: 'csv',
      confidence: 0.9,
    }
  } catch {
    return buildCrawlerResultFromText(text, url, maxContentLength, '', contentType)
  }
}

async function buildPdfResultFromBuffer(
  buffer: Buffer,
  url: string,
  maxContentLength: number,
  contentType?: string,
): Promise<UrlReadResult | null> {
  try {
    const imported = await import('pdf-parse')
    const parsePdf = imported.default
    const data = await parsePdf(buffer, { max: 80 })
    const normalized = normalizeTextContent(data.text || '', maxContentLength)
    if (normalized.length < CRAWLER_MIN_TEXT_LENGTH) return null
    const info = data.info || {}
    const title = typeof info.Title === 'string' ? info.Title.trim() : ''
    return {
      title,
      url,
      content: '',
      textContent: normalized,
      resourceType: 'pdf',
      contentType,
      contentLength: buffer.length,
      excerpt: buildExcerpt(normalized),
      wordCount: countWords(normalized),
      fallbackUsed: 'document',
      engine: 'pdf',
      contentFormat: 'pdf',
      confidence: 0.9,
    }
  } catch {
    return null
  }
}

async function buildDocxResultFromBuffer(
  buffer: Buffer,
  url: string,
  maxContentLength: number,
  contentType?: string,
): Promise<UrlReadResult | null> {
  try {
    const mammoth = await import('mammoth')
    const htmlResult = await mammoth.convertToHtml({ buffer })
    const html = htmlResult.value || ''
    const extracted = extractDocumentFromHtml(html, url, { maxContentLength })
    if (!extracted) return null
    const result = buildDocumentResult(extracted, {
      url,
      finalUrl: url,
      engine: 'docx',
      fallbackUsed: 'document',
      confidence: 0.9,
    })
    return {
      ...result,
      resourceType: 'document',
      contentType,
      contentLength: buffer.length,
      fallbackUsed: 'document',
      engine: 'docx',
      contentFormat: 'docx',
      confidence: 0.9,
    }
  } catch {
    return null
  }
}

const resolveBrowserExecutablePath = (explicitPath?: string): string | undefined => {
  let playwrightPath: string | undefined
  try {
    // Lazy import keeps unit tests that mock playwright-core lightweight.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const playwright = require('playwright-core') as { chromium?: { executablePath?: () => string } }
    playwrightPath = readPlaywrightChromiumExecutablePath(playwright.chromium)
  } catch {
    playwrightPath = undefined
  }
  return resolveSharedBrowserExecutablePath({
    explicitPath,
    playwrightExecutablePath: playwrightPath,
  })
}

class OriginThrottledError extends Error {
  constructor(public readonly retryAfterMs: number | undefined, message = 'Origin asked the client to slow down') {
    super(message)
    this.name = 'OriginThrottledError'
  }
}

const parseRetryAfterMs = (value: string | null, now = Date.now()): number | undefined => {
  const raw = (value || '').trim()
  if (!raw) return undefined
  if (/^\d+$/.test(raw)) return Math.max(0, Number.parseInt(raw, 10) * 1000)
  const at = Date.parse(raw)
  return Number.isNaN(at) ? undefined : Math.max(0, at - now)
}

const isUsableDocument = (doc: ExtractedDocument): boolean =>
  !doc.quality.isThin && !doc.quality.isLoginWall && !doc.quality.isDeletedNotice

const buildDocumentResult = (
  doc: ExtractedDocument,
  options: {
    url: string
    finalUrl: string
    engine: UrlReadEngineName
    fallbackUsed: UrlReadResult['fallbackUsed']
    confidence: number
  },
): UrlReadResult => ({
  title: doc.title,
  url: options.url,
  content: doc.html,
  textContent: doc.text,
  resourceType: 'page',
  contentType: 'text/html',
  excerpt: doc.excerpt,
  byline: doc.byline,
  siteName: doc.siteName,
  lang: doc.lang,
  publishedTime: doc.publishedTime,
  wordCount: doc.wordCount,
  fallbackUsed: options.fallbackUsed,
  engine: options.engine,
  finalUrl: options.finalUrl,
  rendered: options.engine === 'browser',
  contentFormat: 'html',
  confidence: options.confidence,
  leadImageUrl: doc.leadImageUrl,
  images: doc.images,
  contentKind: doc.contentKind === 'structured' ? 'structured' : 'article',
  truncated: doc.maxLengthTruncated,
})

const formatWaybackTimestamp = (value?: string): string | undefined => {
  if (!value || !/^\d{14}$/.test(value)) return undefined
  const iso = value.slice(0, 4) + '-' + value.slice(4, 6) + '-' + value.slice(6, 8) + 'T' +
    value.slice(8, 10) + ':' + value.slice(10, 12) + ':' + value.slice(12, 14) + 'Z'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

async function fetchWaybackMachine(
  url: string,
  options: UrlReaderOptions,
): Promise<UrlReadResult | null> {
  const { timeout = WAYBACK_TIMEOUT, maxContentLength = DEFAULT_MAX_CONTENT_LENGTH } = options
  const deadline = Date.now() + timeout

  try {
    const checkUrl = 'https://archive.org/wayback/available?url=' + encodeURIComponent(url)
    const checkController = new AbortController()
    const checkTimeoutId = setTimeout(() => checkController.abort(), Math.min(timeout, WAYBACK_CHECK_TIMEOUT))
    const checkSignal = combineAbortSignals(checkController.signal, options.signal)

    let availability: {
      archived_snapshots?: {
        closest?: { available?: boolean; url?: string; status?: string; timestamp?: string }
      }
    }
    try {
      const checkResponse = await withAbortSignal(() => fetch(checkUrl, {
        headers: { 'User-Agent': CRAWLER_USER_AGENT, Accept: 'application/json' },
        signal: checkSignal.signal,
      }), checkSignal.signal)
      if (!checkResponse.ok) return null
      availability = await withAbortSignal(() => checkResponse.json(), checkSignal.signal) as typeof availability
    } finally {
      clearTimeout(checkTimeoutId)
      checkSignal.cleanup()
    }

    const snapshot = availability?.archived_snapshots?.closest
    if (!snapshot?.available || !snapshot.url) return null

    await waitWithSignal(WAYBACK_RATE_LIMIT_DELAY_MS, options.signal)
    options.signal?.throwIfAborted()
    const remaining = deadline - Date.now()
    if (remaining <= 0) return null

    const { response, body, finalUrl, contentType } = await fetchPageBody(
      snapshot.url,
      remaining,
      buildCrawlerHeaders(),
      DEFAULT_MAX_BODY_BYTES,
      options.signal,
    )
    if (!response.ok || !body || body.length < CRAWLER_MIN_TEXT_LENGTH) return null
    const archivedAt = formatWaybackTimestamp(snapshot.timestamp)

    if (isHtmlContentType(contentType)) {
      const doc = extractDocumentFromHtml(body, finalUrl, { maxContentLength })
      if (!doc || !isUsableDocument(doc)) return null
      return {
        ...buildDocumentResult(doc, {
          url,
          finalUrl,
          engine: 'wayback',
          fallbackUsed: 'wayback',
          confidence: 0.6,
        }),
        ...(archivedAt ? { archivedAt } : {}),
      }
    }

    const textResult = buildCrawlerResultFromText(body, finalUrl, maxContentLength, '', contentType)
    return textResult
      ? { ...textResult, fallbackUsed: 'wayback', engine: 'wayback', ...(archivedAt ? { archivedAt } : {}) }
      : null
  } catch (error) {
    log.debug('url reader: Wayback Machine fetch failed', {
      url,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

async function trySameOriginFeedFallback(
  url: string,
  budget: ReadBudget,
  maxContentLength: number,
  maxBodyBytes: number,
  pageHtml: string,
): Promise<UrlReadResult | null> {
  const candidates = discoverFeedCandidates(pageHtml, url)
  if (candidates.length === 0) return null
  const lease = budget.beginPhase('feed')
  try {
    for (const candidate of candidates) {
      if (budget.stopError() || lease.remainingMs() <= 0) return null
      try {
        const { response, body, finalUrl, contentType } = await fetchPageBody(
          candidate.url,
          Math.max(1, lease.remainingMs()),
          buildCrawlerHeaders(),
          maxBodyBytes,
          lease.signal,
        )
        if (response.status === 429) {
          throw new OriginThrottledError(parseRetryAfterMs(response.headers.get('retry-after')))
        }
        if (!response.ok || !body) continue
        if (!isFeedContentType(contentType) && !/^\s*<(rss|feed)\b/i.test(body)) continue
        const result = contentType.toLowerCase().includes('json')
          ? buildJsonFeedResultFromText(body, url, maxContentLength, contentType)
          : buildFeedItemResultFromXml(body, url, maxContentLength, finalUrl)
        if (result) return result
      } catch (error) {
        if (error instanceof OriginThrottledError) throw error
        continue
      }
    }
    return null
  } finally {
    lease.release()
  }
}

async function tryCrawlerRefetch(
  url: string,
  budget: ReadBudget,
  maxContentLength: number,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
): Promise<UrlReadResult | null> {
  const lease = budget.beginPhase('crawler')
  try {
    if (budget.stopError() || lease.remainingMs() <= 0) return null
    const { response, body, finalUrl, contentType } = await fetchPageBody(
      url,
      Math.max(1, lease.remainingMs()),
      buildCrawlerHeaders(),
      maxBodyBytes,
      lease.signal,
    )
    if (response.status === 429) {
      throw new OriginThrottledError(parseRetryAfterMs(response.headers.get('retry-after')))
    }
    if (!response.ok || !body) return null
    if (isHtmlContentType(contentType)) {
      if (classifyChallenge({ html: body, status: response.status, url: finalUrl }).isChallenge) return null
      const doc = extractDocumentFromHtml(body, finalUrl, { maxContentLength })
      if (!doc || !isUsableDocument(doc)) return null
      return buildDocumentResult(doc, {
        url,
        finalUrl,
        engine: 'crawler',
        fallbackUsed: 'crawler',
        confidence: 0.7,
      })
    }
    if (isTextLikeContentType(contentType)) {
      return buildCrawlerResultFromText(body, finalUrl, maxContentLength, '', contentType)
    }
    return null
  } catch (error) {
    if (error instanceof OriginThrottledError) throw error
    return null
  } finally {
    lease.release()
  }
}

async function readUrlContentLocal(
  url: string,
  opts: UrlReaderOptions,
  budget: ReadBudget,
): Promise<UrlReadResult> {
  let validatedUrl = url.trim()
  let fetchUrl = validatedUrl
  const timeout = opts.timeout || DEFAULT_TIMEOUT
  const maxContentLength = opts.maxContentLength || DEFAULT_MAX_CONTENT_LENGTH
  const maxBodyBytes = opts.maxBodyBytes || DEFAULT_MAX_BODY_BYTES
  const userAgent = opts.userAgent || DEFAULT_USER_AGENT
  const enableBrowser = opts.enableBrowser ?? (
    process.env.NODE_ENV !== 'test' &&
    process.env.URL_READER_BROWSER_ENABLE !== 'false'
  )
  const attempts: UrlReadAttempt[] = []
  const readStartedAt = Date.now()

  const recordAttempt = (
    startedAt: number,
    engine: UrlReadEngineName,
    status: UrlReadAttempt['status'],
    extra: Omit<UrlReadAttempt, 'engine' | 'status' | 'durationMs'> = {},
  ) => {
    const stopped = budget.stopError()
    attempts.push({
      engine,
      status,
      durationMs: Date.now() - startedAt,
      ...extra,
      ...(stopped ? { status: 'error', error: stopped.message, errorCode: stopped.errorCode } : {}),
    })
  }

  const buildErrorResult = (
    message: string,
    errorCode: UrlReadErrorCode,
    httpStatus?: number,
  ): UrlReadResult => ({
    title: '',
    url: validatedUrl,
    content: '',
    textContent: '',
    error: budget.stopError()?.message || message,
    errorCode: budget.stopError()?.errorCode || errorCode,
    ...(typeof httpStatus === 'number' ? { httpStatus } : {}),
    attempts: [...attempts],
  })

  const toPublicResult = (result: UrlReadResult): UrlReadResult => {
    const stopped = budget.stopError()
    if (stopped) return buildErrorResult(stopped.message, stopped.errorCode)
    const resultFinalUrl = result.finalUrl || result.url
    return {
      ...result,
      url: validatedUrl,
      finalUrl: resultFinalUrl && resultFinalUrl !== validatedUrl ? resultFinalUrl : result.finalUrl,
      attempts: [...attempts],
    }
  }

  const tryPythonExtraction = async (html: string): Promise<UrlReadResult | null> => {
    if (budget.stopError()) return null
    const startedAt = Date.now()
    const lease = budget.beginPhase('python')
    try {
      if (lease.remainingMs() <= 0) return null
      // 冷启动沿用准入总时限：剩余不足 4 秒就不启动 Python，避免 ready 之后再等正文。
      let workerReady = false
      try {
        workerReady = getPythonHtmlExtractor().describeState().workerReady
      } catch {
        workerReady = false
      }
      if (!workerReady && budget.remainingMs() < PYTHON_COLD_START_TIMEOUT_MS) {
        recordAttempt(startedAt, 'python', 'skipped', { error: 'Python 冷启动所需时间不足，已跳过' })
        return null
      }
      const pythonBudget = workerReady ? PYTHON_EXTRACTION_TIMEOUT_MS : PYTHON_COLD_START_TIMEOUT_MS
      const timeoutMs = Math.max(1, Math.min(pythonBudget, lease.remainingMs()))
      const extracted = await withAbortSignal(
        () => extractHtmlWithPython(html, fetchUrl, { signal: lease.signal, timeoutMs }),
        lease.signal,
      )
      const text = extracted?.content ? normalizeTextContent(extracted.content, maxContentLength) : ''
      const quality = assessPlainTextQuality(text)
      if (!extracted || !text || quality.isThin || quality.isLinkFarm) {
        recordAttempt(startedAt, 'python', 'skipped', {
          error: 'Python 正文不可用：' + quality.textLength + ' chars / ' + quality.readableUnits +
            ' units / linkDensity ' + quality.linkDensity.toFixed(2),
        })
        return null
      }
      recordAttempt(startedAt, 'python', 'success', { contentType: 'text/html' })
      log.debug('url reader: python extraction success', { url: validatedUrl, wordCount: countWords(text) })
      return toPublicResult({
        title: (extracted.title || '').trim(),
        url: validatedUrl,
        content: '',
        textContent: text,
        resourceType: 'page',
        excerpt: extracted.excerpt || buildExcerpt(text),
        wordCount: countWords(text),
        fallbackUsed: 'python',
        engine: 'python',
        finalUrl: fetchUrl,
        contentFormat: 'text',
        confidence: 0.75,
        contentKind: 'article',
      })
    } catch (error) {
      recordAttempt(startedAt, 'python', 'error', {
        error: error instanceof Error ? error.message : String(error),
        errorCode: 'UNKNOWN',
      })
      return null
    } finally {
      lease.release()
    }
  }

  const tryFeedFallback = async (reason: string, pageHtml: string): Promise<UrlReadResult | null> => {
    if (budget.stopError()) return null
    const feedStartedAt = Date.now()
    const feedResult = await trySameOriginFeedFallback(
      validatedUrl,
      budget,
      maxContentLength,
      maxBodyBytes,
      pageHtml,
    )
    if (feedResult) {
      recordAttempt(feedStartedAt, 'feed', 'success', {
        finalUrl: feedResult.finalUrl || feedResult.url,
        contentType: feedResult.contentType,
      })
      log.debug('url reader: same-origin feed fallback success', { url: validatedUrl, reason })
      return toPublicResult(feedResult)
    }
    recordAttempt(feedStartedAt, 'feed', 'skipped', {
      error: 'Same-origin feed fallback did not match readable content after ' + reason,
    })
    return null
  }

  const tryBrowserFallback = async (reason: string): Promise<UrlReadResult | null> => {
    if (!enableBrowser || budget.stopError()) return null
    const browserStartedAt = Date.now()
    const executablePath = resolveBrowserExecutablePath(opts.browserExecutablePath)
    if (!executablePath) {
      recordAttempt(browserStartedAt, 'browser', 'skipped', {
        error: 'Local browser renderer is unavailable: no Chromium/Chrome/Edge executable was found',
        errorCode: 'BROWSER_UNAVAILABLE',
      })
      return null
    }
    try {
      const rendered = await renderWithSharedBrowser(fetchUrl, {
        executablePath,
        waitMs: opts.renderWaitMs,
        signal: budget.signal,
        remainingMs: budget.remainingMs,
      })
      const doc = extractDocumentFromHtml(rendered.html, rendered.finalUrl, { maxContentLength })
      if (!doc || !isUsableDocument(doc)) {
        recordAttempt(browserStartedAt, 'browser', 'skipped', {
          error: 'Browser fallback did not extract readable content after ' + reason,
          rendered: true,
        })
        return null
      }
      recordAttempt(browserStartedAt, 'browser', 'success', {
        finalUrl: rendered.finalUrl,
        rendered: true,
        contentType: 'text/html',
      })
      log.debug('url reader: browser fallback success', { url: validatedUrl, reason })
      return toPublicResult({
        ...buildDocumentResult(doc, {
          url: validatedUrl,
          finalUrl: rendered.finalUrl,
          engine: 'browser',
          fallbackUsed: 'browser',
          confidence: 0.82,
        }),
        title: doc.title || rendered.title,
      })
    } catch (error) {
      const capacity = error instanceof BrowserCapacityError
      const errorCode: UrlReadErrorCode = capacity ? 'BROWSER_BUSY' : 'BROWSER_UNAVAILABLE'
      recordAttempt(browserStartedAt, 'browser', 'error', {
        error: error instanceof Error ? error.message : String(error),
        errorCode,
        rendered: true,
      })
      return null
    }
  }

  const tryWaybackFallback = async (reason: string): Promise<UrlReadResult | null> => {
    if (opts.purpose !== 'history' || budget.stopError()) return null
    const waybackStartedAt = Date.now()
    const lease = budget.beginPhase('wayback')
    try {
      if (lease.remainingMs() <= 0) return null
      const waybackResult = await fetchWaybackMachine(validatedUrl, {
        timeout: Math.max(1, Math.min(WAYBACK_TIMEOUT, lease.remainingMs())),
        maxContentLength,
        signal: lease.signal,
      })
      if (!waybackResult) {
        recordAttempt(waybackStartedAt, 'wayback', 'skipped', {
          error: 'Wayback Machine did not return readable content after ' + reason,
        })
        return null
      }
      recordAttempt(waybackStartedAt, 'wayback', 'success', {
        finalUrl: waybackResult.finalUrl || waybackResult.url,
        contentType: waybackResult.contentType,
      })
      log.debug('url reader: Wayback Machine fallback success', { url: validatedUrl, reason })
      return toPublicResult(waybackResult)
    } catch (error) {
      recordAttempt(waybackStartedAt, 'wayback', 'error', {
        error: error instanceof Error ? error.message : String(error),
        errorCode: 'UNKNOWN',
      })
      return null
    } finally {
      lease.release()
    }
  }

  const recover = async (
    reason: string,
    pageHtml: string,
    options: { challenge?: boolean } = {},
  ): Promise<UrlReadResult | null> => {
    if (!options.challenge) {
      const crawlerStartedAt = Date.now()
      const crawlerResult = await tryCrawlerRefetch(fetchUrl, budget, maxContentLength, maxBodyBytes)
      if (crawlerResult) {
        recordAttempt(crawlerStartedAt, 'crawler', 'success', {
          finalUrl: crawlerResult.finalUrl || crawlerResult.url,
          contentType: crawlerResult.contentType,
        })
        log.debug('url reader: crawler fallback success', { url: validatedUrl, reason })
        return toPublicResult(crawlerResult)
      }
      recordAttempt(crawlerStartedAt, 'crawler', 'skipped', {
        error: 'Crawler fallback did not extract readable content after ' + reason,
      })
      const feedResult = await tryFeedFallback(reason, pageHtml)
      if (feedResult) return feedResult
      const browserResult = await tryBrowserFallback(reason)
      if (browserResult) return browserResult
      return tryWaybackFallback(reason)
    }

    // JS challenge / JS shell：直接走浏览器渲染，不再重复抓同一份 HTML；
    // 只有页面显式声明 feed 时才在浏览器失败后尝试 feed。
    const browserResult = await tryBrowserFallback(reason)
    if (browserResult) return browserResult
    if (discoverFeedCandidates(pageHtml, validatedUrl).length > 0) {
      const feedResult = await tryFeedFallback(reason, pageHtml)
      if (feedResult) return feedResult
    } else {
      recordAttempt(readStartedAt, 'feed', 'skipped', {
        error: 'Challenge page declares no feed; feed fallback not applicable',
      })
    }
    return tryWaybackFallback(reason)
  }

  try {
    const stopped = budget.stopError()
    if (stopped) return buildErrorResult(stopped.message, stopped.errorCode)
    validatedUrl = validatePublicHttpUrl(url)
    const transformed = applyUrlTransformRules(validatedUrl)
    fetchUrl = transformed.fetchUrl

    if (transformed.transformedBy) {
      log.debug('url reader: url transform applied', {
        originalUrl: validatedUrl,
        fetchUrl,
        rule: transformed.transformedBy,
      })
    }

    log.debug('url reader: fetching', { url: validatedUrl, fetchUrl })

    const nativeStartedAt = Date.now()
    const nativeLease = budget.beginPhase('native')
    let nativeOutcome: Awaited<ReturnType<typeof fetchPageBody>>
    try {
      nativeOutcome = await fetchPageBody(
        fetchUrl,
        Math.max(1, nativeLease.remainingMs()),
        buildPrimaryHeaders(userAgent),
        maxBodyBytes,
        nativeLease.signal,
      )
    } catch (error) {
      const stop = budget.stopError()
      if (stop) {
        recordAttempt(nativeStartedAt, 'native', 'error', {
          error: stop.message,
          errorCode: stop.errorCode,
        })
        return buildErrorResult(stop.message, stop.errorCode)
      }
      const name = error && typeof error === 'object' ? (error as { name?: string }).name : undefined
      // 只有阶段预算到期（TimeoutError）才继续回退；调用方取消（AbortError）必须立即结束。
      if (name === 'TimeoutError') {
        // 仅是 5s 原生抓取阶段到期：记录后继续用剩余总预算走回退。
        recordAttempt(nativeStartedAt, 'native', 'error', {
          error: '原生抓取阶段超时（5s），改用回退通道',
          errorCode: 'TIMEOUT',
        })
        const recovered = await recover('native phase timeout', '')
        if (recovered) return recovered
        return buildErrorResult('网页抓取超时：原生抓取阶段预算已用完，回退通道也未取到正文', 'TIMEOUT')
      }
      throw error
    } finally {
      nativeLease.release()
    }
    const { response, body: responseBody, buffer: responseBuffer, finalUrl, contentType } = nativeOutcome
    const stoppedAfterFetch = budget.stopError()
    if (stoppedAfterFetch) return buildErrorResult(stoppedAfterFetch.message, stoppedAfterFetch.errorCode)
    const status = response.status
    const statusText = response.statusText || 'Request failed'
    const bodySnippet = responseBody.slice(0, 4000)
    const normalizedContentType = sanitizeContentType(contentType)

    if (status === 429) {
      const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'))
      const retryText = retryAfterMs === undefined
        ? '服务端要求稍后重试'
        : '服务端要求约 ' + Math.ceil(retryAfterMs / 1000) + ' 秒后重试'
      const message = 'HTTP 429: Too Many Requests（' + retryText + '，本次读取已停止，不再请求该来源）'
      recordAttempt(nativeStartedAt, 'native', 'error', {
        error: message,
        errorCode: 'HTTP_429',
        httpStatus: status,
        contentType: normalizedContentType,
        finalUrl,
      })
      return {
        ...buildErrorResult(message, 'HTTP_429', status),
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      }
    }

    if (!response.ok) {
      const errorCode = classifyHttpErrorCode(status, bodySnippet)
      const blockedByChallenge = classifyChallenge({ html: bodySnippet, status, url: finalUrl }).isChallenge
      const finalCode = blockedByChallenge ? 'JS_CHALLENGE' : errorCode
      recordAttempt(nativeStartedAt, 'native', 'error', {
        error: 'HTTP ' + status + ': ' + statusText,
        errorCode: finalCode,
        httpStatus: status,
        contentType: normalizedContentType,
        finalUrl,
      })
      if (finalCode !== 'ROBOTS_DENIED') {
        if (!blockedByChallenge && status !== 404) {
          const crawlerStartedAt = Date.now()
          const crawlerResult = await tryCrawlerRefetch(fetchUrl, budget, maxContentLength, maxBodyBytes)
          if (crawlerResult) {
            recordAttempt(crawlerStartedAt, 'crawler', 'success', {
              finalUrl: crawlerResult.finalUrl || crawlerResult.url,
              contentType: crawlerResult.contentType,
            })
            return toPublicResult(crawlerResult)
          }
        }
        const recovered = await recover('HTTP ' + status + (blockedByChallenge ? ' (JS challenge)' : ''), responseBody, {
          challenge: blockedByChallenge,
        })
        if (recovered) return recovered
      }
      const message = finalCode === 'ROBOTS_DENIED'
        ? 'HTTP ' + status + ': ' + statusText + ' (robots denied)'
        : 'HTTP ' + status + ': ' + statusText
      log.error('url reader: failed', { url: validatedUrl, error: message, errorCode: finalCode, httpStatus: status })
      return buildErrorResult(message, finalCode, status)
    }

    if (isImageContentType(contentType)) {
      recordAttempt(nativeStartedAt, 'image', 'success', {
        contentType: normalizedContentType,
        finalUrl,
      })
      log.debug('url reader: direct image detected', { url: validatedUrl, contentType: normalizedContentType })
      return toPublicResult({
        ...buildDirectImageResult(response, finalUrl),
        finalUrl,
        engine: 'image',
        contentFormat: 'image',
        confidence: 1,
      })
    }

    if ((isPdfContentType(contentType) || isLikelyPdfUrl(finalUrl)) && responseBuffer) {
      const pdfResult = await buildPdfResultFromBuffer(responseBuffer, finalUrl, maxContentLength, normalizedContentType)
      if (pdfResult) {
        recordAttempt(nativeStartedAt, 'pdf', 'success', { contentType: normalizedContentType, finalUrl })
        return toPublicResult(pdfResult)
      }
      recordAttempt(nativeStartedAt, 'pdf', 'error', {
        error: 'Failed to extract text from PDF',
        errorCode: 'PARSE_EMPTY',
        contentType: normalizedContentType,
        finalUrl,
      })
      return buildErrorResult('Failed to extract text from PDF', 'PARSE_EMPTY')
    }

    if ((isDocxContentType(contentType) || isLikelyDocxUrl(finalUrl)) && responseBuffer) {
      const docxResult = await buildDocxResultFromBuffer(responseBuffer, finalUrl, maxContentLength, normalizedContentType)
      if (docxResult) {
        recordAttempt(nativeStartedAt, 'docx', 'success', { contentType: normalizedContentType, finalUrl })
        return toPublicResult(docxResult)
      }
      recordAttempt(nativeStartedAt, 'docx', 'error', {
        error: 'Failed to extract text from DOCX',
        errorCode: 'PARSE_EMPTY',
        contentType: normalizedContentType,
        finalUrl,
      })
      return buildErrorResult('Failed to extract text from DOCX', 'PARSE_EMPTY')
    }

    if (!isHtmlContentType(contentType)) {
      if (budget.stopError()) return buildErrorResult('Request was cancelled', 'CANCELLED')
      if (isFeedContentType(contentType) || /^\s*<(rss|feed)\b/i.test(responseBody)) {
        const feedResult = contentType.toLowerCase().includes('json')
          ? buildJsonFeedResultFromText(responseBody, finalUrl, maxContentLength, normalizedContentType)
          : buildFeedResultFromXml(responseBody, finalUrl, maxContentLength)
        if (feedResult) {
          recordAttempt(nativeStartedAt, 'feed', 'success', { contentType: normalizedContentType, finalUrl })
          return toPublicResult(feedResult)
        }
      }

      if ((isCsvContentType(contentType) || isLikelyCsvUrl(finalUrl)) && responseBody) {
        const csvResult = await buildCsvResultFromText(responseBody, finalUrl, maxContentLength, normalizedContentType)
        if (csvResult) {
          recordAttempt(nativeStartedAt, 'csv', 'success', { contentType: normalizedContentType, finalUrl })
          return toPublicResult(csvResult)
        }
      }

      if (isTextLikeContentType(contentType)) {
        const lowerContentType = contentType.toLowerCase()
        const textResult = lowerContentType.includes('json') || lowerContentType.includes('+json')
          ? buildJsonResultFromText(responseBody, finalUrl, maxContentLength, normalizedContentType)
          : lowerContentType.includes('xml') || lowerContentType.includes('+xml')
            ? buildXmlTextResult(responseBody, finalUrl, maxContentLength, normalizedContentType)
            : buildCrawlerResultFromText(responseBody, finalUrl, maxContentLength, '', normalizedContentType)
        if (textResult) {
          recordAttempt(nativeStartedAt, textResult.engine || 'text', 'success', {
            contentType: normalizedContentType,
            finalUrl,
          })
          log.debug('url reader: text payload extracted', { url: validatedUrl, contentType })
          return toPublicResult(textResult)
        }
      }
      const message = 'Unsupported content type: ' + contentType + '. Only HTML pages are supported.'
      recordAttempt(nativeStartedAt, 'native', 'error', {
        error: message,
        errorCode: 'UNSUPPORTED_CONTENT_TYPE',
        contentType: normalizedContentType,
        finalUrl,
      })
      log.error('url reader: failed', {
        url: validatedUrl,
        error: message,
        errorCode: 'UNSUPPORTED_CONTENT_TYPE',
      })
      return buildErrorResult(message, 'UNSUPPORTED_CONTENT_TYPE')
    }

    const html = responseBody
    const challenge = classifyChallenge({ html, status, url: finalUrl })
    if (challenge.isChallenge) {
      recordAttempt(nativeStartedAt, 'native', 'error', {
        error: 'The page appears to be protected by a JavaScript challenge or anti-bot verification',
        errorCode: 'JS_CHALLENGE',
        contentType: normalizedContentType,
        finalUrl,
      })
      const recovered = await recover('JS challenge detection', html, { challenge: true })
      if (recovered) return recovered
      const message = 'The page appears to be protected by a JavaScript challenge or anti-bot verification'
      log.error('url reader: failed', { url: validatedUrl, error: message, errorCode: 'JS_CHALLENGE' })
      return buildErrorResult(message, 'JS_CHALLENGE')
    }

    if (!html || html.trim().length < 100) {
      recordAttempt(nativeStartedAt, 'native', 'error', {
        error: 'Page content is empty or too short',
        errorCode: 'EMPTY_CONTENT',
        contentType: normalizedContentType,
        finalUrl,
      })
      const pythonOnEmpty = await tryPythonExtraction(html)
      if (pythonOnEmpty) return pythonOnEmpty
      const recovered = await recover('empty content', html)
      if (recovered) return recovered
      const message = 'Page content is empty or too short'
      log.error('url reader: failed', { url: validatedUrl, error: message, errorCode: 'EMPTY_CONTENT' })
      return buildErrorResult(message, 'EMPTY_CONTENT')
    }

    log.debug('url reader: parsing', { url: validatedUrl, htmlLength: html.length })

    const doc = extractDocumentFromHtml(html, finalUrl, { maxContentLength })
    if (doc && isUsableDocument(doc)) {
      recordAttempt(nativeStartedAt, 'native', 'success', {
        contentType: normalizedContentType,
        finalUrl,
      })
      log.debug('url reader: success', {
        url: validatedUrl,
        title: doc.title,
        wordCount: doc.wordCount,
      })
      return toPublicResult(buildDocumentResult(doc, {
        url: validatedUrl,
        finalUrl,
        engine: 'native',
        fallbackUsed: 'none',
        confidence: 0.9,
      }))
    }

    const pythonResult = await tryPythonExtraction(html)
    if (pythonResult) return pythonResult

    const recovered = await recover('native extraction insufficient', html)
    if (recovered) return recovered

    {
      const message = 'Failed to extract article content. The page structure may not be suitable for reading mode.'
      recordAttempt(nativeStartedAt, 'native', 'error', {
        error: message,
        errorCode: 'PARSE_EMPTY',
        contentType: normalizedContentType,
        finalUrl,
      })
      log.error('url reader: failed', { url: validatedUrl, error: message, errorCode: 'PARSE_EMPTY' })
      return buildErrorResult(message, 'PARSE_EMPTY')
    }
  } catch (error) {
    if (error instanceof OriginThrottledError) {
      const retryText = error.retryAfterMs === undefined
        ? '服务端要求稍后重试'
        : '服务端要求约 ' + Math.ceil(error.retryAfterMs / 1000) + ' 秒后重试'
      const message = 'HTTP 429: Too Many Requests（' + retryText + '，本次读取已停止，不再请求该来源）'
      recordAttempt(readStartedAt, 'native', 'error', { error: message, errorCode: 'HTTP_429' })
      return {
        ...buildErrorResult(message, 'HTTP_429', 429),
        ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
      }
    }
    const classified = classifyThrownError(error)
    const shouldTryFallback =
      !budget.stopError() && classified.errorCode !== 'TIMEOUT' && classified.errorCode !== 'CANCELLED' &&
      classified.errorCode !== 'DISALLOWED_URL' && classified.errorCode !== 'INVALID_URL'

    if (shouldTryFallback) {
      const recovered = await recover('thrown error: ' + classified.errorCode, '')
      if (recovered) return recovered
    }

    const message = classified.errorCode === 'TIMEOUT'
      ? 'Request timeout after ' + timeout / 1000 + ' seconds'
      : classified.message
    log.error('url reader: failed', { url: validatedUrl, error: message, errorCode: classified.errorCode })
    return buildErrorResult(message, classified.errorCode)
  }
}

async function executeRead(url: string, opts: UrlReaderOptions): Promise<UrlReadResult> {
  const timeout = Number.isFinite(opts.timeout) && (opts.timeout as number) > 0
    ? Math.max(1, Math.floor(opts.timeout as number)) : DEFAULT_TIMEOUT
  const budget = createReadBudget({ totalMs: timeout, signal: opts.signal })
  try {
  const stoppedResult = (result: UrlReadResult): UrlReadResult => {
    const stopped = budget.stopError()
    return stopped
      ? { ...result, content: '', textContent: '', error: stopped.message, errorCode: stopped.errorCode }
      : result
  }
  if (budget.stopError()) {
    return stoppedResult({ title: '', url: url.trim(), content: '', textContent: '', attempts: [] })
  }
  const localResult = await readUrlContentLocal(url, { ...opts, timeout }, budget)
  const apiKey = (opts.deepseekApiKey || '').trim()
  if (budget.stopError() || !opts.enableDeepseekFallback || !apiKey ||
    localResult.errorCode === 'TIMEOUT' || localResult.errorCode === 'CANCELLED' ||
    !isEligibleForDeepSeekFallback(localResult, url)) {
    return stoppedResult(localResult)
  }

  const startedAt = Date.now()
  try {
    const fetched = await withAbortSignal(() => runDeepSeekFetch(localResult.url || url, {
      apiKey,
      signal: budget.signal,
      timeoutMs: budget.remainingMs(),
    }), budget.signal)
    const content = normalizeTextContent(fetched.content, opts.maxContentLength || DEFAULT_MAX_CONTENT_LENGTH)
    return stoppedResult({
      title: fetched.title,
      url: localResult.url || url,
      finalUrl: localResult.url || url,
      content: '',
      textContent: content,
      resourceType: 'page',
      excerpt: buildExcerpt(content),
      wordCount: countWords(content),
      fallbackUsed: 'deepseek_fetch',
      engine: 'deepseek_fetch',
      contentFormat: 'markdown',
      confidence: 0.7,
      attempts: [
        ...(localResult.attempts || []),
        { engine: 'deepseek_fetch', status: 'success', durationMs: Date.now() - startedAt },
      ],
    })
  } catch (error) {
    const stopped = budget.stopError()
    const toolCode = error instanceof DeepSeekToolError ? error.code : undefined
    const terminalCode = stopped?.errorCode || (toolCode === 'TIMEOUT' || toolCode === 'CANCELLED' ? toolCode : undefined)
    const message = stopped?.message || (error instanceof DeepSeekToolError
      ? error.message : 'DeepSeek fetch failed before receiving a readable page')
    return {
      ...localResult,
      ...(terminalCode ? { error: message, errorCode: terminalCode } : {}),
      attempts: [
        ...(localResult.attempts || []),
        {
          engine: 'deepseek_fetch',
          status: 'error',
          durationMs: Date.now() - startedAt,
          error: message,
          errorCode: terminalCode || (error instanceof DeepSeekToolError ? 'FETCH_FAILED' : 'UNKNOWN'),
        },
      ],
    }
  }
  } finally {
    budget.dispose()
  }
}

const resultCache = new BoundedMemoryStore<UrlReadResult>({ maxEntries: 32, maxBytes: 4 * 1024 * 1024 })
const inFlightReads = new InFlightReads<UrlReadResult>({ maxInFlight: 32 })

const buildReadCacheKey = (url: string, opts: UrlReaderOptions): string => JSON.stringify([
  url,
  opts.purpose ?? 'current',
  opts.maxContentLength ?? DEFAULT_MAX_CONTENT_LENGTH,
  opts.enableBrowser !== false ? 'browser' : 'no-browser',
  opts.enableDeepseekFallback ? 'deepseek' : 'no-deepseek',
  opts.userAgent ?? '',
  opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
  opts.renderWaitMs ?? '',
])

/**
 * 读取网页正文。同一 URL（相同用途与影响结果的配置）共享在途任务；
 * 默认使用有界短缓存，current/时效页面绕过缓存。
 */
export async function readUrlContent(
  url: string,
  opts: UrlReaderOptions = {},
): Promise<UrlReadResult> {
  const timeout = Number.isFinite(opts.timeout) && (opts.timeout as number) > 0
    ? Math.max(1, Math.floor(opts.timeout as number)) : DEFAULT_TIMEOUT
  const maxContentLength = opts.maxContentLength || DEFAULT_MAX_CONTENT_LENGTH
  const provided = opts.providedContent

  if (provided && provided.kind === 'article') {
    try {
      const validated = validatePublicHttpUrl(url)
      const content = normalizeTextContent(provided.content, maxContentLength)
      if (content.length >= MIN_PROVIDED_CONTENT_CHARS) {
        return {
          title: '',
          url: validated,
          content: '',
          textContent: content,
          resourceType: 'page',
          excerpt: buildExcerpt(content),
          wordCount: countWords(content),
          engine: 'provided',
          fallbackUsed: 'provided',
          contentKind: 'article',
          fetchedAt: provided.fetchedAt,
          attempts: [],
        }
      }
    } catch (error) {
      const classified = classifyThrownError(error)
      return {
        title: '',
        url: url.trim(),
        content: '',
        textContent: '',
        error: classified.message,
        errorCode: classified.errorCode,
        attempts: [],
      }
    }
  }

  // 测试默认不共享跨用例缓存，需要验证缓存时显式传 cacheTtlMs。
  const testsDisableCache = process.env.NODE_ENV === 'test' && opts.cacheTtlMs === undefined
  const bypassCache =
    testsDisableCache || opts.freshness === 'current' || opts.purpose === 'history' || isTimeSensitiveUrl(url)
  const key = buildReadCacheKey(url, opts)
  if (!bypassCache) {
    const hit = resultCache.get(key)
    if (hit) {
      log.debug('url reader: bounded cache hit', { url })
      return { ...hit.value, attempts: [...(hit.value.attempts || [])] }
    }
  }

  const run = (signal: AbortSignal) => executeRead(url, { ...opts, timeout, signal })
  let result: UrlReadResult
  try {
    result = await inFlightReads.run(key, run, opts.signal)
  } catch (error) {
    if (error && typeof error === 'object' && (error as { name?: string }).name === 'AbortError') {
      return {
        title: '',
        url: url.trim(),
        content: '',
        textContent: '',
        error: 'Request was cancelled',
        errorCode: 'CANCELLED',
        attempts: [],
      }
    }
    throw error
  }
  if (opts.signal?.aborted) {
    return {
      ...result,
      content: '',
      textContent: '',
      error: 'Request was cancelled',
      errorCode: 'CANCELLED',
    }
  }
  const finalResult = result.error ? result : { ...result, fetchedAt: result.fetchedAt || new Date().toISOString() }

  if (!bypassCache && !finalResult.error) {
    const bytes = Buffer.byteLength(finalResult.textContent || '', 'utf8')
    if (bytes > 0 && bytes <= MAX_CACHE_ENTRY_BYTES) {
      resultCache.set(key, finalResult, {
        ttlMs: resolveReadCacheTtlMs(url, opts.cacheTtlMs),
        bytes,
      })
    }
  }
  return finalResult
}

const isUnsupportedFallbackContentType = (contentType: string): boolean => {
  const normalized = (contentType || '').toLowerCase()
  if (!normalized) return false
  return (
    isPdfContentType(normalized) ||
    isImageContentType(normalized) ||
    (!isHtmlContentType(normalized) &&
      !isTextLikeContentType(normalized) &&
      !isFeedContentType(normalized) &&
      !isCsvContentType(normalized))
  )
}

const isNonPageResource = (result: UrlReadResult, url: string): boolean => {
  if (result.resourceType === 'image' || result.resourceType === 'pdf') return true
  if (
    (result.attempts || []).some(
      (attempt) =>
        attempt.engine === 'pdf' ||
        attempt.engine === 'image' ||
        attempt.engine === 'docx' ||
        attempt.engine === 'csv' ||
        (attempt.contentType && isUnsupportedFallbackContentType(attempt.contentType)),
    )
  ) {
    return true
  }
  const contentType = (result.contentType || '').toLowerCase()
  if (contentType && isUnsupportedFallbackContentType(contentType)) return true
  return (
    /\.(?:png|jpe?g|gif|webp|svg|bmp|avif|pdf)(?:[?#]|$)/i.test(url) ||
    result.contentFormat === 'pdf' ||
    result.contentFormat === 'image'
  )
}

const isEligibleForDeepSeekFallback = (result: UrlReadResult, url: string): boolean => {
  if (!result.error) return false
  if (result.errorCode === 'DISALLOWED_URL' || result.errorCode === 'INVALID_URL') return false
  return !isNonPageResource(result, url)
}

/**
 * 格式化读取结果供模型使用
 */
export function formatUrlContentForModel(result: UrlReadResult): string {
  if (result.error) {
    const suffix = [
      result.errorCode ? '错误码: ' + result.errorCode : null,
      typeof result.httpStatus === 'number' ? 'HTTP: ' + result.httpStatus : null,
    ].filter(Boolean).join('，')
    return suffix
      ? '无法读取网页 "' + result.url + '"：' + result.error + '（' + suffix + '）'
      : '无法读取网页 "' + result.url + '"：' + result.error
  }

  if (result.resourceType === 'image') {
    const parts: string[] = []
    parts.push('## 图片资源')
    parts.push('- **URL**: ' + result.url)
    if (result.finalUrl && result.finalUrl !== result.url) parts.push('- **最终地址**: ' + result.finalUrl)
    if (result.contentType) parts.push('- **类型**: ' + result.contentType)
    if (typeof result.contentLength === 'number') parts.push('- **大小**: ' + result.contentLength + ' bytes')
    if (result.leadImageUrl) parts.push('- **图片**: ' + result.leadImageUrl)
    parts.push('')
    parts.push('该 URL 直接指向图片资源，没有可提取的网页正文。')
    return parts.join('\n')
  }

  const parts: string[] = []
  parts.push('## 网页信息')
  parts.push('- **URL**: ' + result.url)
  if (result.finalUrl && result.finalUrl !== result.url) parts.push('- **最终地址**: ' + result.finalUrl)
  if (result.title) parts.push('- **标题**: ' + result.title)
  if (result.byline) parts.push('- **作者**: ' + result.byline)
  if (result.siteName) parts.push('- **来源**: ' + result.siteName)
  if (result.publishedTime) parts.push('- **发布时间**: ' + result.publishedTime)
  if (result.archivedAt) parts.push('- **存档时间**: ' + result.archivedAt)
  if (result.wordCount) parts.push('- **字数**: 约 ' + result.wordCount + ' 字/词')
  if (result.contentKind === 'structured') {
    parts.push('- **内容类型**: 结构化列表/表格')
  } else if (result.contentKind === 'summary') {
    parts.push('- **内容类型**: 摘要')
  }
  if (result.fallbackUsed === 'crawler') {
    parts.push('- **提取方式**: 爬虫回退')
  } else if (result.fallbackUsed === 'browser') {
    parts.push('- **提取方式**: 本地浏览器渲染')
  } else if (result.fallbackUsed === 'deepseek_fetch') {
    parts.push('- **提取方式**: DeepSeek 网页抓取')
  } else if (result.fallbackUsed === 'python') {
    parts.push('- **提取方式**: Python/Trafilatura 提取')
  } else if (result.fallbackUsed === 'provided') {
    parts.push('- **提取方式**: 复用搜索正文')
  } else if (result.fallbackUsed === 'document') {
    parts.push('- **提取方式**: ' + (result.engine || '文档/结构化内容') + ' 引擎')
  } else if (result.fallbackUsed === 'wayback') {
    parts.push('- **提取方式**: Wayback Machine 存档')
  } else {
    parts.push('- **提取方式**: 标准正文提取')
  }
  if (typeof result.confidence === 'number') {
    parts.push('- **置信度**: ' + Math.round(result.confidence * 100) + '%')
  }

  if (result.excerpt) {
    parts.push('')
    parts.push('## 摘要')
    parts.push(result.excerpt)
  }

  const images = Array.isArray(result.images) ? result.images : []
  if (result.leadImageUrl || images.length > 0) {
    parts.push('')
    parts.push('## 图片证据')
    if (result.leadImageUrl) parts.push('- **主图**: ' + result.leadImageUrl)
    const candidateImages = images.filter((item) => item.url && item.url !== result.leadImageUrl).slice(0, 5)
    if (candidateImages.length > 0) {
      parts.push('- **候选图**:')
      for (const [index, image] of candidateImages.entries()) {
        const sourceLabel = image.source ? ' [' + image.source + ']' : ''
        const altLabel = image.alt ? '（' + image.alt + '）' : ''
        parts.push('  ' + (index + 1) + '. ' + image.url + altLabel + sourceLabel)
      }
    }
  }

  parts.push('')
  parts.push('## 正文内容')
  parts.push(result.textContent)

  return parts.join('\n')
}

/**
 * 检查 URL 是否可能需要 JavaScript 渲染
 */
export function checkIfLikelySPA(url: string): boolean {
  const spaIndicators = [
    /angular/i,
    /react/i,
    /vue/i,
    /twitter\.com/i,
    /x\.com/i,
    /instagram\.com/i,
    /facebook\.com/i,
    /linkedin\.com\/feed/i,
    /#\//,
  ]

  return spaIndicators.some((pattern) => pattern.test(url))
}
