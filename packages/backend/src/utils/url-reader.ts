/**
 * URL 内容读取工具
 * 使用 @mozilla/readability + jsdom 自建实现
 * 无需外部 API，完全本地处理
 */

import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'
import { isIP } from 'node:net'
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
  | 'UNKNOWN'

export interface UrlReadResult {
  title: string
  url: string
  content: string
  textContent: string
  excerpt?: string
  byline?: string
  siteName?: string
  lang?: string
  publishedTime?: string
  wordCount?: number
  error?: string
  errorCode?: UrlReadErrorCode
  httpStatus?: number
  fallbackUsed?: 'none' | 'crawler'
  leadImageUrl?: string
  images?: UrlReadImage[]
}

export interface UrlReaderOptions {
  timeout?: number
  maxContentLength?: number
  userAgent?: string
}

export interface UrlReadImage {
  url: string
  alt?: string
  width?: number
  height?: number
  source: 'meta' | 'content' | 'crawler'
}

const DEFAULT_TIMEOUT = 30000
const DEFAULT_MAX_CONTENT_LENGTH = 100000
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; AIChat/1.0; +https://github.com/Asheblog/aichat)'
const CRAWLER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
const CRAWLER_MIN_TEXT_LENGTH = 40
const MAX_EXTRACTED_IMAGES = 8
const MAX_HTML_PARSE_LENGTH = 1024 * 1024
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
function validateUrl(url: string): string {
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
    normalized.includes('application/xml') ||
    normalized.includes('application/xhtml')
  )
}

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

const normalizeImageUrl = (value: string | null | undefined, baseUrl: string): string | null => {
  if (!value) return null
  const raw = value.trim()
  if (!raw) return null
  if (/^data:image\//i.test(raw)) return raw
  if (/^https?:\/\//i.test(raw)) return raw
  if (raw.startsWith('//')) return `https:${raw}`
  try {
    return new URL(raw, baseUrl).toString()
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

  const contentRoots = [
    ...Array.from(doc.querySelectorAll('article,main,[role="main"],.article-content,.post-content,.entry-content')),
  ]
  if (contentRoots.length === 0 && doc.body) {
    contentRoots.push(doc.body)
  }
  const imageElements = contentRoots.flatMap((root: any) => Array.from(root.querySelectorAll('img')))
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
): Promise<{ response: Response; body: string }> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
      redirect: 'follow',
    })
    const body = await response.text()
    return { response, body }
  } finally {
    clearTimeout(timeoutId)
  }
}

