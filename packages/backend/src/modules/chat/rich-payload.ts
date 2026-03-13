import type {
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

export const buildRichMessagePayload = ({
  content,
  attachmentRelativePaths,
  generatedImages,
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

  const dedupe = new Set<string>()
  const imageParts = [...attachmentParts, ...generatedParts]
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
