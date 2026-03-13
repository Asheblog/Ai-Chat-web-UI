'use client'

import { MarkdownRenderer } from '@/components/markdown-renderer'
import { cn } from '@/lib/utils'
import type {
  RichMessageEvidenceKind,
  RichMessageEvidenceConfidence,
  RichMessageImagePart,
  RichMessagePayload,
} from '@/types'

interface RichMessageRendererProps {
  payload: RichMessagePayload
  className?: string
  textHtml?: string | null
  isStreaming?: boolean
  isRendering?: boolean
}

const evidenceKindLabelMap: Record<RichMessageEvidenceKind, string> = {
  web: '联网',
  document: '文档',
  generated: '生成',
  upload: '附件',
  unknown: '证据',
}

const confidenceLabelMap: Record<RichMessageEvidenceConfidence, string> = {
  high: '可信度 高',
  medium: '可信度 中',
  low: '可信度 低',
}

const normalizeLayout = (
  preferredLayout: RichMessagePayload['layout'],
  hasText: boolean,
  hasImage: boolean,
): RichMessagePayload['layout'] => {
  if (!hasImage) return 'auto'
  if (!hasText) return 'stack'
  if (preferredLayout === 'side-by-side') return 'side-by-side'
  return 'auto'
}

const toImageAlt = (image: RichMessageImagePart, index: number) =>
  image.alt?.trim() || image.title?.trim() || `证据图片 ${index + 1}`

const toEvidenceKindLabel = (kind?: RichMessageEvidenceKind) =>
  evidenceKindLabelMap[kind || 'unknown'] || evidenceKindLabelMap.unknown

const toConfidenceLabel = (confidence?: RichMessageEvidenceConfidence) =>
  confidence ? confidenceLabelMap[confidence] : null

const isLikelyImageUrl = (url: string) =>
  /^https?:\/\/.+\.(?:png|jpe?g|gif|webp|svg|bmp|avif)(?:[?#].*)?$/i.test(url)

const hasValidSourceUrl = (image: RichMessageImagePart): boolean => {
  const sourceUrl = image.sourceUrl?.trim()
  if (!sourceUrl) return false
  if (!/^https?:\/\//i.test(sourceUrl)) return false
  if (sourceUrl === image.url) return false
  if (isLikelyImageUrl(sourceUrl)) return false
  return true
}

const shouldHideImagePart = (image: RichMessageImagePart): boolean =>
  image.source === 'external' && image.sourceKind === 'web'

interface EvidenceImageCardProps {
  image: RichMessageImagePart
  index: number
}

function EvidenceImageCard({ image, index }: EvidenceImageCardProps) {
  const confidenceLabel = toConfidenceLabel(image.confidence)
  const sourceLinkVisible = hasValidSourceUrl(image)

  return (
    <article
      className="rounded-xl border border-border/70 bg-[hsl(var(--surface))] p-3"
      data-testid={`evidence-card-${index + 1}`}
    >
      <a
        href={image.url}
        target="_blank"
        rel="noreferrer"
        className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <img
          src={image.url}
          alt={toImageAlt(image, index)}
          className="aspect-[4/3] w-full rounded-lg border border-border/60 bg-muted object-cover"
          loading="lazy"
        />
      </a>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span className="rounded-full border border-border/70 px-2 py-0.5">{toEvidenceKindLabel(image.sourceKind)}</span>
        {confidenceLabel && (
          <span className="rounded-full border border-border/70 px-2 py-0.5">{confidenceLabel}</span>
        )}
        {image.refId && <span className="rounded-full border border-border/70 px-2 py-0.5">{image.refId}</span>}
      </div>
      {image.title && (
        <p className="mt-2 line-clamp-2 text-sm font-medium leading-5">{image.title}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <a
          href={image.url}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-border/70 px-2.5 py-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          查看原图
        </a>
        {sourceLinkVisible && (
          <a
            href={image.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-border/70 px-2.5 py-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            查看原文
          </a>
        )}
      </div>
    </article>
  )
}

export function RichMessageRenderer({
  payload,
  className,
  textHtml,
  isStreaming = false,
  isRendering = false,
}: RichMessageRendererProps) {
  const textParts = payload.parts.filter((part) => part.type === 'text')
  const imageParts = payload.parts
    .filter((part): part is RichMessageImagePart => part.type === 'image')
    .filter((part) => !shouldHideImagePart(part))
  const textFallback = textParts.map((part) => part.text).join('\n\n')
  const hasText = textFallback.trim().length > 0
  const hasImages = imageParts.length > 0
  const layout = normalizeLayout(payload.layout, hasText, hasImages)
  const sideBySide = layout === 'side-by-side' && hasText && hasImages

  return (
    <div
      data-testid="rich-message-renderer"
      data-layout={layout}
      data-render-mode="default"
      className={cn(
        'w-full',
        sideBySide && 'grid gap-4 lg:grid lg:grid-cols-12 lg:gap-5',
        className,
      )}
    >
      {hasText && (
        <div className={cn('min-w-0', sideBySide && 'lg:col-span-7')}>
          <MarkdownRenderer
            html={hasImages ? null : textHtml ?? null}
            fallback={textFallback}
            isStreaming={isStreaming}
            isRendering={isRendering}
          />
        </div>
      )}

      {hasImages && (
        <div className={cn('min-w-0', sideBySide && 'lg:col-span-5')}>
          <div
            className={cn(
              'grid gap-3',
              imageParts.length > 1 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1',
            )}
          >
            {imageParts.map((image, index) => (
              <EvidenceImageCard key={`${image.url}-${index}`} image={image} index={index} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
