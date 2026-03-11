import type {
  RichMessageEvidenceConfidence,
  RichMessageEvidenceKind,
  RichMessageImagePart,
  RichMessagePart,
  RichMessagePayload,
} from '../../types'

export interface GeneratedImageRecord {
  url?: string | null
  storagePath?: string | null
  base64?: string | null
  mime?: string | null
  width?: number | null
  height?: number | null
  revisedPrompt?: string | null
}

export interface BuildRichPayloadParams {
  content: string | null | undefined
  attachmentRelativePaths?: string[] | null
  generatedImages?: GeneratedImageRecord[] | null
  toolLogsJson?: string | null
  baseUrl: string
  resolveChatImageUrls: (relativePaths: string[], baseUrl: string) => string[]
}

type AnyRecord = Record<string, unknown>

const IMAGE_URL_KEYS = [
  'imageUrl',
  'image_url',
  'leadImageUrl',
  'lead_image_url',
  'thumbnail',
  'thumbnailUrl',
  'thumbnail_url',
  'previewImage',
  'preview_image',
  'cover',
  'coverUrl',
  'cover_url',
  'screenshot',
  'poster',
  'pic',
  'picUrl',
  'pic_url',
  'src',
]

const TITLE_KEYS = ['title', 'name', 'caption', 'alt', 'description']

const SOURCE_URL_KEYS = ['sourceUrl', 'source_url', 'link', 'pageUrl', 'page_url', 'url']

const asRecord = (value: unknown): AnyRecord | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as AnyRecord) : null

const pickString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null

const pickStringFromKeys = (obj: AnyRecord, keys: string[]): string | null => {
  for (const key of keys) {
    const next = pickString(obj[key])
    if (next) return next
  }
  return null
}