const buildCrawlerResultFromText = (
  text: string,
  url: string,
  maxContentLength: number,
  title = '',
): UrlReadResult | null => {
  const normalized = normalizeTextContent(text, maxContentLength)
  if (normalized.length < CRAWLER_MIN_TEXT_LENGTH) return null
  return {
    title: title.trim(),
    url,
    content: '',
    textContent: normalized,
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
    const removableNodes = doc.querySelectorAll('script,style,noscript,svg,canvas,iframe,form,nav,aside')
    removableNodes.forEach((node) => node.remove())

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
    const candidateNodes: any[] = []
    for (const selector of preferredSelectors) {
      candidateNodes.push(...Array.from(doc.querySelectorAll(selector)))
    }
    if (candidateNodes.length === 0 && doc.body) {
      candidateNodes.push(doc.body)
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
        Array.from(doc.querySelectorAll('p,li,blockquote,pre,h1,h2,h3,h4'))
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

async function tryCrawlerRefetch(
  url: string,
  timeout: number,
  maxContentLength: number,
): Promise<UrlReadResult | null> {
  try {
    const { response, body } = await fetchPageBody(url, timeout, buildCrawlerHeaders())
    if (!response.ok || !body || detectJsChallenge(body)) {
      return null
    }
    const contentType = response.headers.get('content-type') || ''
    if (isHtmlContentType(contentType)) {
      return extractCrawlerResultFromHtml(body, url, maxContentLength)
    }
    if (isTextLikeContentType(contentType)) {
      return buildCrawlerResultFromText(body, url, maxContentLength)
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
  const userAgent = opts.userAgent || DEFAULT_USER_AGENT

  try {
    validatedUrl = validateUrl(url)
    const transformed = applyUrlTransformRules(validatedUrl)
    fetchUrl = transformed.fetchUrl

    if (transformed.transformedBy) {
      log.debug('url reader: url transform applied', {
        originalUrl: validatedUrl,
        fetchUrl,
        rule: transformed.transformedBy,
      })
    }

    const toPublicResult = (result: UrlReadResult): UrlReadResult => ({
      ...result,
      url: validatedUrl,
    })

    log.debug('url reader: fetching', { url: validatedUrl, fetchUrl })

    const { response, body: responseBody } = await fetchPageBody(
      fetchUrl,
      timeout,
      buildPrimaryHeaders(userAgent),
    )
    const status = response.status
    const statusText = response.statusText || 'Request failed'
    const bodySnippet = responseBody.slice(0, 2000)

    if (!response.ok) {
      const errorCode = classifyHttpErrorCode(status, bodySnippet)
      const blockedByChallenge = detectJsChallenge(bodySnippet)
      const finalCode = blockedByChallenge ? 'JS_CHALLENGE' : errorCode
      if (!blockedByChallenge && status !== 404) {
        const crawlerResult = await tryCrawlerRefetch(fetchUrl, timeout, maxContentLength)
        if (crawlerResult) {
          log.debug('url reader: crawler fallback success after non-2xx response', {
            url: validatedUrl,
            httpStatus: status,
          })
          return toPublicResult(crawlerResult)
        }
      }
      const message =
        finalCode === 'ROBOTS_DENIED'
          ? `HTTP ${status}: ${statusText} (robots denied)`
          : `HTTP ${status}: ${statusText}`

      log.error('url reader: failed', { url: validatedUrl, error: message, errorCode: finalCode, httpStatus: status })
      return {
        title: '',
        url: validatedUrl,
        content: '',
        textContent: '',
        error: message,
        errorCode: finalCode,
        httpStatus: status,
      }
    }

    const contentType = response.headers.get('content-type') || ''
    if (!isHtmlContentType(contentType)) {
      if (isTextLikeContentType(contentType)) {
        const crawlerResult = buildCrawlerResultFromText(responseBody, validatedUrl, maxContentLength)
        if (crawlerResult) {
          log.debug('url reader: crawler fallback success for non-html text payload', {
            url: validatedUrl,
            contentType,
          })
          return toPublicResult(crawlerResult)
        }
      }
      const message = `Unsupported content type: ${contentType}. Only HTML pages are supported.`
      log.error('url reader: failed', {
        url: validatedUrl,
        error: message,
        errorCode: 'UNSUPPORTED_CONTENT_TYPE',
      })
      return {
        title: '',
        url: validatedUrl,
        content: '',
        textContent: '',
        error: message,
        errorCode: 'UNSUPPORTED_CONTENT_TYPE',
      }
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
      const crawlerResult = await tryCrawlerRefetch(fetchUrl, timeout, maxContentLength)
      if (crawlerResult) {
        log.debug('url reader: crawler fallback success after JS challenge detection', {
          url: validatedUrl,
        })
        return toPublicResult(crawlerResult)
      }
      const message = 'The page appears to be protected by a JavaScript challenge or anti-bot verification'
      log.error('url reader: failed', { url: validatedUrl, error: message, errorCode: 'JS_CHALLENGE' })
      return {
        title: '',
        url: validatedUrl,
        content: '',
        textContent: '',
        error: message,
        errorCode: 'JS_CHALLENGE',
      }
    }

    if (!htmlForParse || htmlForParse.length < 100) {
      const crawlerResult = await tryCrawlerRefetch(fetchUrl, timeout, maxContentLength)
      if (crawlerResult) {
        log.debug('url reader: crawler fallback success after empty content', {
          url: validatedUrl,
          htmlLength: htmlForParse.length,
        })
        return toPublicResult(crawlerResult)
      }
      const message = 'Page content is empty or too short'
      log.error('url reader: failed', { url: validatedUrl, error: message, errorCode: 'EMPTY_CONTENT' })
      return {
        title: '',
        url: validatedUrl,
        content: '',
        textContent: '',
        error: message,
        errorCode: 'EMPTY_CONTENT',
      }
    }

    log.debug('url reader: parsing', { url: validatedUrl, htmlLength: htmlForParse.length })

    const readabilityResult = extractReadabilityResultFromHtml(htmlForParse, fetchUrl, maxContentLength)
    if (readabilityResult) {
      log.debug('url reader: success', {
        url: validatedUrl,
        title: readabilityResult.title,
        wordCount: readabilityResult.wordCount,
      })
      return toPublicResult(readabilityResult)
    }

    const crawlerInlineResult = extractCrawlerResultFromHtml(htmlForParse, fetchUrl, maxContentLength)
    if (crawlerInlineResult) {
      log.debug('url reader: crawler fallback success after readability parse miss', {
        url: validatedUrl,
        wordCount: crawlerInlineResult.wordCount,
      })
      return toPublicResult(crawlerInlineResult)
    }

    const crawlerRefetchResult = await tryCrawlerRefetch(fetchUrl, timeout, maxContentLength)
    if (crawlerRefetchResult) {
      log.debug('url reader: crawler fallback success after readability parse miss + refetch', {
        url: validatedUrl,
      })
      return toPublicResult(crawlerRefetchResult)
    }

    {
      const message = 'Failed to extract article content. The page structure may not be suitable for reading mode.'
      log.error('url reader: failed', { url: validatedUrl, error: message, errorCode: 'PARSE_EMPTY' })
      return {
        title: '',
        url: validatedUrl,
        content: '',
        textContent: '',
        error: message,
        errorCode: 'PARSE_EMPTY',
      }
    }
  } catch (error) {
    const classified = classifyThrownError(error)
    const shouldTryCrawlerFallback =
      classified.errorCode !== 'DISALLOWED_URL' && classified.errorCode !== 'INVALID_URL'

    if (shouldTryCrawlerFallback) {
      const crawlerResult = await tryCrawlerRefetch(fetchUrl, timeout, maxContentLength)
      if (crawlerResult) {
        log.debug('url reader: crawler fallback success after thrown error', {
          url: validatedUrl,
        })
        return {
          ...crawlerResult,
          url: validatedUrl,
        }
      }
    }

    const message =
      classified.errorCode === 'TIMEOUT'
        ? `Request timeout after ${timeout / 1000} seconds`
        : classified.message

    log.error('url reader: failed', { url: validatedUrl, error: message, errorCode: classified.errorCode })

    return {
      title: '',
      url: validatedUrl,
      content: '',
      textContent: '',
      error: message,
      errorCode: classified.errorCode,
    }
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

  const parts: string[] = []
  parts.push(`## 网页信息`)
  parts.push(`- **URL**: ${result.url}`)
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
  } else {
    parts.push(`- **提取方式**: 标准正文提取`)
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
