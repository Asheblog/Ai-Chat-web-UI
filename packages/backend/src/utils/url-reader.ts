/**
 * URL 内容读取工具
 * 使用 @mozilla/readability + jsdom 自建实现
 * 无需外部 API，完全本地处理
 */

import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'
import { existsSync } from 'node:fs'
import { isIP } from 'node:net'
import path from 'node:path'
import { BackendLogger as log } from './logger'

export type UrlReadErrorCode =
  | 'INVALID_URL'
  | 'DISALLOWED_URL'
  | 'HTTP_403'
  | 'HTTP_404'
  | 'HTTP_4XX'
  | 'HTTP_5XX'
  | 'HTTP_ERROR'
  | 'JS_CHALLENGE'
  | 'ROBOTS_DENIED'
  | 'UNSUPPORTED_CONTENT_TYPE'
  | 'EMPTY_CONTENT'
  | 'PARSE_EMPTY'
  | 'TIMEOUT'
  | 'FETCH_FAILED'
  | 'BODY_TOO_LARGE'
  | 'BROWSER_UNAVAILABLE'
  | 'UNKNOWN'

export type UrlReadEngineName =
  | 'native'
  | 'crawler'
  | 'browser'
  | 'image'
  | 'text'
  | 'feed'
  | 'pdf'
  | 'docx'
  | 'csv'

export interface UrlReadAttempt {
  engine: UrlReadEngineName
  status: 'success' | 'error' | 'skipped'
  durationMs: number
  error?: string
  errorCode?: UrlReadErrorCode
  httpStatus?: number
  contentType?: string
  finalUrl?: string
  rendered?: boolean
}

export interface UrlReadResult {
  title: string
  url: string
  content: string
  textContent: string
  resourceType?: 'page' | 'image' | 'text' | 'feed' | 'pdf' | 'document' | 'table'
  contentType?: string
  contentLength?: number
  excerpt?: string
  byline?: string
  siteName?: string
  lang?: string
  publishedTime?: string
  wordCount?: number
  error?: string
  errorCode?: UrlReadErrorCode
  httpStatus?: number
  fallbackUsed?: 'none' | 'crawler' | 'browser' | 'document'
  engine?: UrlReadEngineName
  attempts?: UrlReadAttempt[]
  finalUrl?: string
  rendered?: boolean
  confidence?: number
  contentFormat?: 'html' | 'text' | 'markdown' | 'json' | 'xml' | 'feed' | 'pdf' | 'docx' | 'csv' | 'image'
  leadImageUrl?: string
  images?: UrlReadImage[]
}

export interface UrlReaderOptions {
  timeout?: number
  maxContentLength?: number
  userAgent?: string
  maxBodyBytes?: number
  enableBrowser?: boolean
  browserExecutablePath?: string
  renderWaitMs?: number
}

export interface UrlReadImage {
  url: string
  alt?: string
  width?: number
  height?: number
  source: 'meta' | 'content' | 'crawler' | 'direct'
}

const DEFAULT_TIMEOUT = 30000
const DEFAULT_MAX_CONTENT_LENGTH = 100000
const DEFAULT_MAX_BODY_BYTES = 8 * 1024 * 1024
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; AIChat/1.0; +https://github.com/Asheblog/aichat)'
const CRAWLER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
const CRAWLER_MIN_TEXT_LENGTH = 40
const MAX_EXTRACTED_IMAGES = 8
const MAX_HTML_PARSE_LENGTH = 1024 * 1024
const MAX_FETCH_REDIRECTS = 5
const DEFAULT_BROWSER_WAIT_MS = 1200
const MAX_BROWSER_WAIT_MS = 8000
const JS_CHALLENGE_PATTERNS: RegExp[] = [
  /cf-chl/i,
  /cloudflare/i,
  /captcha/i,
  /enable javascript/i,
  /attention required/i,
  /just a moment/i,
  /verify you are human/i,
]

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

const isPrivateIPv4 = (ip: string): boolean => {
  const parts = ip.split('.').map((item) => Number.parseInt(item, 10))
  if (parts.length !== 4 || parts.some((item) => !Number.isFinite(item) || item < 0 || item > 255)) {
    return false
  }

  const [a, b] = parts

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  )
}

const isPrivateIPv6 = (ip: string): boolean => {
  const normalized = ip.toLowerCase()
  if (normalized === '::' || normalized === '::1') return true
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true
  if (/^fe[89ab]/.test(normalized)) return true
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice('::ffff:'.length)
    if (isIP(mapped) === 4 && isPrivateIPv4(mapped)) return true
  }
  return false
}

const isDisallowedHost = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase()
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal')
  ) {
    return true
  }

  const ipVersion = isIP(normalized)
  if (ipVersion === 4) return isPrivateIPv4(normalized)
  if (ipVersion === 6) return isPrivateIPv6(normalized)
  return false
}

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

const trimHtmlForParsing = (html: string): string => {
  if (!html) return ''
  if (html.length <= MAX_HTML_PARSE_LENGTH) return html
  return html.slice(0, MAX_HTML_PARSE_LENGTH)
}

