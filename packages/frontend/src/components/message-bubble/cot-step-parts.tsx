'use client'

import { useState } from 'react'
import { BookOpen, ChevronDown, Clock3, Code2, FileText, Globe, Lightbulb, Search, Wrench } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { TypewriterReasoning } from '@/components/typewriter-reasoning'
import { FadeScrollContainer } from './fade-scroll-container'
import { SingleLineScroller } from './single-line-scroller'
import type { CotTimelineNode, ToolDisplayIconKey } from '@aichat/shared/cot-timeline'
import { buildToolStepTitle, resolveToolDisplay } from '@aichat/shared/cot-timeline'
import { resolveEventStatus } from '@aichat/shared/tool-events'
import type { ToolEvent } from '@/types'
import { cn } from '@/lib/utils'

const ICON_MAP: Record<ToolDisplayIconKey, LucideIcon> = {
  lightbulb: Lightbulb,
  search: Search,
  globe: Globe,
  clock: Clock3,
  file: FileText,
  code: Code2,
  book: BookOpen,
  wrench: Wrench,
}

const stringifyPayload = (value: unknown): string | null => {
  if (value == null) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function CotReasoningStep({
  text,
  isStreamingTail,
  playedLength = 0,
}: {
  text: string
  isStreamingTail?: boolean
  /** 相对本推理段文本的已播放长度 */
  playedLength?: number
}) {
  return (
    <div className="rounded-lg bg-background/60 px-3 py-2.5">
      <div className="mb-1.5 flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
        <span>深度思考</span>
      </div>
      <div className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
        {isStreamingTail ? (
          <TypewriterReasoning
            text={text}
            isStreaming
            speed={20}
            initialPlayedLength={playedLength}
          />
        ) : (
          text
        )}
      </div>
    </div>
  )
}

function ToolResultBody({ event }: { event: ToolEvent }) {
  const payload =
    stringifyPayload(event.resultJson) ||
    stringifyPayload(event.resultText) ||
    stringifyPayload(event.argumentsText) ||
    stringifyPayload(event.error) ||
    stringifyPayload(event.summary)
  if (!payload) {
    return <p className="text-xs text-muted-foreground">暂无结果详情</p>
  }
  return (
    <FadeScrollContainer
      className="overflow-hidden rounded-md bg-background/80"
      viewportClassName="overflow-auto"
      maxHeightClassName="max-h-64"
    >
      <pre className="p-2 text-micro leading-4 text-foreground/80">{payload}</pre>
    </FadeScrollContainer>
  )
}

export function CotToolStep({
  event,
  open: controlledOpen,
  onOpenChange,
}: {
  event: ToolEvent
  /** 受控展开态：由外层时间轴/持久化 hook 接管 */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = (next: boolean) => {
    if (onOpenChange) onOpenChange(next)
    else setInternalOpen(next)
  }
  const toolId = event.identifier || event.apiName || event.tool
  const display = resolveToolDisplay(toolId)
  const Icon = ICON_MAP[display.iconKey] || Wrench
  const title = buildToolStepTitle(event)
  const status = resolveEventStatus(event)
  const statusLabel =
    status === 'running'
      ? '执行中'
      : status === 'pending'
        ? '待审批'
        : status === 'error'
          ? '失败'
          : status === 'rejected'
            ? '已拒绝'
            : status === 'aborted'
              ? '已中止'
              : '完成'
  const statusBadgeClass = cn(
    'shrink-0 rounded-full px-1.5 py-0.5 text-micro font-medium',
    status === 'success' && 'bg-emerald-500/10 text-emerald-700',
    status === 'running' && 'bg-blue-500/10 text-blue-700',
    status === 'error' && 'bg-rose-500/10 text-rose-700',
    status === 'pending' && 'bg-amber-500/10 text-amber-700',
  )
  const previewDetail = [event.summary, event.resultText, event.error].find(
    (value) => typeof value === 'string' && value.trim().length > 0,
  )
  const statusFallback =
    status === 'running'
      ? '工具执行中'
      : status === 'pending'
        ? '等待工具审批后执行'
        : status === 'error'
          ? '工具执行失败'
          : ''
  const collapsedText = [title, previewDetail || statusFallback].filter(Boolean).join(' · ')

  return (
    <div className="rounded-lg border border-border/60 bg-background/50 px-3 py-2">
      <button
        type="button"
        className="flex w-full cursor-pointer items-start justify-between gap-2 text-left"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {open ? (
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{title}</span>
              <span className={statusBadgeClass}>{statusLabel}</span>
            </div>
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium text-foreground">
            <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className={statusBadgeClass}>{statusLabel}</span>
            <SingleLineScroller
              text={collapsedText}
              className="min-w-0 flex-1 text-xs font-normal text-muted-foreground"
              active={status === 'running' || status === 'pending'}
            />
          </div>
        )}
        <ChevronDown className={cn('mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="mt-2 space-y-2 border-t border-border/60 pt-2 sm:pl-6">
          <ToolResultBody event={event} />
        </div>
      )}
    </div>
  )
}

export function CotToolGroupStep({
  node,
  open: controlledOpen,
  onOpenChange,
}: {
  node: Extract<CotTimelineNode, { type: 'toolGroup' }>
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = (next: boolean) => {
    if (onOpenChange) onOpenChange(next)
    else setInternalOpen(next)
  }
  const display = resolveToolDisplay(node.toolType)
  const Icon = ICON_MAP[display.iconKey] || Wrench

  return (
    <div className="rounded-lg border border-border/60 bg-background/50 px-3 py-2">
      <button
        type="button"
        className="flex w-full cursor-pointer items-start justify-between gap-2 text-left"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {open ? (
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span>{display.label}</span>
              <span className="text-xs font-normal text-muted-foreground">{node.events.length} 个调用</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground sm:pl-6">{node.summaryText}</p>
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium text-foreground">
            <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="shrink-0">{display.label}</span>
            <span className="shrink-0 text-xs font-normal text-muted-foreground">
              {node.events.length} 个调用
            </span>
            <SingleLineScroller
              text={node.summaryText}
              className="min-w-0 flex-1 text-xs font-normal text-muted-foreground"
              active={node.status === 'running'}
            />
          </div>
        )}
        <ChevronDown className={cn('mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="mt-2 space-y-2 border-t border-border/60 pt-2">
          {node.events.map((event) => (
            <CotToolStep
              key={`${event.callId ?? event.id}-${event.updatedAt ?? event.createdAt}`}
              event={event}
            />
          ))}
        </div>
      )}
    </div>
  )
}
