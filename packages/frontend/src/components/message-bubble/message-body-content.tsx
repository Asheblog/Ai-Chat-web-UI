'use client'

import { useState, useMemo } from 'react'
import Image from 'next/image'
import { ChevronDown } from 'lucide-react'
import type { GeneratedImage, MessageMeta, RichMessageImagePart, RichMessagePayload, ToolEvent } from '@/types'
import { MarkdownRenderer } from '@/components/markdown-renderer'
import { cn } from '@/lib/utils'
import { ImageLightbox, useImageLightbox } from '@/components/ui/image-lightbox'
import { RichMessageRenderer } from '@/components/message-content/rich-message-renderer'

// 折叠阈值：超过此行数时自动折叠
const COLLAPSE_LINE_THRESHOLD = 8
// 折叠后显示的行数
const COLLAPSED_VISIBLE_LINES = 4

const resolveGeneratedImageUrl = (image: GeneratedImage): string | null => {
  if (typeof image?.url === 'string' && image.url.trim().length > 0) {
    return image.url.trim()
  }
  if (typeof image?.base64 === 'string' && image.base64.trim().length > 0) {
    const mime = image.mime || 'image/png'
    return `data:${mime};base64,${image.base64}`
  }
  return null
}

const extractExternalImagesFromToolEvents = (toolEvents: ToolEvent[] | undefined): RichMessageImagePart[] => {
  if (!Array.isArray(toolEvents) || toolEvents.length === 0) return []
  const images: RichMessageImagePart[] = []
  const seen = new Set<string>()

  for (const event of toolEvents) {
    const assessed = Array.isArray(event.details?.assessedImages) ? event.details.assessedImages : []
    for (const item of assessed) {
      const url = typeof item.url === 'string' ? item.url.trim() : ''
      if (!url || seen.has(url)) continue
      if (item.confidence === 'low') continue
      if (item.confidence !== 'high' && item.confidence !== 'medium') continue
      seen.add(url)
      images.push({
        type: 'image',
        source: 'external',
        sourceKind: event.tool === 'read_url' ? 'document' : 'web',
        url,
        sourceUrl: item.sourceUrl || event.details?.url || event.query,
        title: item.title || item.alt,
        alt: item.title || item.alt || item.description,
        confidence: item.confidence,
        meta: item.description ? { description: item.description } : undefined,
      })
    }
  }

  return images
}

const buildAssistantRichPayload = (
  meta: MessageMeta,
  content: string,
  toolEvents?: ToolEvent[],
): RichMessagePayload | null => {
  const payload = meta.richPayload
  const externalFromTools = extractExternalImagesFromToolEvents(toolEvents)
  if (payload && Array.isArray(payload.parts) && payload.parts.length > 0) {
    if (externalFromTools.length === 0) return payload
    const existingUrls = new Set(
      payload.parts
        .filter((part): part is RichMessageImagePart => part.type === 'image')
        .map((part) => part.url),
    )
    const missing = externalFromTools.filter((part) => !existingUrls.has(part.url))
    if (missing.length === 0) return payload
    const mergedParts = [...payload.parts, ...missing]
    const hasText = mergedParts.some((part) => part.type === 'text')
    const hasWeb = mergedParts.some(
      (part) => part.type === 'image' && part.source === 'external',
    )
    return {
      layout: hasText && hasWeb ? 'stack' : payload.layout,
      parts: mergedParts.map((part, index) =>
        part.type === 'image' ? { ...part, refId: part.refId ?? `img-${index + 1}` } : part,
      ),
    }
  }

  const generated = Array.isArray(meta.generatedImages) ? meta.generatedImages : []
  const text = typeof content === 'string' ? content : ''
  const hasText = text.trim().length > 0
  const imageParts: RichMessageImagePart[] = [
    ...generated
      .map((image, index) => {
        const url = resolveGeneratedImageUrl(image)
        if (!url) return null
        return {
          type: 'image' as const,
          url,
          source: 'generated' as const,
          sourceKind: 'generated' as const,
          title: image.revisedPrompt,
          width: image.width ?? null,
          height: image.height ?? null,
          alt: image.revisedPrompt || `AI 生成图片 ${index + 1}`,
          refId: `img-${index + 1}`,
        }
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item)),
    ...externalFromTools,
  ]

  if (imageParts.length === 0) return null

  const hasWebEvidence = imageParts.some((part) => part.source === 'external')

  return {
    layout: hasText ? (hasWebEvidence ? 'stack' : 'side-by-side') : 'stack',
    parts: [
      ...(hasText ? [{ type: 'text' as const, text, format: 'markdown' as const }] : []),
      ...imageParts.map((part, index) => ({ ...part, refId: part.refId ?? `img-${index + 1}` })),
    ],
  }
}

