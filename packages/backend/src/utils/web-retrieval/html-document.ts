/**
 * 语义正文提取：JSON-LD Article.articleBody → Readability → 语义容器 → 块合并 → 列表/表格结构化。
 * 质量判断面向中文短文本（按字符与段落，而不是英文词数），并显式标记登录墙、删除提示与导航页。
 */

import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'
import { isDisallowedHostname } from '../host-safety'
import type { UrlReadImage } from './types'

const MIN_DOCUMENT_CHARS = 40
const MIN_ARTICLE_CHARS = 120
const MIN_JSONLD_CHARS = 80
const MAX_EXTRACTED_IMAGES = 8
const MAX_STRUCTURED_ROWS = 80

export interface DocumentQuality {
  textLength: number
  paragraphCount: number
  linkDensity: number
  navigationRatio: number
  hasArticleBody: boolean
  isThin: boolean
  isLoginWall: boolean
  isDeletedNotice: boolean
}

/**
 * 多新闻列表页（如个股新闻聚合）语义上是 listing，而不是单篇文章。
 * 只做元数据分类，不改正文内容与链接。
 */
export const looksLikeNewsListingText = (text: string): boolean => {
  if ((text || '').length < 800) return false
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean)
  const timeSuffix = /(?:\d{1,2}:\d{2}|\d+\s*(?:分鐘前|分钟前|小時前|小时前|天前)|昨日|今天)$/
  const shortTimeLines = lines.filter((line) => line.length <= 24 && timeSuffix.test(line)).length
  const timeMentions = (text.match(/(?:\d{1,2}:\d{2}|\d+\s*(?:分鐘前|分钟前|小時前|小时前))/g) || []).length
  return shortTimeLines >= 4 || timeMentions >= 8
}

const LISTING_TIME_PATTERN = /(?:\d{1,2}:\d{2}|\d+\s*(?:分鐘前|分钟前|小時前|小时前|天前)|昨日|今天)/

/**
 * 多新闻预览页在 DOM 上表现为多个带时间戳的同级条目。
 * 只在正文容器内统计，避免单篇长文里的零散时间提及。
 */
export const looksLikeNewsListingHtml = (html: string): boolean => {
  if (!html || html.length < 200) return false
  try {
    const dom = new JSDOM('<body>' + html + '</body>')
    const blocks = Array.from(dom.window.document.body.querySelectorAll('article,section,li,div') as any) as any[]
    const items = blocks
      .map((element) => ({
        element,
        text: normalizeText(element.textContent || ''),
        hasHeading: Boolean(element.querySelector('h2,h3,h4')),
      }))
      .filter((entry) =>
        entry.text.length >= 40 &&
        entry.text.length <= 800 &&
        (entry.hasHeading || entry.text.length <= 400) &&
        LISTING_TIME_PATTERN.test(entry.text))
    const topLevel = items.filter((entry) =>
      !items.some((other) => other !== entry && other.element.contains(entry.element)))
    return topLevel.length >= 4
  } catch {
    return false
  } finally {
    // JSDOM 实例由 GC 回收；这里没有 window 监听器需要显式关闭。
  }
}

export interface ExtractedDocument {
  title: string
  text: string
  html: string
  excerpt?: string
  byline?: string
  siteName?: string
  lang?: string
  publishedTime?: string
  contentKind: 'article' | 'structured' | 'listing' | 'table'
  quality: DocumentQuality
  wordCount: number
  leadImageUrl?: string
  images: UrlReadImage[]
  maxLengthTruncated: boolean
}

export interface ExtractDocumentOptions {
  maxContentLength?: number
}

const DEFAULT_MAX_CONTENT_LENGTH = 100_000

