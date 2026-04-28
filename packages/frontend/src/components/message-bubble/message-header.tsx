'use client'

import { CheckCircle2, ChevronLeft, ChevronRight, Clock3, Copy, Loader2, Pencil, RefreshCw, Share2, ThumbsDown, ThumbsUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatDurationMs } from './message-metrics'

interface MessageHeaderProps {
  isUser: boolean
  mode?: 'full' | 'status' | 'actions'
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
    durationMs?: number | null
    speedText?: string | null
  } | null
}

export function MessageHeader({
  isUser,
  mode = 'full',
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

  const actions = (
    <>
      <Button variant="ghost" size="icon" className="h-7 w-7 rounded-[8px]" onClick={onCopy} title="复制消息">
        {isCopied ? <div className="h-3 w-3 bg-green-500 rounded" /> : <Copy className="h-3 w-3" />}
      </Button>
      {shareEntryAvailable && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-[8px]"
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
          className="h-7 w-7 rounded-[8px]"
          title="重新生成回答"
          onClick={() => variantInfo?.onRegenerate()}
          disabled={Boolean(isStreaming)}
        >
          <RefreshCw className="h-3 w-3" />
        </Button>
      )}
      {showVariantNavigation && (
        <div className="ml-1 flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-[8px]"
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
            className="h-7 w-7 rounded-[8px]"
            onClick={() => variantInfo?.onNext()}
            title="查看最新回答"
            disabled={Boolean(isStreaming)}
          >
            <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
      )}
      <Button variant="ghost" size="icon" className="h-7 w-7 rounded-[8px]" title="有帮助">
        <ThumbsUp className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7 rounded-[8px]" title="无帮助">
        <ThumbsDown className="h-3.5 w-3.5" />
      </Button>
    </>
  )

  if (mode === 'actions') {
    return (
      <div className="mt-2 flex flex-wrap items-center justify-end gap-1 text-xs text-muted-foreground">
        {actions}
        <span className="pl-1">{timestamp}</span>
      </div>
    )
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-border pb-2 text-xs text-muted-foreground">
      {isStreaming ? (
        <span className="inline-flex items-center gap-1.5 text-blue-600">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          进行中
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-emerald-600">
          <CheckCircle2 className="h-3.5 w-3.5" />
          已完成
        </span>
      )}
      <span className="h-3 w-px bg-border" />
      <span className="inline-flex items-center gap-1.5">
        <Clock3 className="h-3.5 w-3.5" />
        {formatDurationMs(metrics?.durationMs) ?? timestamp}
      </span>
      {metrics?.speedText != null && (
        <>
          <span className="h-3 w-px bg-border" />
          <span>{metrics.speedText} tokens/s</span>
        </>
      )}
      {mode === 'full' && <div className="ml-auto flex items-center gap-1">{actions}</div>}
    </div>
  )
}
