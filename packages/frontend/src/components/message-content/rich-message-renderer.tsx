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

const normalizeLayout = (payload: RichMessagePayload): RichMessagePayload['layout'] => {
  const hasText = payload.parts.some((part) => part.type === 'text' && part.text.trim().length > 0)
  const hasImage = payload.parts.some((part) => part.type === 'image')
  if (!hasImage) return 'auto'
  if (!hasText) return 'stack'
  if (payload.layout === 'side-by-side') return 'side-by-side'
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

const isWebEvidenceImage = (image: RichMessageImagePart) =>
  image.source === 'external' && image.sourceKind === 'web'

const getEvidenceOrder = (image: RichMessageImagePart, index: number): number => {
  const fromMeta = Number((image.meta as { evidenceOrder?: unknown } | undefined)?.evidenceOrder)
  if (Number.isFinite(fromMeta) && fromMeta > 0) return Math.trunc(fromMeta)
  const fromRef = Number((image.refId || '').replace(/^img-/, ''))
  if (Number.isFinite(fromRef) && fromRef > 0) return Math.trunc(fromRef)
  return index + 1
}

const toOrderedWebEvidenceImages = (images: RichMessageImagePart[]) =>
  images
    .map((image, index) => ({ image, index, order: getEvidenceOrder(image, index) }))
    .filter((item) => isWebEvidenceImage(item.image))
    .sort((a, b) => (a.order === b.order ? a.index - b.index : a.order - b.order))
    .map((item) => item.image)

const hasValidSourceUrl = (image: RichMessageImagePart): boolean => {
  const sourceUrl = image.sourceUrl?.trim()
  if (!sourceUrl) return false
  if (!/^https?:\/\//i.test(sourceUrl)) return false
  if (sourceUrl === image.url) return false
  if (isLikelyImageUrl(sourceUrl)) return false
  return true
}

type ParsedTopLevelList = {
  prefix: string
  items: string[]
  suffix: string
}

const topLevelListItemRe = /^(?: {0,3})(?:[-*+]|\d+\.)\s+(.+)$/

const parseTopLevelMarkdownList = (markdown: string): ParsedTopLevelList | null => {
  const lines = markdown.split('\n')
  const startIndex = lines.findIndex((line) => topLevelListItemRe.test(line))
  if (startIndex < 0) return null

  const prefix = lines.slice(0, startIndex).join('\n').trim()
  const items: string[] = []
  let currentItemLines: string[] = []
  let endIndex = lines.length

  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index]
    const markerMatch = line.match(topLevelListItemRe)
    if (markerMatch) {
      if (currentItemLines.length > 0) {
        items.push(currentItemLines.join('\n').trim())
      }
      currentItemLines = [markerMatch[1]]
      continue
    }

    if (currentItemLines.length === 0) {
      endIndex = index
      break
    }

    if (line.trim().length === 0) {
      currentItemLines.push('')
      continue
    }

    if (/^(?: {2,}|\t+)/.test(line)) {
      currentItemLines.push(line.trim())
      continue
    }

    endIndex = index
    break
  }

  if (currentItemLines.length > 0) {
    items.push(currentItemLines.join('\n').trim())
  }
  if (items.length === 0) return null

  const suffix = lines.slice(endIndex).join('\n').trim()
  return { prefix, items, suffix }
}

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
  const imageParts = payload.parts.filter((part): part is RichMessageImagePart => part.type === 'image')
  const orderedWebEvidenceImages = toOrderedWebEvidenceImages(imageParts)
  const textFallback = textParts.map((part) => part.text).join('\n\n')
  const hasText = textFallback.trim().length > 0
  const hasImages = imageParts.length > 0
  const shouldUseNewsListMode =
    hasText &&
    hasImages &&
    orderedWebEvidenceImages.length > 0 &&
    orderedWebEvidenceImages.length === imageParts.length
  const parsedTopLevelList = shouldUseNewsListMode ? parseTopLevelMarkdownList(textFallback) : null
  const useInlineNewsListMode = shouldUseNewsListMode && Boolean(parsedTopLevelList)
  const layout = normalizeLayout(payload)
  const sideBySide = !shouldUseNewsListMode && layout === 'side-by-side' && hasText && hasImages

  return (
    <div
      data-testid="rich-message-renderer"
      data-layout={layout}
      data-render-mode={shouldUseNewsListMode ? 'news-list' : 'default'}
      className={cn(
        'w-full',
        sideBySide && 'grid gap-4 lg:grid lg:grid-cols-12 lg:gap-5',
        className,
      )}
    >
      {useInlineNewsListMode && parsedTopLevelList ? (
        <div className="min-w-0 space-y-4">
          {parsedTopLevelList.prefix && (
            <MarkdownRenderer
              html={null}
              fallback={parsedTopLevelList.prefix}
              isStreaming={isStreaming}
              isRendering={isRendering}
            />
          )}
          {parsedTopLevelList.items.map((item, index) => {
            const matchedImage = orderedWebEvidenceImages[index]
            return (
              <section
                key={`news-item-${index + 1}`}
                className="space-y-3"
                data-testid={`news-item-${index + 1}`}
              >
                <div className="rounded-lg border border-border/60 bg-background px-3 py-2">
                  <MarkdownRenderer
                    html={null}
                    fallback={`${index + 1}. ${item}`}
                    isStreaming={isStreaming}
                    isRendering={isRendering}
                  />
                </div>
                {matchedImage && <EvidenceImageCard image={matchedImage} index={index} />}
              </section>
            )
          })}
          {orderedWebEvidenceImages.length > parsedTopLevelList.items.length && (
            <section className="space-y-2" data-testid="news-extra-sources">
              <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">更多来源</p>
              <div className={cn('grid gap-3', 'grid-cols-1 sm:grid-cols-2')}>
                {orderedWebEvidenceImages
                  .slice(parsedTopLevelList.items.length)
                  .map((image, index) => (
                    <EvidenceImageCard
                      key={`${image.url}-${index}`}
                      image={image}
                      index={parsedTopLevelList.items.length + index}
                    />
                  ))}
              </div>
            </section>
          )}
          {parsedTopLevelList.suffix && (
            <MarkdownRenderer
              html={null}
              fallback={parsedTopLevelList.suffix}
              isStreaming={isStreaming}
              isRendering={isRendering}
            />
          )}
        </div>
      ) : hasText && (
        <div className={cn('min-w-0', sideBySide && 'lg:col-span-7')}>
          <MarkdownRenderer
            html={hasImages ? null : textHtml ?? null}
            fallback={textFallback}
            isStreaming={isStreaming}
            isRendering={isRendering}
          />
        </div>
      )}

      {hasImages && !useInlineNewsListMode && (
        <div className={cn('min-w-0', sideBySide && 'lg:col-span-5')}>
          {shouldUseNewsListMode && (
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">来源</p>
          )}
          <div
            className={cn(
              'grid gap-3',
              shouldUseNewsListMode ? 'grid-cols-1 sm:grid-cols-2' : imageParts.length > 1 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1',
            )}
          >
            {(shouldUseNewsListMode ? orderedWebEvidenceImages : imageParts).map((image, index) => (
              <EvidenceImageCard key={`${image.url}-${index}`} image={image} index={index} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