/**
 * 验证 URL 格式和安全性
 */
export function validatePublicHttpUrl(url: string): string {
  let normalized = url.trim()

  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `https://${normalized}`
  }

  try {
    const parsed = new URL(normalized)
    const hostname = parsed.hostname

    if (isDisallowedHost(hostname)) {
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

function detectJsChallenge(html: string): boolean {
  const normalized = (html || '').toLowerCase()
  if (!normalized) return false
  return JS_CHALLENGE_PATTERNS.some((pattern) => pattern.test(normalized))
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
  if (error instanceof Error) {
    if (error.name === 'AbortError') {
      return { message: error.message, errorCode: 'TIMEOUT' }
    }
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

const extractSrcFromSrcSet = (value: string | null): string | null => {
  if (!value) return null
  const first = value
    .split(',')
    .map((item) => item.trim())
    .find(Boolean)
  if (!first) return null
  const url = first.split(/\s+/)[0]?.trim()
  return url || null
}

const sanitizeContentType = (contentType: string | null | undefined): string | undefined => {
  const normalized = (contentType || '').trim().toLowerCase()
  if (!normalized) return undefined
  return normalized.split(';')[0]?.trim() || undefined
}

const normalizeImageUrl = (value: string | null | undefined, baseUrl: string): string | null => {
  if (!value) return null
  const raw = value.trim()
  if (!raw) return null
  // 避免把大段 base64 data URL 写入日志、上下文和工具事件。
  if (/^data:image\//i.test(raw)) return null
  if (/^https?:\/\//i.test(raw)) {
    try {
      return validatePublicHttpUrl(raw)
    } catch {
      return null
    }
  }
  if (raw.startsWith('//')) {
    try {
      return validatePublicHttpUrl(`https:${raw}`)
    } catch {
      return null
    }
  }
  try {
    const normalized = new URL(raw, baseUrl).toString()
    validatePublicHttpUrl(normalized)
    return normalized
  } catch {
    return null
  }
}

const isLikelyDecorativeImage = (url: string): boolean => {
  const normalized = url.toLowerCase()
  return (
    normalized.includes('favicon') ||
    normalized.includes('sprite') ||
    normalized.includes('/logo') ||
    normalized.includes('icon')
  )
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
): Promise<Buffer> {
  const declaredLength = parseContentLength(response)
  if (typeof declaredLength === 'number' && declaredLength > maxBodyBytes) {
    throw new Error(`Response body is too large: ${declaredLength} bytes exceeds ${maxBodyBytes}`)
  }

  if (!response.body || typeof response.body.getReader !== 'function') {
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > maxBodyBytes) {
      throw new Error(`Response body is too large: ${buffer.length} bytes exceeds ${maxBodyBytes}`)
    }
    return buffer
  }

  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    const chunk = Buffer.from(value)
    total += chunk.length
    if (total > maxBodyBytes) {
      try {
        await reader.cancel()
      } catch {
        // ignore cancel failures
      }
      throw new Error(`Response body is too large: ${total} bytes exceeds ${maxBodyBytes}`)
    }
    chunks.push(chunk)
  }

  return Buffer.concat(chunks, total)
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

const collectImagesFromDocument = (
  doc: any,
  baseUrl: string,
  contentSource: 'content' | 'crawler',
): { leadImageUrl?: string; images?: UrlReadImage[] } => {
  if (!doc) return {}

  const images: UrlReadImage[] = []
  const seen = new Set<string>()
  const pushImage = (item: UrlReadImage) => {
    const normalizedUrl = item.url.trim()
    if (!normalizedUrl || seen.has(normalizedUrl)) return
    seen.add(normalizedUrl)
    images.push(item)
  }

  const metaImageCandidates = [
    doc.querySelector('meta[property="og:image"]')?.getAttribute('content'),
    doc.querySelector('meta[property="og:image:url"]')?.getAttribute('content'),
    doc.querySelector('meta[name="twitter:image"]')?.getAttribute('content'),
    doc.querySelector('meta[name="twitter:image:src"]')?.getAttribute('content'),
  ]
  for (const candidate of metaImageCandidates) {
    const normalized = normalizeImageUrl(candidate, baseUrl)
    if (!normalized) continue
    pushImage({
      url: normalized,
      source: 'meta',
    })
  }

  const contentRoots = Array.from(
    doc.querySelectorAll('article,main,[role="main"],.article-content,.post-content,.entry-content') as
      | ArrayLike<DomLikeElement>
      | Iterable<DomLikeElement>,
  )
  if (contentRoots.length === 0 && doc.body) {
    contentRoots.push(doc.body as DomLikeElement)
  }
  const imageElements = contentRoots.flatMap((root) =>
    Array.from(root.querySelectorAll('img') as ArrayLike<DomLikeElement> | Iterable<DomLikeElement>),
  )
  for (const element of imageElements) {
    const src =
      element.getAttribute('src') ||
      element.getAttribute('data-src') ||
      element.getAttribute('data-original') ||
      extractSrcFromSrcSet(element.getAttribute('srcset'))
    const normalized = normalizeImageUrl(src, baseUrl)
    if (!normalized || isLikelyDecorativeImage(normalized)) continue

    pushImage({
      url: normalized,
      alt: (element.getAttribute('alt') || '').trim() || undefined,
      width: parsePositiveInt(element.getAttribute('width')),
      height: parsePositiveInt(element.getAttribute('height')),
      source: contentSource,
    })
  }

  if (images.length === 0) return {}
  const bounded = images.slice(0, MAX_EXTRACTED_IMAGES)
  const leadImageUrl = bounded[0]?.url
  return {
    leadImageUrl,
    images: bounded,
  }
}

async function fetchPageBody(
  url: string,
  timeout: number,
  headers: Record<string, string>,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
): Promise<{ response: Response; body: string; buffer?: Buffer; finalUrl: string }> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const { response, finalUrl } = await fetchWithValidatedRedirectsDetailed(url, {
      headers,
      signal: controller.signal,
      redirect: 'manual',
    })
    const contentType = response.headers.get('content-type') || ''
    const shouldReadBody =
      !response.ok ||
      isHtmlContentType(contentType) ||
      isTextLikeContentType(contentType) ||
      isFeedContentType(contentType) ||
      isPdfContentType(contentType) ||
      isDocxContentType(contentType) ||
      isCsvContentType(contentType) ||
      isLikelyPdfUrl(finalUrl) ||
      isLikelyDocxUrl(finalUrl) ||
      isLikelyCsvUrl(finalUrl)
    if (!shouldReadBody) {
      return { response, body: '', finalUrl }
    }
    const buffer = await readResponseBufferWithLimit(response, maxBodyBytes)
    const shouldDecodeText =
      !response.ok ||
      isHtmlContentType(contentType) ||
      isTextLikeContentType(contentType) ||
      isFeedContentType(contentType) ||
      isCsvContentType(contentType)
    const body = shouldDecodeText ? decodeResponseBuffer(buffer, contentType) : ''
    return { response, body, buffer, finalUrl }
  } finally {
    clearTimeout(timeoutId)
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
    const response = await fetchImpl(currentUrl, {
      ...init,
      redirect: 'manual',
    })
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

const dedupeTextBlocks = (items: string[]): string[] => {
  const seen = new Set<string>()
  const deduped: string[] = []
  for (const item of items) {
    const key = item.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    deduped.push(item)
  }
  return deduped
}

const extractCrawlerResultFromHtml = (
  html: string,
  url: string,
  maxContentLength: number,
): UrlReadResult | null => {
  if (!html || !html.trim()) return null

  const dom = new JSDOM(html, {
    url,
    runScripts: undefined,
    resources: undefined,
  })

  try {
    const doc = dom.window.document
    const removableNodes = Array.from(
      doc.querySelectorAll('script,style,noscript,svg,canvas,iframe,form,nav,aside') as
        | ArrayLike<DomLikeElement>
        | Iterable<DomLikeElement>,
    )
    removableNodes.forEach((node) => node.remove?.())

    const preferredSelectors = [
      'article',
      'main',
      '[role="main"]',
      '.article-content',
      '.post-content',
      '.entry-content',
      '.content',
      '#content',
      '.markdown-body',
    ]
    const candidateNodes: DomLikeElement[] = []
    for (const selector of preferredSelectors) {
      candidateNodes.push(
        ...Array.from(
          doc.querySelectorAll(selector) as ArrayLike<DomLikeElement> | Iterable<DomLikeElement>,
        ),
      )
    }
    if (candidateNodes.length === 0 && doc.body) {
      candidateNodes.push(doc.body as DomLikeElement)
    }

    let bestText = ''
    let bestHtml = ''
    for (const node of candidateNodes) {
      const text = normalizeTextContent(node?.textContent || '', maxContentLength)
      if (text.length > bestText.length) {
        bestText = text
        bestHtml = typeof node?.innerHTML === 'string' ? node.innerHTML : ''
      }
    }

    if (bestText.length < CRAWLER_MIN_TEXT_LENGTH) {
      const blockTexts = dedupeTextBlocks(
        Array.from(
          doc.querySelectorAll('p,li,blockquote,pre,h1,h2,h3,h4') as
            | ArrayLike<DomLikeElement>
            | Iterable<DomLikeElement>,
        )
          .map((node) => normalizeTextContent(node.textContent || '', maxContentLength))
          .filter((value) => value.length >= 24),
      )
      if (blockTexts.length > 0) {
        const merged = normalizeTextContent(blockTexts.join('\n\n'), maxContentLength)
        if (merged.length > bestText.length) {
          bestText = merged
          bestHtml = ''
        }
      }
    }

    if (bestText.length < CRAWLER_MIN_TEXT_LENGTH) {
      const bodyText = normalizeTextContent(doc.body?.textContent || '', maxContentLength)
      if (bodyText.length > bestText.length) {
        bestText = bodyText
        bestHtml = ''
      }
    }

    if (bestText.length < CRAWLER_MIN_TEXT_LENGTH) {
      return null
    }

    const imageEvidence = collectImagesFromDocument(doc, url, 'crawler')

    return {
      title: extractTitleFromDocument(doc),
      url,
      content: bestHtml,
      textContent: bestText,
      resourceType: 'page',
      contentType: 'text/html',
      excerpt: buildExcerpt(bestText),
      wordCount: countWords(bestText),
      fallbackUsed: 'crawler',
      leadImageUrl: imageEvidence.leadImageUrl,
      images: imageEvidence.images,
    }
  } finally {
    dom.window.close()
  }
}

const extractReadabilityResultFromHtml = (
  html: string,
  url: string,
  maxContentLength: number,
): UrlReadResult | null => {
  const dom = new JSDOM(html, {
    url,
    runScripts: undefined,
    resources: undefined,
  })

  try {
    const imageEvidence = collectImagesFromDocument(dom.window.document, url, 'content')
    const reader = new Readability(dom.window.document, {
      charThreshold: 20,
    })
    const article = reader.parse()
    if (!article) return null

    const textContent = normalizeTextContent(article.textContent || '', maxContentLength)
    if (!textContent || textContent.length < CRAWLER_MIN_TEXT_LENGTH) {
      return null
    }

    return {
      title: article.title || extractTitleFromDocument(dom.window.document),
      url,
      content: article.content || '',
      textContent,
      resourceType: 'page',
      contentType: 'text/html',
      excerpt: article.excerpt || buildExcerpt(textContent),
      byline: article.byline || undefined,
      siteName: article.siteName || undefined,
      lang: article.lang || undefined,
      publishedTime: article.publishedTime || undefined,
      wordCount: countWords(textContent),
      fallbackUsed: 'none',
      leadImageUrl: imageEvidence.leadImageUrl,
      images: imageEvidence.images,
    }
  } finally {
    dom.window.close()
  }
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
    const readabilityResult = extractReadabilityResultFromHtml(html, url, maxContentLength)
    const result = readabilityResult || extractCrawlerResultFromHtml(html, url, maxContentLength)
    if (!result) return null
    return {
      ...result,
      resourceType: 'document',
      contentType,
      contentLength: buffer.length,
      fallbackUsed: 'document',
      engine: 'docx',
      contentFormat: 'docx',
      confidence: readabilityResult ? 0.9 : 0.75,
    }
  } catch {
    return null
  }
}

const clampBrowserWaitMs = (value?: number): number => {
  if (!Number.isFinite(value) || (value as number) < 0) return DEFAULT_BROWSER_WAIT_MS
  return Math.max(0, Math.min(MAX_BROWSER_WAIT_MS, Math.floor(value as number)))
}

const windowsBrowserCandidates = (): string[] => {
  const roots = [
    process.env.PROGRAMFILES,
    process.env['PROGRAMFILES(X86)'],
    process.env.LOCALAPPDATA,
  ].filter(Boolean) as string[]
  return roots.flatMap((root) => [
    path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ])
}

const wslBrowserCandidates = [
  '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
  '/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/mnt/c/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
]

const linuxBrowserCandidates = [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/microsoft-edge',
  '/snap/bin/chromium',
]

const resolveBrowserExecutablePath = (explicitPath?: string): string | undefined => {
  const candidates = [
    explicitPath,
    process.env.URL_READER_BROWSER_EXECUTABLE_PATH,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    ...linuxBrowserCandidates,
    ...wslBrowserCandidates,
    ...windowsBrowserCandidates(),
  ].filter(Boolean) as string[]
  return candidates.find((candidate) => {
    try {
      return existsSync(candidate)
    } catch {
      return false
    }
  })
}

async function renderHtmlWithLocalBrowser(
  url: string,
  opts: {
    timeout: number
    waitMs?: number
    executablePath?: string
  },
): Promise<{ html: string; finalUrl: string; title: string }> {
  const executablePath = resolveBrowserExecutablePath(opts.executablePath)
  if (!executablePath) {
    throw new Error('Local browser renderer is unavailable: no Chromium/Chrome/Edge executable was found')
  }

  let imported: typeof import('playwright-core')
  try {
    imported = await import('playwright-core')
  } catch {
    throw new Error('Local browser renderer is unavailable: playwright-core is not installed')
  }

  const browser = await imported.chromium.launch({
    executablePath,
    headless: true,
    args: [
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-sync',
      '--no-first-run',
      '--no-sandbox',
    ],
  })

  try {
    const context = await browser.newContext({
      userAgent: CRAWLER_USER_AGENT,
      locale: 'zh-CN',
      viewport: { width: 1366, height: 900 },
      ignoreHTTPSErrors: true,
    })
    try {
      const page = await context.newPage()
      await page.route('**/*', async (route) => {
        const type = route.request().resourceType()
        if (type === 'font' || type === 'media') {
          await route.abort().catch(() => undefined)
          return
        }
        await route.continue().catch(() => undefined)
      })
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: opts.timeout,
      })
      await page.waitForLoadState('networkidle', {
        timeout: Math.min(8000, Math.max(1000, Math.floor(opts.timeout / 3))),
      }).catch(() => undefined)
      const waitMs = clampBrowserWaitMs(opts.waitMs)
      if (waitMs > 0) {
        await page.waitForTimeout(waitMs)
      }
      await page.evaluate(`
        (async () => {
          const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
          const height = Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0);
          const steps = Math.min(6, Math.max(1, Math.ceil(height / 1200)));
          for (let i = 1; i <= steps; i++) {
            window.scrollTo(0, Math.floor((height * i) / steps));
            await sleep(180);
          }
          window.scrollTo(0, 0);
        })()
      `).catch(() => undefined)

      return {
        html: await page.content(),
        finalUrl: page.url(),
        title: await page.title().catch(() => ''),
      }
    } finally {
      await context.close().catch(() => undefined)
    }
  } finally {
    await browser.close().catch(() => undefined)
  }
}

async function tryBrowserRenderedRead(
  url: string,
  timeout: number,
  maxContentLength: number,
  opts: UrlReaderOptions,
): Promise<UrlReadResult | null> {
  try {
    const rendered = await renderHtmlWithLocalBrowser(url, {
      timeout,
      waitMs: opts.renderWaitMs,
      executablePath: opts.browserExecutablePath,
    })
    const htmlForParse = trimHtmlForParsing(rendered.html)
    const readabilityResult = extractReadabilityResultFromHtml(htmlForParse, rendered.finalUrl, maxContentLength)
    const result = readabilityResult || extractCrawlerResultFromHtml(htmlForParse, rendered.finalUrl, maxContentLength)
    if (!result) return null
    return {
      ...result,
      title: result.title || rendered.title,
      fallbackUsed: 'browser',
      engine: 'browser',
      finalUrl: rendered.finalUrl,
      rendered: true,
      confidence: readabilityResult ? 0.82 : 0.68,
    }
  } catch (error) {
    log.debug('url reader: browser renderer failed', {
      url,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

async function tryCrawlerRefetch(
  url: string,
  timeout: number,
  maxContentLength: number,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
): Promise<UrlReadResult | null> {
  try {
    const { response, body, finalUrl } = await fetchPageBody(url, timeout, buildCrawlerHeaders(), maxBodyBytes)
    if (!response.ok || !body || detectJsChallenge(body)) {
      return null
    }
    const contentType = response.headers.get('content-type') || ''
    if (isHtmlContentType(contentType)) {
      return extractCrawlerResultFromHtml(body, finalUrl, maxContentLength)
    }
    if (isTextLikeContentType(contentType)) {
      return buildCrawlerResultFromText(body, finalUrl, maxContentLength)
    }
    return null
  } catch {
    return null
  }
}

/**
 * 使用 @mozilla/readability 提取网页正文内容
 */
export async function readUrlContent(
  url: string,
  opts: UrlReaderOptions = {}
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

  const recordAttempt = (
    startedAt: number,
    engine: UrlReadEngineName,
    status: UrlReadAttempt['status'],
    extra: Omit<UrlReadAttempt, 'engine' | 'status' | 'durationMs'> = {},
  ) => {
    attempts.push({
      engine,
      status,
      durationMs: Date.now() - startedAt,
      ...extra,
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
    error: message,
    errorCode,
    ...(typeof httpStatus === 'number' ? { httpStatus } : {}),
    attempts: [...attempts],
  })

  const toPublicResult = (result: UrlReadResult): UrlReadResult => {
    const resultFinalUrl = result.finalUrl || result.url
    return {
      ...result,
      url: validatedUrl,
      finalUrl: resultFinalUrl && resultFinalUrl !== validatedUrl ? resultFinalUrl : result.finalUrl,
      attempts: [...attempts],
    }
  }

  const tryBrowserFallback = async (reason: string): Promise<UrlReadResult | null> => {
    if (!enableBrowser) return null
    const browserStartedAt = Date.now()
    const browserResult = await tryBrowserRenderedRead(fetchUrl, timeout, maxContentLength, opts)
    if (browserResult) {
      recordAttempt(browserStartedAt, 'browser', 'success', {
        finalUrl: browserResult.finalUrl || browserResult.url,
        rendered: true,
        contentType: browserResult.contentType,
      })
      log.debug('url reader: browser fallback success', { url: validatedUrl, reason })
      return toPublicResult(browserResult)
    }
    recordAttempt(browserStartedAt, 'browser', 'skipped', {
      error: `Browser fallback did not extract readable content after ${reason}`,
      rendered: true,
    })
    return null
  }

  try {
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
    const { response, body: responseBody, buffer: responseBuffer, finalUrl } = await fetchPageBody(
      fetchUrl,
      timeout,
      buildPrimaryHeaders(userAgent),
      maxBodyBytes,
    )
    const status = response.status
    const statusText = response.statusText || 'Request failed'
    const bodySnippet = responseBody.slice(0, 2000)

    if (!response.ok) {
      const errorCode = classifyHttpErrorCode(status, bodySnippet)
      const blockedByChallenge = detectJsChallenge(bodySnippet)
      const finalCode = blockedByChallenge ? 'JS_CHALLENGE' : errorCode
      recordAttempt(nativeStartedAt, 'native', 'error', {
        error: `HTTP ${status}: ${statusText}`,
        errorCode: finalCode,
        httpStatus: status,
        finalUrl,
      })
      if (!blockedByChallenge && status !== 404) {
        const crawlerStartedAt = Date.now()
        const crawlerResult = await tryCrawlerRefetch(fetchUrl, timeout, maxContentLength, maxBodyBytes)
        if (crawlerResult) {
          recordAttempt(crawlerStartedAt, 'crawler', 'success', {
            finalUrl: crawlerResult.finalUrl || crawlerResult.url,
            contentType: crawlerResult.contentType,
          })
          log.debug('url reader: crawler fallback success after non-2xx response', {
            url: validatedUrl,
            httpStatus: status,
          })
          return toPublicResult(crawlerResult)
        }
        recordAttempt(crawlerStartedAt, 'crawler', 'skipped', {
          error: 'Crawler fallback did not extract readable content after non-2xx response',
        })
      }
      if (status !== 404 && finalCode !== 'ROBOTS_DENIED') {
        const browserResult = await tryBrowserFallback(`HTTP ${status}`)
        if (browserResult) return browserResult
      }
      const message =
        finalCode === 'ROBOTS_DENIED'
          ? `HTTP ${status}: ${statusText} (robots denied)`
          : `HTTP ${status}: ${statusText}`

      log.error('url reader: failed', { url: validatedUrl, error: message, errorCode: finalCode, httpStatus: status })
      return buildErrorResult(message, finalCode, status)
    }

    const contentType = response.headers.get('content-type') || ''
    const normalizedContentType = sanitizeContentType(contentType)
    if (isImageContentType(contentType)) {
      recordAttempt(nativeStartedAt, 'image', 'success', {
        contentType: normalizedContentType,
        finalUrl,
      })
      log.debug('url reader: direct image detected', {
        url: validatedUrl,
        contentType: normalizedContentType,
      })
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
        recordAttempt(nativeStartedAt, 'pdf', 'success', {
          contentType: normalizedContentType,
          finalUrl,
        })
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
        recordAttempt(nativeStartedAt, 'docx', 'success', {
          contentType: normalizedContentType,
          finalUrl,
        })
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
      if (isFeedContentType(contentType) || /^\s*<(rss|feed)\b/i.test(responseBody)) {
        const feedResult =
          contentType.toLowerCase().includes('json')
            ? buildJsonFeedResultFromText(responseBody, finalUrl, maxContentLength, normalizedContentType)
            : buildFeedResultFromXml(responseBody, finalUrl, maxContentLength)
        if (feedResult) {
          recordAttempt(nativeStartedAt, 'feed', 'success', {
            contentType: normalizedContentType,
            finalUrl,
          })
          return toPublicResult(feedResult)
        }
      }

      if ((isCsvContentType(contentType) || isLikelyCsvUrl(finalUrl)) && responseBody) {
        const csvResult = await buildCsvResultFromText(responseBody, finalUrl, maxContentLength, normalizedContentType)
        if (csvResult) {
          recordAttempt(nativeStartedAt, 'csv', 'success', {
            contentType: normalizedContentType,
            finalUrl,
          })
          return toPublicResult(csvResult)
        }
      }

      if (isTextLikeContentType(contentType)) {
        const lowerContentType = contentType.toLowerCase()
        const textResult =
          lowerContentType.includes('json') || lowerContentType.includes('+json')
            ? buildJsonResultFromText(responseBody, finalUrl, maxContentLength, normalizedContentType)
            : lowerContentType.includes('xml') || lowerContentType.includes('+xml')
              ? buildXmlTextResult(responseBody, finalUrl, maxContentLength, normalizedContentType)
              : buildCrawlerResultFromText(
                  responseBody,
                  finalUrl,
                  maxContentLength,
                  '',
                  normalizedContentType,
                )
        if (textResult) {
          recordAttempt(nativeStartedAt, textResult.engine || 'text', 'success', {
            contentType: normalizedContentType,
            finalUrl,
          })
          log.debug('url reader: crawler fallback success for non-html text payload', {
            url: validatedUrl,
            contentType,
          })
          return toPublicResult(textResult)
        }
      }
      const message = `Unsupported content type: ${contentType}. Only HTML pages are supported.`
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
    const htmlForParse = trimHtmlForParsing(html)
    if (html.length !== htmlForParse.length) {
      log.debug('url reader: html trimmed for parsing', {
        url: validatedUrl,
        originalLength: html.length,
        trimmedLength: htmlForParse.length,
        maxLength: MAX_HTML_PARSE_LENGTH,
      })
    }

    if (detectJsChallenge(htmlForParse)) {
      recordAttempt(nativeStartedAt, 'native', 'error', {
        error: 'The page appears to be protected by a JavaScript challenge or anti-bot verification',
        errorCode: 'JS_CHALLENGE',
        contentType: normalizedContentType,
        finalUrl,
      })
      const crawlerStartedAt = Date.now()
      const crawlerResult = await tryCrawlerRefetch(fetchUrl, timeout, maxContentLength, maxBodyBytes)
      if (crawlerResult) {
        recordAttempt(crawlerStartedAt, 'crawler', 'success', {
          finalUrl: crawlerResult.finalUrl || crawlerResult.url,
          contentType: crawlerResult.contentType,
        })
        log.debug('url reader: crawler fallback success after JS challenge detection', {
          url: validatedUrl,
        })
        return toPublicResult(crawlerResult)
      }
      recordAttempt(crawlerStartedAt, 'crawler', 'skipped', {
        error: 'Crawler fallback did not extract readable content after JS challenge detection',
      })
      const browserResult = await tryBrowserFallback('JS challenge detection')
      if (browserResult) return browserResult
      const message = 'The page appears to be protected by a JavaScript challenge or anti-bot verification'
      log.error('url reader: failed', { url: validatedUrl, error: message, errorCode: 'JS_CHALLENGE' })
      return buildErrorResult(message, 'JS_CHALLENGE')
    }

    if (!htmlForParse || htmlForParse.length < 100) {
      recordAttempt(nativeStartedAt, 'native', 'error', {
        error: 'Page content is empty or too short',
        errorCode: 'EMPTY_CONTENT',
        contentType: normalizedContentType,
        finalUrl,
      })
      const crawlerStartedAt = Date.now()
      const crawlerResult = await tryCrawlerRefetch(fetchUrl, timeout, maxContentLength, maxBodyBytes)
      if (crawlerResult) {
        recordAttempt(crawlerStartedAt, 'crawler', 'success', {
          finalUrl: crawlerResult.finalUrl || crawlerResult.url,
          contentType: crawlerResult.contentType,
        })
        log.debug('url reader: crawler fallback success after empty content', {
          url: validatedUrl,
          htmlLength: htmlForParse.length,
        })
        return toPublicResult(crawlerResult)
      }
      recordAttempt(crawlerStartedAt, 'crawler', 'skipped', {
        error: 'Crawler fallback did not extract readable content after empty content',
      })
      const browserResult = await tryBrowserFallback('empty content')
      if (browserResult) return browserResult
      const message = 'Page content is empty or too short'
      log.error('url reader: failed', { url: validatedUrl, error: message, errorCode: 'EMPTY_CONTENT' })
      return buildErrorResult(message, 'EMPTY_CONTENT')
    }

    log.debug('url reader: parsing', { url: validatedUrl, htmlLength: htmlForParse.length })

    const readabilityResult = extractReadabilityResultFromHtml(htmlForParse, finalUrl, maxContentLength)
    if (readabilityResult) {
      recordAttempt(nativeStartedAt, 'native', 'success', {
        contentType: normalizedContentType,
        finalUrl,
      })
      log.debug('url reader: success', {
        url: validatedUrl,
        title: readabilityResult.title,
        wordCount: readabilityResult.wordCount,
      })
      return toPublicResult({
        ...readabilityResult,
        engine: 'native',
        finalUrl,
        contentFormat: 'html',
        confidence: 0.9,
      })
    }

    const crawlerInlineResult = extractCrawlerResultFromHtml(htmlForParse, finalUrl, maxContentLength)
    if (crawlerInlineResult) {
      recordAttempt(nativeStartedAt, 'crawler', 'success', {
        contentType: normalizedContentType,
        finalUrl,
      })
      log.debug('url reader: crawler fallback success after readability parse miss', {
        url: validatedUrl,
        wordCount: crawlerInlineResult.wordCount,
      })
      return toPublicResult({
        ...crawlerInlineResult,
        engine: 'crawler',
        finalUrl,
        contentFormat: 'html',
        confidence: 0.7,
      })
    }

    const crawlerStartedAt = Date.now()
    const crawlerRefetchResult = await tryCrawlerRefetch(fetchUrl, timeout, maxContentLength, maxBodyBytes)
    if (crawlerRefetchResult) {
      recordAttempt(crawlerStartedAt, 'crawler', 'success', {
        finalUrl: crawlerRefetchResult.finalUrl || crawlerRefetchResult.url,
        contentType: crawlerRefetchResult.contentType,
      })
      log.debug('url reader: crawler fallback success after readability parse miss + refetch', {
        url: validatedUrl,
      })
      return toPublicResult(crawlerRefetchResult)
    }
    recordAttempt(crawlerStartedAt, 'crawler', 'skipped', {
      error: 'Crawler refetch did not extract readable content after readability parse miss',
    })

    const browserResult = await tryBrowserFallback('readability parse miss')
    if (browserResult) return browserResult

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
    const classified = classifyThrownError(error)
    const shouldTryCrawlerFallback =
      classified.errorCode !== 'DISALLOWED_URL' && classified.errorCode !== 'INVALID_URL'

    if (shouldTryCrawlerFallback) {
      const crawlerStartedAt = Date.now()
      const crawlerResult = await tryCrawlerRefetch(fetchUrl, timeout, maxContentLength, maxBodyBytes)
      if (crawlerResult) {
        recordAttempt(crawlerStartedAt, 'crawler', 'success', {
          finalUrl: crawlerResult.finalUrl || crawlerResult.url,
          contentType: crawlerResult.contentType,
        })
        log.debug('url reader: crawler fallback success after thrown error', {
          url: validatedUrl,
        })
        return toPublicResult(crawlerResult)
      }
      recordAttempt(crawlerStartedAt, 'crawler', 'skipped', {
        error: 'Crawler fallback did not extract readable content after thrown error',
      })
      const browserResult = await tryBrowserFallback(`thrown error: ${classified.errorCode}`)
      if (browserResult) return browserResult
    }

    const message =
      classified.errorCode === 'TIMEOUT'
        ? `Request timeout after ${timeout / 1000} seconds`
        : classified.message

    log.error('url reader: failed', { url: validatedUrl, error: message, errorCode: classified.errorCode })

    return buildErrorResult(message, classified.errorCode)
  }
}

/**
 * 格式化读取结果供模型使用
 */
export function formatUrlContentForModel(result: UrlReadResult): string {
  if (result.error) {
    const suffix = [
      result.errorCode ? `错误码: ${result.errorCode}` : null,
      typeof result.httpStatus === 'number' ? `HTTP: ${result.httpStatus}` : null,
    ]
      .filter(Boolean)
      .join('，')
    return suffix
      ? `无法读取网页 "${result.url}"：${result.error}（${suffix}）`
      : `无法读取网页 "${result.url}"：${result.error}`
  }

  if (result.resourceType === 'image') {
    const parts: string[] = []
    parts.push('## 图片资源')
    parts.push(`- **URL**: ${result.url}`)
    if (result.finalUrl && result.finalUrl !== result.url) {
      parts.push(`- **最终地址**: ${result.finalUrl}`)
    }
    if (result.contentType) {
      parts.push(`- **类型**: ${result.contentType}`)
    }
    if (typeof result.contentLength === 'number') {
      parts.push(`- **大小**: ${result.contentLength} bytes`)
    }
    if (result.leadImageUrl) {
      parts.push(`- **图片**: ${result.leadImageUrl}`)
    }
    parts.push('')
    parts.push('该 URL 直接指向图片资源，没有可提取的网页正文。')
    return parts.join('\n')
  }

  const parts: string[] = []
  parts.push(`## 网页信息`)
  parts.push(`- **URL**: ${result.url}`)
  if (result.finalUrl && result.finalUrl !== result.url) {
    parts.push(`- **最终地址**: ${result.finalUrl}`)
  }
  if (result.title) {
    parts.push(`- **标题**: ${result.title}`)
  }
  if (result.byline) {
    parts.push(`- **作者**: ${result.byline}`)
  }
  if (result.siteName) {
    parts.push(`- **来源**: ${result.siteName}`)
  }
  if (result.publishedTime) {
    parts.push(`- **发布时间**: ${result.publishedTime}`)
  }
  if (result.wordCount) {
    parts.push(`- **字数**: 约 ${result.wordCount} 词`)
  }
  if (result.fallbackUsed === 'crawler') {
    parts.push(`- **提取方式**: 爬虫回退`)
  } else if (result.fallbackUsed === 'browser') {
    parts.push(`- **提取方式**: 本地浏览器渲染`)
  } else if (result.fallbackUsed === 'document') {
    parts.push(`- **提取方式**: ${result.engine || '文档/结构化内容'} 引擎`)
  } else {
    parts.push(`- **提取方式**: 标准正文提取`)
  }
  if (typeof result.confidence === 'number') {
    parts.push(`- **置信度**: ${Math.round(result.confidence * 100)}%`)
  }

  if (result.excerpt) {
    parts.push('')
    parts.push(`## 摘要`)
    parts.push(result.excerpt)
  }

  const images = Array.isArray(result.images) ? result.images : []
  if (result.leadImageUrl || images.length > 0) {
    parts.push('')
    parts.push('## 图片证据')
    if (result.leadImageUrl) {
      parts.push(`- **主图**: ${result.leadImageUrl}`)
    }
    const candidateImages = images.filter((item) => item.url && item.url !== result.leadImageUrl).slice(0, 5)
    if (candidateImages.length > 0) {
      parts.push('- **候选图**:')
      for (const [index, image] of candidateImages.entries()) {
        const sourceLabel = image.source ? ` [${image.source}]` : ''
        const altLabel = image.alt ? `（${image.alt}）` : ''
        parts.push(`  ${index + 1}. ${image.url}${altLabel}${sourceLabel}`)
      }
    }
  }

  parts.push('')
  parts.push(`## 正文内容`)
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