interface MessageBodyContentProps {
  isUser: boolean
  meta: MessageMeta
  bubbleClass: string
  contentHtml: string
  content: string
  shouldShowStreamingPlaceholder: boolean
  isStreaming: boolean
  isRendering: boolean
  toolEvents?: ToolEvent[]
}

export function MessageBodyContent({
  isUser,
  meta,
  bubbleClass,
  contentHtml,
  content,
  shouldShowStreamingPlaceholder,
  isStreaming,
  isRendering,
  toolEvents,
}: MessageBodyContentProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const lightbox = useImageLightbox()
  const assistantRichPayload = useMemo(
    () => (isUser ? null : buildAssistantRichPayload(meta, content, toolEvents)),
    [content, isUser, meta, toolEvents],
  )

  // 计算内容行数和是否需要折叠
  const { shouldCollapse, previewContent, lineCount } = useMemo(() => {
    if (!isUser) return { shouldCollapse: false, previewContent: '', lineCount: 0 }

    const lines = content.split('\n')
    const count = lines.length
    const needsCollapse = count > COLLAPSE_LINE_THRESHOLD
    const preview = needsCollapse
      ? lines.slice(0, COLLAPSED_VISIBLE_LINES).join('\n')
      : content

    return { shouldCollapse: needsCollapse, previewContent: preview, lineCount: count }
  }, [content, isUser])

  if (isUser) {
    const showCollapsed = shouldCollapse && !isExpanded
    const userImages = meta.images ?? []

    return (
      <div className={bubbleClass}>
        <div className="text-left">
          {userImages.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {userImages.map((src, i) => (
                <div
                  key={i}
                  role="button"
                  tabIndex={0}
                  onClick={() => lightbox.openLightbox(userImages, i)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      lightbox.openLightbox(userImages, i)
                    }
                  }}
                  className="cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded"
                >
                  <Image
                    src={src}
                    alt={`消息图片 ${i + 1}`}
                    width={160}
                    height={160}
                    unoptimized
                    className="max-h-40 rounded border object-contain hover:opacity-90 transition-opacity block"
                  />
                </div>
              ))}
            </div>
          )}
          <ImageLightbox
            images={userImages}
            initialIndex={lightbox.initialIndex}
            open={lightbox.open}
            onOpenChange={lightbox.setOpen}
          />
          <div className="relative">
            <p className={cn(
              "whitespace-pre-wrap break-words text-left leading-[1.5] sm:leading-[1.6]",
              showCollapsed && "line-clamp-4"
            )}>
              {showCollapsed ? previewContent : content}
            </p>
          </div>
          {shouldCollapse && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className={cn(
                "mt-2 flex items-center justify-center gap-1.5 w-full py-2 rounded-md",
                "text-sm font-medium",
                "bg-foreground/5 hover:bg-foreground/10 text-foreground",
                "border border-foreground/20 shadow-sm",
                "transition-colors duration-200",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30"
              )}
            >
              <ChevronDown
                className={cn(
                  "h-4 w-4 transition-transform duration-200",
                  isExpanded && "rotate-180"
                )}
              />
              <span>
                {isExpanded ? '收起内容' : `展开查看全部 (${lineCount} 行)`}
              </span>
            </button>
          )}
        </div>
      </div>
    )
  }

  if (assistantRichPayload) {
    return (
      <div className={bubbleClass}>
        <RichMessageRenderer
          payload={assistantRichPayload}
          textHtml={contentHtml}
          isStreaming={isStreaming}
          isRendering={isRendering}
        />
      </div>
    )
  }

  return (
    <div className={bubbleClass}>
      {shouldShowStreamingPlaceholder ? (
        <div className="flex items-center gap-1">
          <div className="flex space-x-1">
            <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
          <span className="text-sm text-muted-foreground ml-2">AI正在思考...</span>
        </div>
      ) : (
        <MarkdownRenderer html={contentHtml} fallback={content} isStreaming={isStreaming} isRendering={isRendering} />
      )}
    </div>
  )
}
