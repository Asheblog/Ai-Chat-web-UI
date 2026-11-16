/**
 * 同源 feed 候选：优先读取页面声明的 <link rel="alternate">，没有声明时才使用
 * 少量常见路径猜测。调用方另行限制阶段总时长与请求数量。
 */

export interface FeedCandidate {
  url: string
  declared: boolean
}

const DECLARED_FEED_TYPES = [
  'application/rss+xml',
  'application/atom+xml',
  'application/feed+json',
  'application/rdf+xml',
]

const MAX_DECLARED = 3

export function discoverFeedCandidates(
  html: string,
  pageUrl: string,
  options: { maxDeclared?: number } = {},
): FeedCandidate[] {
  const maxDeclared = Math.max(0, options.maxDeclared ?? MAX_DECLARED)
  let base: URL
  try {
    base = new URL(pageUrl)
  } catch {
    return []
  }

  const candidates: FeedCandidate[] = []
  const seen = new Set<string>()
  const push = (url: string, declared: boolean) => {
    if (seen.has(url)) return
    seen.add(url)
    candidates.push({ url, declared })
  }

  const linkPattern = /<link\b[^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = linkPattern.exec(html || '')) !== null) {
    const tag = match[0] || ''
    const rel = (tag.match(/rel\s*=\s*["']?([^"'\s>]+)/i)?.[1] || '').toLowerCase()
    if (!rel.split(/\s+/).includes('alternate')) continue
    const type = (tag.match(/type\s*=\s*["']?([^"'\s>]+)/i)?.[1] || '').toLowerCase()
    if (!DECLARED_FEED_TYPES.includes(type)) continue
    const href = tag.match(/href\s*=\s*["']([^"']+)["']/i)?.[1]
    if (!href) continue
    try {
      const resolved = new URL(href, base).toString()
      if (!/^https?:/i.test(resolved)) continue
      push(resolved, true)
    } catch {
      continue
    }
    if (candidates.length >= maxDeclared) break
  }

  return candidates.slice(0, maxDeclared)
}
