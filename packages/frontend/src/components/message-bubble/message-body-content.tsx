'use client'

import { useState, useMemo } from 'react'
import Image from 'next/image'
import { ChevronDown } from 'lucide-react'
import type { MessageMeta } from '@/types'
import { MarkdownRenderer } from '@/components/markdown-renderer'
import { cn } from '@/lib/utils'
import { ImageLightbox, useImageLightbox } from '@/components/ui/image-lightbox'

// 折叠阈值：超过此行数时自动折叠
const COLLAPSE_LINE_THRESHOLD = 8
// 折叠后显示的行数
const COLLAPSED_VISIBLE_LINES = 4

// 检测生成图片的 markdown 模式
// 格式：![Generated Image N](data:image/...;base64,...)
const GENERATED_IMAGE_PATTERN = /!\[Generated Image \d+\]\((data:image\/[^;]+;base64,[^)]+)\)/g

/**
 * 从 markdown 内容中提取生成的图片 URL
 * 用于高效显示大型 base64 图片，避免通过复杂的 markdown 渲染管道
 */
const extractGeneratedImages = (content: string): string[] => {
  if (!content || !content.includes('![Generated Image')) {
    return []
  }
  const matches = content.matchAll(GENERATED_IMAGE_PATTERN)
  return Array.from(matches).map((m) => m[1])
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
}: MessageBodyContentProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const lightbox = useImageLightbox()

  // 检测是否包含生成的图片（大型 base64 data URL）
  const generatedImages = useMemo(() => extractGeneratedImages(content), [content])
  const hasGeneratedImages = generatedImages.length > 0

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

  // 如果内容只包含生成的图片，直接渲染图片组件，避免通过 markdown 渲染管道
  // 这样可以高效处理大型 base64 图片（可能超过 2MB）
  if (hasGeneratedImages && !shouldShowStreamingPlaceholder) {
    return (
      <div className={bubbleClass}>
        <div className="flex flex-col gap-4">
          {generatedImages.map((url, idx) => (
            <div key={idx} className="relative">
              <img
                src={url}
                alt={`Generated Image ${idx + 1}`}
                className="max-w-full h-auto rounded-lg shadow-md cursor-pointer hover:opacity-95 transition-opacity"
                onClick={() => lightbox.openLightbox(generatedImages, idx)}
                loading="lazy"
                style={{ maxHeight: '70vh' }}
              />
            </div>
          ))}
          <ImageLightbox
            images={generatedImages}
            initialIndex={lightbox.initialIndex}
            open={lightbox.open}
            onOpenChange={lightbox.setOpen}
          />
        </div>
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
