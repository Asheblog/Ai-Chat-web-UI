'use client'

import { useState, useMemo } from 'react'
import Image from 'next/image'
import { ChevronDown } from 'lucide-react'
import type { MessageMeta } from '@/types'
import { MarkdownRenderer } from '@/components/markdown-renderer'
import { cn } from '@/lib/utils'

// 折叠阈值：超过此行数时自动折叠
const COLLAPSE_LINE_THRESHOLD = 8
// 折叠后显示的行数
const COLLAPSED_VISIBLE_LINES = 4

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

    return (
      <div className={bubbleClass}>
        <div className="text-left">
          {meta.images && meta.images.length > 0 && (
            <div className="mb-2 grid grid-cols-2 gap-2">
              {meta.images.map((src, i) => (
                <Image
                  key={i}
                  src={src}
                  alt={`消息图片 ${i + 1}`}
                  width={160}
                  height={160}
                  unoptimized
                  className="max-h-40 rounded border object-contain"
                />
              ))}
            </div>
          )}
          <div className="relative">
            <p className={cn(
              "whitespace-pre-wrap break-words text-left leading-[1.5] sm:leading-[1.6]",
              showCollapsed && "line-clamp-4"
            )}>
              {showCollapsed ? previewContent : content}
            </p>
            {showCollapsed && (
              <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-primary/20 to-transparent pointer-events-none" />
            )}
          </div>
          {shouldCollapse && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className={cn(
                "mt-2 flex items-center gap-1 text-xs text-primary-foreground/70 hover:text-primary-foreground transition-colors",
                "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded px-1 py-0.5"
              )}
            >
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 transition-transform duration-200",
                  isExpanded && "rotate-180"
                )}
              />
              <span>
                {isExpanded ? '收起' : `展开全部 (${lineCount} 行)`}
              </span>
            </button>
          )}
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