const CJK_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g
const LATIN_WORD_PATTERN = /[A-Za-z0-9]+(?:[._'-][A-Za-z0-9]+)*/g
const WORD_LIKE_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]|[A-Za-z0-9]+(?:[._'-][A-Za-z0-9]+)*/g

export const countReadableUnits = (text: string): number => {
  const matches = (text || '').match(WORD_LIKE_PATTERN)
  return matches ? matches.length : 0
}

const normalizeText = (value: string): string =>
  (value || '')
    .replace(/\u00A0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

const stripTags = (value: string): string => value.replace(/<[^>]+>/g, ' ')

const visibleTextFromHtml = (html: string): string =>
  normalizeText(
    stripTags(
      (html || '')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' '),
    ),
  )

const collectLinkTextLength = (html: string): number => {
  let total = 0
  const pattern = /<a\b[^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null) {
    total += normalizeText(stripTags(match[1] || '')).length
  }
  return total
}

const countBlockParagraphs = (text: string, html: string): number => {
  const textBlocks = text.split(/\n{2,}/).map((block) => block.trim()).filter((block) => block.length >= 10)
  if (textBlocks.length > 0) return textBlocks.length
  const paragraphMatches = html.match(/<p\b[^>]*>/gi)
  return paragraphMatches ? paragraphMatches.length : 0
}

export function assessContentQuality(text: string, html: string): DocumentQuality {
  const normalizedText = normalizeText(text)
  const textLength = normalizedText.length
  const visibleLength = Math.max(1, visibleTextFromHtml(html).length)
  const linkTextLength = collectLinkTextLength(html)
  const linkDensity = Math.min(1, linkTextLength / visibleLength)
  const navigationRatio = Math.min(1, linkTextLength / Math.max(1, textLength))
  const paragraphCount = countBlockParagraphs(normalizedText, html)
  const hasArticleBody = /<(?:article|main|\[role=["']?main)/i.test(html) && paragraphCount >= 3
  const isLoginWall =
    /(?:sign in|log in|登录|登陆|订阅|subscribe)/i.test(normalizedText) &&
    textLength < 800 &&
    paragraphCount < 4
  const isDeletedNotice =
    /(?:article|page|content|post|文章|页面|内容)[^。\n]{0,12}(?:has been )?(?:deleted|removed|unavailable|not found|不存在|已删除|已被删除|无法访问)/i.test(normalizedText) ||
    /(?:已被删除|文章已删除|页面不存在|内容不可用)/.test(normalizedText)
  const isThin = textLength < MIN_ARTICLE_CHARS && paragraphCount < 2

  return {
    textLength,
    paragraphCount,
    linkDensity,
    navigationRatio,
    hasArticleBody,
    isThin,
    isLoginWall,
    isDeletedNotice,
  }
}

interface Candidate {
  kind: 'article' | 'structured' | 'listing' | 'table'
  text: string
  html: string
  title?: string
  source: 'jsonld' | 'readability' | 'semantic' | 'blocks' | 'structured'
}

const BOILERPLATE_PATTERN = /(?:^|[-_\s])(?:nav|navbar|menu|footer|header|aside|breadcrumb|copyright|friendlink|related|recommend|hot|rank|sidebar|ad|ads|advert|promo|banner|tuiguang|gg)(?:$|[-_\s])/i

const isBoilerplateElement = (element: any): boolean => {
  let current = element
  while (current && current.nodeType === 1 && current.tagName !== 'BODY') {
    const tag = String(current.tagName || '').toLowerCase()
    if (['nav', 'aside', 'footer', 'header'].includes(tag)) return true
    const marker = (current.getAttribute('class') || '') + ' ' + (current.getAttribute('id') || '') + ' ' +
      (current.getAttribute('role') || '')
    if (marker.trim() && BOILERPLATE_PATTERN.test(marker)) return true
    current = current.parentElement
  }
  return false
}

const removeNonContent = (root: any): void => {
  const selectors = 'script,style,noscript,svg,canvas,iframe,form,nav,aside,footer,header'
  root.querySelectorAll(selectors).forEach((node: any) => node.remove())
}

const elementTextBlocks = (root: any): string[] => {
  const seen = new Set<string>()
  const blocks: string[] = []
  const nodes = root.querySelectorAll('h1,h2,h3,h4,p,li,blockquote,pre') as any
  for (const node of Array.from(nodes) as any[]) {
    const text = normalizeText(node.textContent || '')
    if (text.length < 8) continue
    if (String(node.tagName || '').toLowerCase() === 'li') {
      const anchorText = (Array.from(node.querySelectorAll('a') as any) as any[])
        .map((anchor: any) => normalizeText(anchor.textContent || ''))
        .join('')
      // 导航/推荐列表里的纯链接条目不算正文块。
      if (text.length < 40 && text.length - anchorText.length < 2) continue
    }
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    blocks.push(text)
  }
  return blocks.filter(Boolean)
}

const containerText = (root: any): string => {
  const clone = root.cloneNode(true) as any
  removeNonContent(clone)
  const blocks = elementTextBlocks(clone)
  if (blocks.length > 0) return normalizeText(blocks.join('\n\n'))
  return normalizeText(clone.textContent || '')
}

const firstSafeHref = (element: any, baseUrl: string): string | undefined => {
  for (const anchor of Array.from(element.querySelectorAll('a[href]') as any) as any[]) {
    const normalized = normalizeImageUrl(anchor.getAttribute('href'), baseUrl)
    if (normalized) return normalized
  }
  return undefined
}

const extractStructuredContent = (doc: any, baseUrl: string): Candidate | null => {
  const tables: string[] = []
  for (const table of Array.from(doc.querySelectorAll('table') as any) as any[]) {
    if (isBoilerplateElement(table)) continue
    const rows = (Array.from(table.querySelectorAll('tr') as any) as any[]).slice(0, MAX_STRUCTURED_ROWS)
    const lines: string[] = []
    for (const row of rows) {
      const cells = (Array.from(row.querySelectorAll('th,td') as any) as any[])
        .map((cell: any) => normalizeText(cell.textContent || ''))
        .filter(Boolean)
      const hrefs = (Array.from(row.querySelectorAll('a[href]') as any) as any[])
        .map((anchor: any) => normalizeImageUrl(anchor.getAttribute('href'), baseUrl))
        .filter((href: string | null): href is string => Boolean(href))
      if (cells.length >= 2) {
        const hrefColumn = hrefs.length > 0 ? ' | ' + hrefs.slice(0, 3).join(', ') : ''
        lines.push(cells.join(' | ') + hrefColumn)
      }
    }
    if (lines.length >= 2) tables.push(lines.join('\n'))
  }

  const listItems: string[] = []
  for (const list of Array.from(doc.querySelectorAll('ul,ol') as any) as any[]) {
    if (isBoilerplateElement(list)) continue
    const rawItems = (Array.from(list.querySelectorAll(':scope > li') as any) as any[])
      .map((item: any) => {
        const text = normalizeText(item.textContent || '')
        const anchorText = (Array.from(item.querySelectorAll('a') as any) as any[])
          .map((anchor: any) => normalizeText(anchor.textContent || ''))
          .join('')
        return { item, text, anchorText }
      })
      .filter((entry: any) => entry.text.length >= 4)
    if (rawItems.length < 3) continue
    // 只认“标题全部在链接里”的条目为链接项；编号标题同样算导航/推荐。
    const linkOnly = rawItems.filter((entry: any) =>
      entry.text.length - entry.anchorText.length < 2).length
    // 纯链接列表是导航/推荐/广告位，不当作结构化数据。
    if (linkOnly / rawItems.length > 0.6) continue
    for (const entry of rawItems) {
      const href = firstSafeHref(entry.item, baseUrl)
      listItems.push(href && !entry.text.includes(href) ? `- ${entry.text} (${href})` : `- ${entry.text}`)
      if (listItems.length >= MAX_STRUCTURED_ROWS) break
    }
    if (listItems.length >= MAX_STRUCTURED_ROWS) break
  }

  const tableText = normalizeText(tables.join('\n\n'))
  const listText = normalizeText(listItems.join('\n'))
  if (tableText.length === 0 && listText.length === 0) return null
  if (tableText.length >= listText.length && tableText.length > 0) {
    return { kind: 'table', text: tableText, html: '', source: 'structured' }
  }
  return { kind: 'listing', text: listText, html: '', source: 'structured' }
}

export interface PlainTextQuality {
  textLength: number
  paragraphCount: number
  readableUnits: number
  linkDensity: number
  isThin: boolean
  isLinkFarm: boolean
}

/**
 * 纯文本（如 Python/Trafilatura 返回）的可用性判断：短文本与链接农场不算正文。
 */
export const assessPlainTextQuality = (text: string): PlainTextQuality => {
  const normalized = normalizeText(text || '')
  if (!normalized) {
    return { textLength: 0, paragraphCount: 0, readableUnits: 0, linkDensity: 0, isThin: true, isLinkFarm: false }
  }
  const paragraphs = normalized.split(/\n{2,}/).map((item) => item.trim()).filter((item) => item.length >= 20)
  const links = normalized.match(/https?:\/\/[^\s)）"']+/g) || []
  const linkChars = links.reduce((total, link) => total + link.length, 0)
  const linkDensity = normalized.length > 0 ? linkChars / normalized.length : 0
  const readableUnits = countReadableUnits(normalized)
  return {
    textLength: normalized.length,
    paragraphCount: paragraphs.length,
    readableUnits,
    linkDensity,
    isThin: normalized.length < 200 || readableUnits < 60,
    isLinkFarm: linkDensity > 0.5 && paragraphs.length < 3,
  }
}

interface JsonLdArticle {
  body?: string
  headline?: string
  publishedTime?: string
  byline?: string
}

const readJsonLdArticle = (doc: any): JsonLdArticle | null => {
  const scripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]') as any) as any[]
  for (const script of scripts) {
    const raw = script.textContent || ''
    if (!raw.trim()) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      continue
    }
    const queue: unknown[] = Array.isArray(parsed) ? [...parsed] : [parsed]
    while (queue.length > 0) {
      const current = queue.shift()
      if (!current || typeof current !== 'object') continue
      const record = current as Record<string, unknown>
      if (Array.isArray(record['@graph'])) queue.push(...record['@graph'])
      const types = Array.isArray(record['@type']) ? record['@type'] : [record['@type']]
      const isArticle = types.some((type) =>
        typeof type === 'string' && /^(?:article|newsarticle|blogposting|techarticle|report)$/i.test(type))
      const body = typeof record.articleBody === 'string' ? record.articleBody : undefined
      if (isArticle && body && normalizeText(body).length >= MIN_JSONLD_CHARS) {
        return {
          body: normalizeText(body),
          headline: typeof record.headline === 'string' ? record.headline.trim() : undefined,
          publishedTime: typeof record.datePublished === 'string' ? record.datePublished : undefined,
          byline: typeof record.author === 'object' && record.author
            ? (typeof (record.author as Record<string, unknown>).name === 'string'
              ? (record.author as Record<string, unknown>).name as string
              : undefined)
            : typeof record.author === 'string' ? record.author : undefined,
        }
      }
    }
  }
  return null
}

const readMetaContent = (doc: any, selectors: string[]): string | undefined => {
  for (const selector of selectors) {
    const value = doc.querySelector(selector)?.getAttribute('content')
    const trimmed = (value || '').trim()
    if (trimmed) return trimmed
  }
  return undefined
}

const normalizeImageUrl = (value: string | null | undefined, baseUrl: string): string | null => {
  const raw = (value || '').trim()
  if (!raw || /^data:image\//i.test(raw)) return null
  try {
    const url = new URL(raw, baseUrl)
    if (!/^https?:$/i.test(url.protocol)) return null
    if (isDisallowedHostname(url.hostname)) return null
    return url.toString()
  } catch {
    return null
  }
}

const isDecorativeImage = (url: string): boolean => {
  const normalized = url.toLowerCase()
  return normalized.includes('favicon') || normalized.includes('sprite') || normalized.includes('/logo') || normalized.includes('icon')
}

const collectImages = (doc: any, baseUrl: string): UrlReadImage[] => {
  const images: UrlReadImage[] = []
  const seen = new Set<string>()
  const push = (item: UrlReadImage) => {
    if (seen.has(item.url)) return
    seen.add(item.url)
    images.push(item)
  }
  const metaCandidates = [
    readMetaContent(doc, ['meta[property="og:image"]', 'meta[property="og:image:url"]', 'meta[name="twitter:image"]', 'meta[name="twitter:image:src"]']),
  ]
  for (const candidate of metaCandidates) {
    const normalized = normalizeImageUrl(candidate, baseUrl)
    if (normalized) push({ url: normalized, source: 'meta' })
  }
  const roots = Array.from(doc.querySelectorAll('article,main,[role="main"],.article-content,.post-content,.entry-content') as any) as any[]
  const scopes = roots.length > 0 ? roots : doc.body ? [doc.body] : []
  for (const root of scopes) {
    for (const element of Array.from(root.querySelectorAll('img') as any) as any[]) {
      const src =
        element.getAttribute('src') ||
        element.getAttribute('data-src') ||
        element.getAttribute('data-original') ||
        (element.getAttribute('srcset') || '').split(',')[0]?.trim().split(/\s+/)[0]
      const normalized = normalizeImageUrl(src, baseUrl)
      if (!normalized || isDecorativeImage(normalized)) continue
      const width = Number.parseInt(element.getAttribute('width') || '', 10)
      const height = Number.parseInt(element.getAttribute('height') || '', 10)
      push({
        url: normalized,
        alt: (element.getAttribute('alt') || '').trim() || undefined,
        ...(Number.isFinite(width) && width > 0 ? { width } : {}),
        ...(Number.isFinite(height) && height > 0 ? { height } : {}),
        source: 'content',
      })
      if (images.length >= MAX_EXTRACTED_IMAGES) break
    }
    if (images.length >= MAX_EXTRACTED_IMAGES) break
  }
  return images.slice(0, MAX_EXTRACTED_IMAGES)
}

const scoreCandidate = (candidate: Candidate): number => {
  const quality = assessContentQuality(candidate.text, candidate.html)
  let score = candidate.text.length + quality.paragraphCount * 60
  score -= quality.linkDensity * candidate.text.length * 0.8
  if (candidate.source === 'jsonld') score *= 1.05
  return score
}

const buildArticleCandidates = (doc: any): Candidate[] => {
  const candidates: Candidate[] = []
  const containers = Array.from(
    doc.querySelectorAll('article,main,[role="main"],.article-content,.post-content,.entry-content,.markdown-body,#content,.content') as any,
  ) as any[]
  for (const container of containers) {
    const text = containerText(container)
    if (text.length < MIN_DOCUMENT_CHARS) continue
    const quality = assessContentQuality(text, container.innerHTML)
    // 纯导航骨架不是正文：链接几乎占满文本时丢弃该候选。
    if (quality.navigationRatio > 0.85 && quality.paragraphCount < 2) continue
    candidates.push({ kind: 'article', text, html: container.innerHTML, source: 'semantic' })
  }

  if (doc.body) {
    const clone = doc.body.cloneNode(true) as any
    removeNonContent(clone)
    const blocks = elementTextBlocks(clone)
    if (blocks.length > 0) {
      const text = normalizeText(blocks.join('\n\n'))
      const quality = assessContentQuality(text, clone.innerHTML)
      if (text.length >= MIN_DOCUMENT_CHARS && !(quality.navigationRatio > 0.85 && quality.paragraphCount < 2)) {
        candidates.push({ kind: 'article', text, html: '', source: 'blocks' })
      }
    }
  }

  try {
    const reader = new Readability(doc, { charThreshold: 20 })
    const article = reader.parse()
    if (article) {
      const text = normalizeText(article.textContent || '')
      const quality = assessContentQuality(text, article.content || '')
      if (text.length >= MIN_DOCUMENT_CHARS && !(quality.navigationRatio > 0.85 && quality.paragraphCount < 2)) {
        candidates.push({
          kind: 'article',
          text,
          html: article.content || '',
          title: (article.title || '').trim() || undefined,
          source: 'readability',
        })
      }
    }
  } catch {
    // Readability failure must not discard the other candidates.
  }
  return candidates
}

export function extractDocumentFromHtml(
  html: string,
  url: string,
  options: ExtractDocumentOptions = {},
): ExtractedDocument | null {
  if (!html || !html.trim()) return null
  const maxContentLength = options.maxContentLength ?? DEFAULT_MAX_CONTENT_LENGTH
  const dom = new JSDOM(html, { url, runScripts: undefined, resources: undefined })
  try {
    const doc = dom.window.document
    const images = collectImages(doc, url)
    const jsonld = readJsonLdArticle(doc)
    const pageTitle =
      readMetaContent(doc, ['meta[property="og:title"]', 'meta[name="twitter:title"]']) ||
      (doc.title || '').trim() ||
      (doc.querySelector('h1')?.textContent || '').trim()
    const byline = readMetaContent(doc, ['meta[name="author"]', 'meta[property="article:author"]'])
    const siteName = readMetaContent(doc, ['meta[property="og:site_name"]'])
    const lang = (doc.documentElement.getAttribute('lang') || '').trim() || undefined
    const publishedTime =
      readMetaContent(doc, ['meta[property="article:published_time"]', 'meta[name="date"]', 'meta[itemprop="datePublished"]']) ||
      jsonld?.publishedTime

    // Readability 会重写 body，先保留原始可见文本用于登录墙/删除提示判定。
    const pageFallbackText = normalizeText(doc.body?.textContent || '')
    const candidates: Candidate[] = []
    if (jsonld?.body) {
      candidates.push({
        kind: 'article',
        text: jsonld.body,
        html: '',
        title: jsonld.headline,
        source: 'jsonld',
      })
    }
    // 结构化内容要在 Readability 改写 DOM 之前读取，否则列表/表格可能已被清空。
    const structured = extractStructuredContent(doc, url)
    candidates.push(...buildArticleCandidates(doc))

    const bestArticle = candidates
      .map((candidate) => ({ candidate, score: scoreCandidate(candidate) }))
      .sort((a, b) => b.score - a.score)[0]

    const articleText = bestArticle?.candidate.text || ''
    const articleQuality = bestArticle
      ? assessContentQuality(bestArticle.candidate.text, bestArticle.candidate.html || html)
      : undefined
    const structuredItemCount = structured ? structured.text.split('\n').filter(Boolean).length : 0
    const articleCandidate = bestArticle?.candidate
    const hasProseBlocks = Boolean(
      articleCandidate && (
        articleCandidate.source === 'jsonld' ||
        /<p\b/i.test(articleCandidate.html) ||
        (articleQuality?.paragraphCount ?? 0) >= 2
      ),
    )
    // 结构化只能补位：只要已有可用散文段落（长度过最小阈值），就优先保留短正文。
    const articleSource = articleCandidate?.source
    const hasProseSource = Boolean(
      articleCandidate && (
        articleSource === 'jsonld' ||
        articleSource === 'readability' ||
        articleSource === 'semantic' ||
        /<p\b/i.test(articleCandidate.html)
      ),
    )
    const articleUsable = Boolean(
      bestArticle &&
      articleText.length >= MIN_ARTICLE_CHARS &&
      hasProseBlocks &&
      hasProseSource,
    )
    const useStructured = Boolean(
      structured &&
      structuredItemCount >= 3 &&
      !articleUsable,
    )
    const chosen: Candidate | null = useStructured && structured
      ? { ...structured, kind: structured.kind === 'table' ? 'table' : 'listing' }
      : bestArticle?.candidate ?? null

    if (!chosen || chosen.text.length < MIN_DOCUMENT_CHARS) {
      // 登录墙、删除提示本身很短，但必须让调用方看到真实状态而不是“空内容”。
      const pageText = pageFallbackText
      const pageQuality = assessContentQuality(pageText, html)
      if (pageText && (pageQuality.isDeletedNotice || pageQuality.isLoginWall)) {
        return {
          title: pageTitle,
          text: pageText,
          html: '',
          excerpt: pageText.slice(0, 220),
          byline,
          siteName,
          lang,
          publishedTime,
          contentKind: 'article',
          quality: pageQuality,
          wordCount: countReadableUnits(pageText),
          images,
          maxLengthTruncated: false,
        }
      }
      return null
    }

    const rawText = chosen.text
    const truncated = rawText.length > maxContentLength
    const text = truncated
      ? normalizeText(rawText.slice(0, maxContentLength)) + '\n\n[内容已截断，原文过长...]'
      : normalizeText(rawText)
    const quality = assessContentQuality(text, chosen.html || html)
    if (chosen.kind === 'listing' || chosen.kind === 'table') quality.isThin = false
    // 正文内容仍保留；仅把“多新闻条目聚合页”的语义类型标为 structured。
    const contentKind: ExtractedDocument['contentKind'] = chosen.kind !== 'article'
      ? 'structured'
      : looksLikeNewsListingText(text) || looksLikeNewsListingHtml(chosen.html) ? 'structured' : 'article'
    const title = (chosen.title || pageTitle || '').trim()
    const excerpt = text.slice(0, 220) + (text.length > 220 ? '...' : '')
    const leadImageUrl = images[0]?.url

    return {
      title,
      text,
      html: chosen.html,
      excerpt,
      byline: byline || jsonld?.byline,
      siteName,
      lang,
      publishedTime,
      contentKind,
      quality,
      wordCount: countReadableUnits(text),
      ...(leadImageUrl ? { leadImageUrl } : {}),
      images,
      maxLengthTruncated: truncated,
    }
  } finally {
    dom.window.close()
  }
}