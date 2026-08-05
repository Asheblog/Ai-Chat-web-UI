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

export interface ToolEventImageSource {
  tool?: string
  url?: string
  summary?: string
  hits?: Array<{
    title?: string
    url?: string
    imageUrl?: string
    thumbnailUrl?: string
  }>
  details?: {
    leadImageUrl?: string
    images?: Array<{
      url?: string
      title?: string
      alt?: string
      confidence?: RichMessageEvidenceConfidence
      description?: string
    }>
    assessedImages?: Array<{
      url?: string
      title?: string
      alt?: string
      sourceUrl?: string
      confidence?: RichMessageEvidenceConfidence
      description?: string
      relevance?: string
    }>
  }
}

export interface BuildRichPayloadParams {
  content: string | null | undefined
  attachmentRelativePaths?: string[] | null
  generatedImages?: GeneratedImageRecord[] | null
  toolEvents?: ToolEventImageSource[] | null
  baseUrl: string
  resolveChatImageUrls: (relativePaths: string[], baseUrl: string) => string[]
}

const pickString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null

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

const toConfidence = (value: unknown): RichMessageEvidenceConfidence | undefined => {
  if (value === 'high' || value === 'medium' || value === 'low') return value
  return undefined
}

export const extractExternalImageParts = (
  toolEvents: ToolEventImageSource[] | null | undefined,
): RichMessageImagePart[] => {
  const images: RichMessageImagePart[] = []
  const seen = new Set<string>()

  const pushExternalImage = (
    url: unknown,
    options: {
      sourceUrl?: unknown
      title?: unknown
      sourceLabel?: unknown
      sourceKind?: RichMessageEvidenceKind
      confidence?: RichMessageEvidenceConfidence
      description?: unknown
      meta?: Record<string, unknown>
    } = {},
  ) => {
    const normalizedUrl = typeof url === 'string' ? url.trim() : ''
    if (!normalizedUrl || seen.has(normalizedUrl)) return
    seen.add(normalizedUrl)
    const normalizedSourceUrl =
      typeof options.sourceUrl === 'string' && options.sourceUrl.trim().length > 0
        ? options.sourceUrl.trim()
        : undefined
    const normalizedTitle =
      typeof options.title === 'string' && options.title.trim().length > 0
        ? options.title.trim()
        : undefined
    const normalizedSourceLabel =
      typeof options.sourceLabel === 'string' && options.sourceLabel.trim().length > 0
        ? options.sourceLabel.trim()
        : undefined
    const description =
      typeof options.description === 'string' && options.description.trim().length > 0
        ? options.description.trim()
        : undefined
    images.push({
      type: 'image',
      source: 'external',
      sourceKind: options.sourceKind ?? 'web',
      url: normalizedUrl,
      sourceUrl: normalizedSourceUrl,
      alt: normalizedTitle || description,
      title: normalizedTitle,
      sourceLabel: normalizedSourceLabel,
      confidence: options.confidence,
      meta: {
        ...(options.meta || {}),
        ...(description ? { description } : {}),
      },
    })
  }

  for (const event of toolEvents || []) {
    const assessed = Array.isArray(event.details?.assessedImages) ? event.details?.assessedImages : []
    if (assessed.length > 0) {
      for (const item of assessed) {
        const confidence = toConfidence(item.confidence)
        if (confidence === 'low') continue
        pushExternalImage(item.url, {
          sourceUrl: item.sourceUrl || event.url,
          title: item.title || item.alt || event.summary,
          sourceKind: event.tool === 'read_url' ? 'document' : 'web',
          confidence,
          description: item.description,
        })
      }
      continue
    }

    const detailImages = Array.isArray(event.details?.images) ? event.details.images : []
    for (const item of detailImages) {
      const confidence = toConfidence(item.confidence)
      // 未经过识图相关性判定的候选图不进入答案区
      if (confidence !== 'high' && confidence !== 'medium') continue
      pushExternalImage(item.url, {
        sourceUrl: event.url,
        title: item.title || item.alt || event.summary,
        sourceKind: event.tool === 'read_url' ? 'document' : 'web',
        confidence,
        description: item.description,
      })
    }
  }

  return images
}

export const buildRichMessagePayload = ({
  content,
  attachmentRelativePaths,
  generatedImages,
  toolEvents,
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

  const externalParts = extractExternalImageParts(toolEvents)

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

  const hasWebEvidence = imageParts.some(
    (part) => part.source === 'external' && (part.sourceKind === 'web' || part.sourceKind === 'document'),
  )

  return {
    layout: hasText && imageParts.length > 0
      ? hasWebEvidence
        ? 'stack'
        : 'side-by-side'
      : imageParts.length > 0
        ? 'stack'
        : 'auto',
    parts,
  }
}
