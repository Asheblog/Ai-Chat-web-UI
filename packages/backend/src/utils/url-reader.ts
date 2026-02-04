/**
 * URL 内容读取工具
 * 使用 @mozilla/readability + jsdom 自建实现
 * 无需外部 API，完全本地处理
 */

import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'
import { BackendLogger as log } from './logger'

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
}

export interface UrlReaderOptions {
  timeout?: number
  maxContentLength?: number
  userAgent?: string
}

const DEFAULT_TIMEOUT = 30000
const DEFAULT_MAX_CONTENT_LENGTH = 100000
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; AIChat/1.0; +https://github.com/Asheblog/aichat)'

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

/**
 * 使用 @mozilla/readability 提取网页正文内容
 */
export async function readUrlContent(
  url: string,
  opts: UrlReaderOptions = {}
): Promise<UrlReadResult> {
  const validatedUrl = validateUrl(url)
  const timeout = opts.timeout || DEFAULT_TIMEOUT
  const maxContentLength = opts.maxContentLength || DEFAULT_MAX_CONTENT_LENGTH
  const userAgent = opts.userAgent || DEFAULT_USER_AGENT

  log.debug('url reader: fetching', { url: validatedUrl })

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
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
    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      throw new Error(`Unsupported content type: ${contentType}. Only HTML pages are supported.`)
    }

    const html = await response.text()

    if (!html || html.length < 100) {
      throw new Error('Page content is empty or too short')
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
      throw new Error('Failed to extract article content. The page structure may not be suitable for reading mode.')
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
    clearTimeout(timeoutId)

    let message: string
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        message = `Request timeout after ${timeout / 1000} seconds`
      } else {
        message = error.message
      }
    } else {
      message = 'Unknown error occurred'
    }

    log.error('url reader: failed', { url: validatedUrl, error: message })

    return {
      title: '',
      url: validatedUrl,
      content: '',
      textContent: '',
      error: message,
    }
  }
}

/**
 * 格式化读取结果供模型使用
 */
export function formatUrlContentForModel(result: UrlReadResult): string {
  if (result.error) {
    return `无法读取网页 "${result.url}"：${result.error}`
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