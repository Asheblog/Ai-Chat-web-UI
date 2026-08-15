import type { RichMessageEvidenceConfidence } from '../types'
import type { VisionProxyConfig, VisionProxyService } from '../modules/chat/services/vision-proxy-service'
import { isVisionProxyReady } from '../modules/chat/services/vision-proxy-service'
import { readRemoteImages, type RemoteImageCandidate } from './remote-image-reader'

export type WebImageRelevance = 'related' | 'weakly_related' | 'unrelated'

export interface WebImageCandidate {
  url: string
  alt?: string
  title?: string
  sourceUrl?: string
  width?: number
  height?: number
  source?: string
}

export interface AssessedWebImage extends WebImageCandidate {
  relevance: WebImageRelevance
  confidence: RichMessageEvidenceConfidence
  description: string
}

export const WEB_EVIDENCE_MAX_DISPLAY = 4
export const WEB_EVIDENCE_MAX_PER_PAGE = 3
export const WEB_EVIDENCE_MAX_PER_TURN = 6

const LOGO_OR_ICON_RE =
  /(?:^|[\/_-])(logo|icon|favicon|sprite|avatar|emoji|badge|btn|button|spacer|pixel|tracking)(?:[\/_.-]|$)/i
const TINY_DATA_URI_RE = /^data:image\/(?:gif|png|jpeg|jpg|webp|svg\+xml);base64,[a-z0-9+/=]{0,200}$/i

export const relevanceToConfidence = (relevance: WebImageRelevance): RichMessageEvidenceConfidence => {
  if (relevance === 'related') return 'high'
  if (relevance === 'weakly_related') return 'medium'
  return 'low'
}

export const isDisplayableRelevance = (relevance: WebImageRelevance): boolean =>
  relevance === 'related' || relevance === 'weakly_related'

export const parseImageRelevance = (raw: string): { relevance: WebImageRelevance; description: string } => {
  const text = (raw || '').trim()
  if (!text) {
    return { relevance: 'unrelated', description: '' }
  }

  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as {
        relevance?: unknown
        related?: unknown
        description?: unknown
        summary?: unknown
      }
      const description =
        (typeof parsed.description === 'string' && parsed.description.trim()) ||
        (typeof parsed.summary === 'string' && parsed.summary.trim()) ||
        text
      const relevanceRaw = String(parsed.relevance ?? parsed.related ?? '')
        .trim()
        .toLowerCase()
      if (
        relevanceRaw === 'related' ||
        relevanceRaw === 'relevant' ||
        relevanceRaw === '相关' ||
        relevanceRaw === 'true'
      ) {
        return { relevance: 'related', description }
      }
      if (
        relevanceRaw === 'weakly_related' ||
        relevanceRaw === 'weak' ||
        relevanceRaw === 'partial' ||
        relevanceRaw === '弱相关'
      ) {
        return { relevance: 'weakly_related', description }
      }
      if (
        relevanceRaw === 'unrelated' ||
        relevanceRaw === 'irrelevant' ||
        relevanceRaw === '无关' ||
        relevanceRaw === 'false'
      ) {
        return { relevance: 'unrelated', description }
      }
    } catch {
      // fall through to heuristic
    }
  }

  const lower = text.toLowerCase()
  if (/无关|不相关|irrelevant|unrelated|not related|no relation/.test(lower)) {
    return { relevance: 'unrelated', description: text }
  }
  if (/弱相关|部分相关|weakly|partially related|somewhat related/.test(lower)) {
    return { relevance: 'weakly_related', description: text }
  }
  if (/相关|relevant|related/.test(lower)) {
    return { relevance: 'related', description: text }
  }
  return { relevance: 'unrelated', description: text }
}

export const prefilterWebImageCandidates = (
  candidates: WebImageCandidate[],
  options: { maxCount?: number } = {},
): WebImageCandidate[] => {
  const maxCount = Math.max(1, Math.min(WEB_EVIDENCE_MAX_PER_PAGE, options.maxCount ?? WEB_EVIDENCE_MAX_PER_PAGE))
  const seen = new Set<string>()
  const kept: WebImageCandidate[] = []

  for (const candidate of candidates) {
    const url = typeof candidate.url === 'string' ? candidate.url.trim() : ''
    if (!url || seen.has(url)) continue
    if (TINY_DATA_URI_RE.test(url)) continue
    if (!/^https?:\/\//i.test(url) && !url.startsWith('data:image/')) continue
    if (LOGO_OR_ICON_RE.test(url)) continue
    const width = typeof candidate.width === 'number' ? candidate.width : null
    const height = typeof candidate.height === 'number' ? candidate.height : null
    if ((width != null && width > 0 && width < 64) || (height != null && height > 0 && height < 64)) {
      continue
    }
    seen.add(url)
    kept.push({ ...candidate, url })
    if (kept.length >= maxCount) break
  }

  return kept
}

const RELEVANCE_PROMPT = `判断这张图片与给定新闻/页面上下文是否相关。
只输出一行 JSON，格式：{"relevance":"related|weakly_related|unrelated","description":"一句话描述图片内容"}
规则：
- related：图片直接表现新闻主体、现场、人物、图表结论
- weakly_related：配图有一定关联（如数据图、城市远景）但非核心
- unrelated：广告、站点 logo、社交分享按钮、无关行情图、装饰图
上下文：`

export async function assessWebImageRelevance(params: {
  candidates: WebImageCandidate[]
  contextText: string
  visionProxy: VisionProxyService
  visionConfig: VisionProxyConfig
  maxCount?: number
  maxTurnBudget?: number
}): Promise<AssessedWebImage[]> {
  if (!isVisionProxyReady(params.visionConfig)) {
    return []
  }

  const filtered = prefilterWebImageCandidates(params.candidates, { maxCount: params.maxCount })
  if (filtered.length === 0) return []

  const turnBudget = Math.max(
    1,
    Math.min(WEB_EVIDENCE_MAX_PER_TURN, params.maxTurnBudget ?? WEB_EVIDENCE_MAX_PER_TURN),
  )
  const limited = filtered.slice(0, Math.min(filtered.length, turnBudget, params.maxCount ?? WEB_EVIDENCE_MAX_PER_PAGE))

  const remoteCandidates: RemoteImageCandidate[] = limited.map((item) => ({
    url: item.url,
    alt: item.alt || item.title,
    width: item.width,
    height: item.height,
    source: item.source,
  }))

  const downloaded = await readRemoteImages(remoteCandidates, {
    maxCount: limited.length,
  })
  if (downloaded.length === 0) return []

  const contextText = (params.contextText || '').trim().slice(0, 1200)
  const assessed: AssessedWebImage[] = []

  for (const image of downloaded) {
    const original = limited.find((item) => item.url === image.url) || {
      url: image.url,
      alt: image.alt,
    }
    try {
      const result = await params.visionProxy.transcribeImages(
        [{ data: image.data, mime: image.mime }],
        `${RELEVANCE_PROMPT}${contextText || '（无额外上下文）'}`,
        params.visionConfig,
      )
      const parsed = parseImageRelevance(result.description)
      assessed.push({
        ...original,
        url: image.url,
        relevance: parsed.relevance,
        confidence: relevanceToConfidence(parsed.relevance),
        description: parsed.description,
      })
    } catch {
      // skip failed image; do not fail the whole search
    }
  }

  return assessed
    .filter((item) => isDisplayableRelevance(item.relevance))
    .slice(0, WEB_EVIDENCE_MAX_DISPLAY)
}
