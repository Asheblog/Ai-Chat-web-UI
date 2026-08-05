'use client'

import { useState } from 'react'
import { ChevronDown, Image as ImageIcon } from 'lucide-react'
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

const trustConfidenceLabelMap: Record<RichMessageEvidenceConfidence, string> = {
  high: '可信度 高',
  medium: '可信度 中',
  low: '可信度 低',
}

const relevanceConfidenceLabelMap: Record<RichMessageEvidenceConfidence, string> = {
  high: '相关',
  medium: '弱相关',
  low: '无关',
}

const normalizeLayout = (
  preferredLayout: RichMessagePayload['layout'],
  hasText: boolean,
  hasImage: boolean,
): RichMessagePayload['layout'] => {
  if (!hasImage) return 'auto'
  if (!hasText) return 'stack'
  if (preferredLayout === 'side-by-side') return 'side-by-side'
  if (preferredLayout === 'stack') return 'stack'
  return 'auto'
}

const isWebEvidenceImage = (image: RichMessageImagePart): boolean =>
  image.source === 'external' && (image.sourceKind === 'web' || image.sourceKind === 'document')

const toImageAlt = (image: RichMessageImagePart, index: number) =>
  image.alt?.trim() || image.title?.trim() || `证据图片 ${index + 1}`

const toEvidenceKindLabel = (kind?: RichMessageEvidenceKind) =>
  evidenceKindLabelMap[kind || 'unknown'] || evidenceKindLabelMap.unknown

const toConfidenceLabel = (image: RichMessageImagePart) => {
  if (!image.confidence) return null
  if (isWebEvidenceImage(image)) {
    return relevanceConfidenceLabelMap[image.confidence]
  }
  return trustConfidenceLabelMap[image.confidence]
}

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

interface EvidenceImageCardProps {
  image: RichMessageImagePart
  index: number
}

function EvidenceImageCard({ image, index }: EvidenceImageCardProps) {
  const confidenceLabel = toConfidenceLabel(image)
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
      <div className="mt-2 flex flex-wrap items-center gap-2 text-micro text-muted-foreground">
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

function EvidenceImageGrid({ images }: { images: RichMessageImagePart[] }) {
  return (
    <div
      className={cn(
        'grid gap-3',
        images.length > 1 ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1',
      )}
    >
      {images.map((image, index) => (
        <EvidenceImageCard key={`${image.url}-${index}`} image={image} index={index} />
      ))}
    </div>
  )
}

export function RichMessageRenderer({
  payload,
  className,
  textHtml,
  isStreaming = false,
  isRendering = false,
}: RichMessageRendererProps) {
  const [imagesExpanded, setImagesExpanded] = useState(false)
  const textParts = payload.parts.filter((part) => part.type === 'text')
  const imageParts = payload.parts.filter(
    (part): part is RichMessageImagePart => part.type === 'image',
  )
  const textFallback = textParts.map((part) => part.text).join('\n\n')
  const hasText = textFallback.trim().length > 0
  const hasImages = imageParts.length > 0
  const hasWebEvidence = imageParts.some(isWebEvidenceImage)
  const layout = hasWebEvidence && hasText && hasImages
    ? 'stack'
    : normalizeLayout(payload.layout, hasText, hasImages)
  const evidenceStack = layout === 'stack' && hasText && hasImages && hasWebEvidence
  const sideBySide = layout === 'side-by-side' && hasText && hasImages && !evidenceStack
  const renderMode = evidenceStack ? 'evidence-stack' : 'default'
  const showImagesExpanded = evidenceStack || imagesExpanded

  return (
    <div
      data-testid="rich-message-renderer"
      data-layout={layout}
      data-render-mode={renderMode}
      className={cn(
        'w-full',
        sideBySide && 'grid gap-4 lg:grid lg:grid-cols-12 lg:gap-5',
        evidenceStack && 'flex flex-col gap-4',
        className,
      )}
    >
      {hasText && (
        <div className={cn('min-w-0', sideBySide && 'lg:col-span-7')}>
          <MarkdownRenderer
            html={textHtml ?? null}
            fallback={textFallback}
            isStreaming={isStreaming}
            isRendering={isRendering}
          />
        </div>
      )}

      {hasImages && (
        <div className={cn('min-w-0', sideBySide && 'lg:col-span-5')}>
          {evidenceStack ? (
            <div className="border-t border-border/70 pt-3">
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold text-foreground/85">相关图片</h3>
                <span className="text-micro text-muted-foreground">{imageParts.length} 张</span>
              </div>
              <EvidenceImageGrid images={imageParts} />
            </div>
          ) : (
            <>
              <button
                type="button"
                className="mt-3 flex w-full items-center justify-between gap-3 rounded-md border border-border bg-surface px-4 py-2.5 text-left text-sm transition hover:bg-accent"
                onClick={() => setImagesExpanded((value) => !value)}
                aria-expanded={imagesExpanded}
              >
                <span className="flex min-w-0 items-center gap-2 font-medium text-foreground/80">
                  <ImageIcon className="h-4 w-4 text-muted-foreground" />
                  查看图片（{imageParts.length} 张）
                </span>
                {!imagesExpanded && (
                  <span className="ml-auto hidden max-w-[180px] items-center gap-1 sm:flex">
                    {imageParts.slice(0, 3).map((image, index) => (
                      <img
                        key={`${image.url}-thumb-${index}`}
                        src={image.url}
                        alt=""
                        className="h-7 w-10 rounded border border-border object-cover"
                        loading="lazy"
                      />
                    ))}
                  </span>
                )}
                <ChevronDown
                  className={cn(
                    'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                    imagesExpanded && 'rotate-180',
                  )}
                />
              </button>
              {showImagesExpanded && (
                <div className="mt-3">
                  <EvidenceImageGrid images={imageParts} />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
