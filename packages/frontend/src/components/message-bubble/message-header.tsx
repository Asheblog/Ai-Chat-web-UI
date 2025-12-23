'use client'

import { ChevronLeft, ChevronRight, Copy, Pencil, RefreshCw, Share2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface MessageHeaderProps {
  isUser: boolean
  timestamp: string
  isCopied: boolean
  onCopy: () => void
  onEdit?: () => void
  shareEntryAvailable: boolean
  onShareStart?: () => void
  showVariantControls: boolean
  showVariantNavigation: boolean
  variantInfo?: {
    total: number
    index: number
    onPrev: () => void
    onNext: () => void
    onRegenerate: () => void
  }
  isStreaming: boolean
  metrics?: {
    latencyText?: number | null
    speedText?: string | null
  } | null
}

export function MessageHeader({
  isUser,
  timestamp,
  isCopied,
  onCopy,
  onEdit,
  shareEntryAvailable,
  onShareStart,
  showVariantControls,
  showVariantNavigation,
  variantInfo,
  isStreaming,
  metrics,
}: MessageHeaderProps) {
  if (isUser) {
    return (
      <div className="flex items-center justify-end gap-1 mt-2 text-xs text-muted-foreground">
        {onEdit && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onEdit}
            title="编辑并重新发送"
          >
            <Pencil className="h-3 w-3" />
          </Button>
        )}
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onCopy} title="复制消息">
          {isCopied ? <div className="h-3 w-3 bg-green-500 rounded" /> : <Copy className="h-3 w-3" />}
        </Button>
        {shareEntryAvailable && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            title="进入分享选择模式"
            onClick={() => onShareStart?.()}
          >
            <Share2 className="h-3 w-3" />
          </Button>
        )}
        <span>{timestamp}</span>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-1 mt-2 text-xs text-muted-foreground">
      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onCopy} title="复制消息">
        {isCopied ? <div className="h-3 w-3 bg-green-500 rounded" /> : <Copy className="h-3 w-3" />}
      </Button>
      {shareEntryAvailable && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          title="进入分享选择模式"
          onClick={() => onShareStart?.()}
        >
          <Share2 className="h-3 w-3" />
        </Button>
      )}
      {showVariantControls && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          title="重新生成回答"
          onClick={() => variantInfo?.onRegenerate()}
          disabled={Boolean(isStreaming)}
        >
          <RefreshCw className="h-3 w-3" />
        </Button>
      )}
      {showVariantNavigation && (
        <div className="flex items-center gap-1 ml-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => variantInfo?.onPrev()}
            title="查看更早的回答"
            disabled={Boolean(isStreaming)}
          >
            <ChevronLeft className="h-3 w-3" />
          </Button>
          <span className="w-12 text-center">
            {(variantInfo?.index ?? 0) + 1}/{variantInfo?.total ?? 1}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => variantInfo?.onNext()}
            title="查看最新回答"
            disabled={Boolean(isStreaming)}
          >
            <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
      )}
      <div className="ml-auto flex items-center gap-2">
        {metrics && (metrics.latencyText != null || metrics.speedText != null) && (
          <div className="inline-flex items-center gap-2 rounded-full bg-muted/70 px-2.5 py-1 text-[11px]">
            {metrics.latencyText != null && <span>首字时延 {metrics.latencyText} ms</span>}
            {metrics.latencyText != null && metrics.speedText != null && <span className="opacity-60">|</span>}
            {metrics.speedText != null && <span>每秒 {metrics.speedText} tokens</span>}
          </div>
        )}
        <span>{timestamp}</span>
      </div>
    </div>
  )
}
