'use client'

import Image from 'next/image'
import type { MessageMeta } from '@/types'
import { MarkdownRenderer } from '@/components/markdown-renderer'

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
  if (isUser) {
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
          <p className="whitespace-pre-wrap break-words text-left leading-[1.5] sm:leading-[1.6]">
            {content}
          </p>
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