const looksLikeImageUrl = (url: string): boolean =>
  /^https?:\/\/.+\.(?:png|jpe?g|gif|webp|svg|bmp|avif)(?:[?#].*)?$/i.test(url) ||
  /^data:image\//i.test(url)

const normalizePositiveInt = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const normalized = Math.trunc(value)
  return normalized > 0 ? normalized : undefined
}

const normalizeEvidenceUrl = (value: string | null, baseUrl: string): string | null => {
  if (!value) return null
  if (/^data:image\//i.test(value)) return value
  if (/^https?:\/\//i.test(value)) return value
  if (value.startsWith('//')) return `https:${value}`
  if (value.startsWith('/')) {
    const base = baseUrl.trim().replace(/\/+$/, '')
    return base ? `${base}${value}` : value
  }
  return value
}

const normalizeConfidence = (value: unknown): RichMessageEvidenceConfidence | undefined => {
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase()
    if (lower === 'high' || lower === 'medium' || lower === 'low') return lower
    if (lower === 'strong') return 'high'
    if (lower === 'weak') return 'low'
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 0.75) return 'high'
    if (value >= 0.4) return 'medium'
    return 'low'
  }
  return undefined
}

const inferSourceKind = (tool: string): RichMessageEvidenceKind => {
  const normalized = tool.trim().toLowerCase()
  if (
    normalized.includes('document') ||
    normalized.includes('kb_search') ||
    normalized.includes('read_url') ||
    normalized.includes('knowledge')
  ) {
    return 'document'
  }
  if (normalized.includes('web_search') || normalized.includes('search')) {
    return 'web'
  }
  return 'unknown'
}

const toHostLabel = (rawUrl?: string): string | undefined => {
  if (!rawUrl) return undefined
  try {
    const host = new URL(rawUrl).hostname
    return host || undefined
  } catch {
    return undefined
  }
}

const extractImageUrlFromRecord = (record: AnyRecord): string | null => {
  const direct = pickStringFromKeys(record, IMAGE_URL_KEYS)
  if (direct) return direct

  const imageObj = asRecord(record.image) ?? asRecord(record.image_url) ?? asRecord(record.thumbnail)
  if (imageObj) {
    const nested = pickStringFromKeys(imageObj, ['url', 'src'])
    if (nested) return nested
  }

  const rawUrl = pickString(record.url)
  if (rawUrl && looksLikeImageUrl(rawUrl)) return rawUrl
  return null
}

const extractContextMeta = (record: AnyRecord): Record<string, unknown> | undefined => {
  const meta: Record<string, unknown> = {}
  const pageRaw = record.pageNumber ?? record.page ?? record.docPage
  if (typeof pageRaw === 'number' && Number.isFinite(pageRaw) && pageRaw > 0) {
    meta.pageNumber = Math.trunc(pageRaw)
  }
  const docName = pickString(record.documentName ?? record.docTitle ?? record.fileName ?? record.filename)
  if (docName) meta.documentName = docName
  const capturedAt = pickString(record.capturedAt ?? record.fetchedAt ?? record.scrapedAt)
  if (capturedAt) meta.capturedAt = capturedAt
  return Object.keys(meta).length > 0 ? meta : undefined
}

const resolveGeneratedImageUrl = (
  image: GeneratedImageRecord,
  baseUrl: string,
  resolveChatImageUrls: (relativePaths: string[], baseUrl: string) => string[],
): string | null => {
  const direct = normalizeEvidenceUrl(pickString(image.url), baseUrl)
  if (direct) return direct

  const storagePath = pickString(image.storagePath)
  if (storagePath) {
    const resolved = resolveChatImageUrls([storagePath], baseUrl)[0]
    if (resolved) return resolved
  }

  const base64 = pickString(image.base64)
  if (base64) {
    const mime = pickString(image.mime) || 'image/png'
    return `data:${mime};base64,${base64}`
  }
  return null
}

const normalizeSourceUrl = (
  candidate: string | null,
  imageUrl: string,
  baseUrl: string,
): string | undefined => {
  const normalized = normalizeEvidenceUrl(candidate, baseUrl)
  if (!normalized) return undefined
  if (normalized === imageUrl) return undefined
  if (looksLikeImageUrl(normalized)) return undefined
  return normalized
}

const buildExternalImageParts = (toolLogsJson: string | null | undefined, baseUrl: string): RichMessageImagePart[] => {
  if (!toolLogsJson) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(toolLogsJson)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const parts: RichMessageImagePart[] = []
  for (const entry of parsed) {
    const event = asRecord(entry)
    if (!event) continue
    const tool = pickString(event.tool) || ''
    const normalizedTool = tool.trim().toLowerCase()
    const isWebSearchTool = normalizedTool.includes('web_search') || normalizedTool.endsWith('search')
    const isReadUrlTool = normalizedTool.includes('read_url')
    const details = asRecord(event.details)
    const parentTool = pickString(details?.parentTool)
    const sourceKind = inferSourceKind(parentTool || tool)
    const hits = Array.isArray(event.hits) ? event.hits : []
    const eventSummary = pickString(event.summary)
    const eventQuery = pickString(event.query)
    const eventUrl = normalizeEvidenceUrl(pickString(event.url), baseUrl)
    const defaultConfidence =
      normalizeConfidence(details?.confidence) ??
      normalizeConfidence(details?.reliability) ??
      normalizeConfidence(details?.score)

    const candidateRecords: Array<{
      record: AnyRecord
      orderHint?: number
    }> = []
    if (details) {
      candidateRecords.push({
        record: details,
        orderHint: normalizePositiveInt(details.rank),
      })
    }
    for (const [hitIndex, hit] of hits.entries()) {
      const hitRecord = asRecord(hit)
      if (!hitRecord) continue
      candidateRecords.push({
        record: hitRecord,
        orderHint: normalizePositiveInt(hitRecord.rank) ?? hitIndex + 1,
      })
    }

    for (const [candidateIndex, candidate] of candidateRecords.entries()) {
      const { record, orderHint } = candidate
      const rawImageUrl = extractImageUrlFromRecord(record)
      const url = normalizeEvidenceUrl(rawImageUrl, baseUrl)
      if (!url) continue
      const sourceUrl = (() => {
        if (isReadUrlTool) {
          return normalizeSourceUrl(eventUrl || null, url, baseUrl)
        }
        if (isWebSearchTool) {
          const hitUrl = pickString(record.url)
          return normalizeSourceUrl(hitUrl || eventUrl || null, url, baseUrl)
        }
        const genericSource = pickStringFromKeys(record, SOURCE_URL_KEYS) || eventUrl || null
        return normalizeSourceUrl(genericSource, url, baseUrl)
      })()
      const title = pickStringFromKeys(record, TITLE_KEYS) || eventSummary || undefined
      const confidence =
        normalizeConfidence(record.confidence) ??
        normalizeConfidence(record.reliability) ??
        normalizeConfidence(record.score) ??
        defaultConfidence
      const metaFromRecord = extractContextMeta(record)
      const evidenceOrder = orderHint ?? candidateIndex + 1
      const meta =
        metaFromRecord || eventQuery || evidenceOrder
          ? {
              ...(metaFromRecord ?? {}),
              ...(eventQuery ? { query: eventQuery } : {}),
              evidenceOrder,
            }
          : undefined

      parts.push({
        type: 'image',
        source: 'external',
        sourceKind,
        url,
        title,
        sourceUrl,
        sourceLabel: toHostLabel(sourceUrl),
        confidence,
        alt: title || '外部证据图片',
        meta,
      })
    }
  }
  return parts
}

export const buildRichMessagePayload = ({
  content,
  attachmentRelativePaths,
  generatedImages,
  toolLogsJson,
  baseUrl,
  resolveChatImageUrls,
}: BuildRichPayloadParams): RichMessagePayload | null => {
  const normalizedContent = typeof content === 'string' ? content : ''
  const hasText = normalizedContent.trim().length > 0
  const parts: RichMessagePart[] = []
  if (hasText) {
    parts.push({
      type: 'text',
      text: normalizedContent,
      format: 'markdown',
    })
  }

  const attachmentUrls = resolveChatImageUrls(
    (attachmentRelativePaths ?? []).filter((item) => typeof item === 'string' && item.trim().length > 0),
    baseUrl,
  )
  const attachmentParts: RichMessageImagePart[] = attachmentUrls.map((url, index) => ({
    type: 'image',
    source: 'attachment',
    sourceKind: 'upload',
    url,
    alt: `上传图片 ${index + 1}`,
  }))

  const generatedParts: RichMessageImagePart[] = []
  for (const [index, image] of (generatedImages ?? []).entries()) {
    const url = resolveGeneratedImageUrl(image, baseUrl, resolveChatImageUrls)
    if (!url) continue
    const title = pickString(image.revisedPrompt) || undefined
    generatedParts.push({
      type: 'image',
      source: 'generated',
      sourceKind: 'generated',
      url,
      alt: title || `AI 生成图片 ${index + 1}`,
      title,
      width: typeof image.width === 'number' ? image.width : null,
      height: typeof image.height === 'number' ? image.height : null,
    })
  }

  const externalParts = buildExternalImageParts(toolLogsJson, baseUrl)
  const dedupe = new Set<string>()
  const imageParts = [...attachmentParts, ...generatedParts, ...externalParts]
    .filter((part) => {
      if (!part.url) return false
      if (dedupe.has(part.url)) return false
      dedupe.add(part.url)
      return true
    })
    .map((part, index) => ({ ...part, refId: `img-${index + 1}` }))

  parts.push(...imageParts)
  if (parts.length === 0) return null

  return {
    layout: hasText && imageParts.length > 0 ? 'side-by-side' : imageParts.length > 0 ? 'stack' : 'auto',
    parts,
  }
}
