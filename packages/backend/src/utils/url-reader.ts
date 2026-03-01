/**
 * URL 内容读取工具
 * 使用 @mozilla/readability + jsdom 自建实现
 * 无需外部 API，完全本地处理
 */

import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'
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
}

export interface UrlReaderOptions {
  timeout?: number
  maxContentLength?: number
  userAgent?: string
}

const DEFAULT_TIMEOUT = 30000
const DEFAULT_MAX_CONTENT_LENGTH = 100000
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; AIChat/1.0; +https://github.com/Asheblog/aichat)'
const JS_CHALLENGE_PATTERNS: RegExp[] = [
  /cf-chl/i,
  /cloudflare/i,
  /captcha/i,
  /enable javascript/i,
  /attention required/i,
  /just a moment/i,
  /verify you are human/i,
]

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
    const hostname = parsed.hostname.toLowerCase()

    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('172.16.') ||
      hostname.startsWith('172.17.') ||
      hostname.startsWith('172.18.') ||
      hostname.startsWith('172.19.') ||
      hostname.startsWith('172.2') ||
      hostname.startsWith('172.30.') ||
      hostname.startsWith('172.31.') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal')
    ) {
      throw new Error('Access to local/internal URLs is not allowed for security reasons')
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Only HTTP and HTTPS URLs are supported')
    }

    return normalized
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

/**
 * 使用 @mozilla/readability 提取网页正文内容
 */
export async function readUrlContent(
  url: string,
  opts: UrlReaderOptions = {}
): Promise<UrlReadResult> {
  let validatedUrl = url.trim()
  const timeout = opts.timeout || DEFAULT_TIMEOUT
  const maxContentLength = opts.maxContentLength || DEFAULT_MAX_CONTENT_LENGTH
  const userAgent = opts.userAgent || DEFAULT_USER_AGENT

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    validatedUrl = validateUrl(url)
    log.debug('url reader: fetching', { url: validatedUrl })

    const response = await fetch(validatedUrl, {
      headers: {
        'User-Agent': userAgent,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate',
        'Cache-Control': 'no-cache',
      },
      signal: controller.signal,
      redirect: 'follow',
    })
    const status = response.status
    const statusText = response.statusText || 'Request failed'
    const responseBody = await response.text()
    const bodySnippet = responseBody.slice(0, 2000)

    if (!response.ok) {
      const errorCode = classifyHttpErrorCode(status, bodySnippet)
      const blockedByChallenge = detectJsChallenge(bodySnippet)
      const finalCode = blockedByChallenge ? 'JS_CHALLENGE' : errorCode
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
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
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

    if (detectJsChallenge(html)) {
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

    if (!html || html.length < 100) {
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

    log.debug('url reader: parsing', { url: validatedUrl, htmlLength: html.length })

    const dom = new JSDOM(html, {
      url: validatedUrl,
      runScripts: undefined,
      resources: undefined,
    })

    const reader = new Readability(dom.window.document, {
      charThreshold: 20,
    })

    const article = reader.parse()

    if (!article) {
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

    let textContent = article.textContent || ''
    if (textContent.length > maxContentLength) {
      textContent = textContent.slice(0, maxContentLength) + '\n\n[内容已截断，原文过长...]'
    }

    textContent = textContent
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+/g, ' ')
      .trim()

    const wordCount = textContent.split(/\s+/).filter(Boolean).length

    log.debug('url reader: success', {
      url: validatedUrl,
      title: article.title,
      wordCount,
    })

    return {
      title: article.title || '',
      url: validatedUrl,
      content: article.content || '',
      textContent,
      excerpt: article.excerpt || undefined,
      byline: article.byline || undefined,
      siteName: article.siteName || undefined,
      lang: article.lang || undefined,
      publishedTime: article.publishedTime || undefined,
      wordCount,
    }
  } catch (error) {
    const classified = classifyThrownError(error)
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
  } finally {
    clearTimeout(timeoutId)
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

  if (result.excerpt) {
    parts.push('')
    parts.push(`## 摘要`)
    parts.push(result.excerpt)
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
