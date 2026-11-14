'use client'

import { useId, useMemo } from 'react'
import { ChevronDown, Lightbulb } from 'lucide-react'
import { buildInterleavedCotNodes } from '@aichat/shared/cot-timeline'
import type { ToolEvent } from '@/types'
import { REASONING_VISIBILITY_STORAGE_KEY, reasoningItemKey } from '../model/disclosure'
import { useProcessVisibility } from '../hooks/use-process-disclosure'
import { ProcessEmptyState } from './notices'

interface ProcessReasoningSectionProps {
  scopeKey: string
  reasoningRaw: string
  toolEvents: ToolEvent[]
  expandAll?: boolean
}

/**
 * 推理摘要与工具记录分层：这里只放模型真实返回的推理切片（沿用 shared 的
 * reasoningOffset 切片与工具进度清洗），不把工具事件混进来，也不补造推理。
 */
export function ProcessReasoningSection({
  scopeKey,
  reasoningRaw,
  toolEvents,
  expandAll = false,
}: ProcessReasoningSectionProps) {
  const segments = useMemo(
    () =>
      buildInterleavedCotNodes(reasoningRaw, toolEvents).filter(
        (node): node is Extract<ReturnType<typeof buildInterleavedCotNodes>[number], { type: 'reasoning' }> =>
          node.type === 'reasoning',
      ),
    [reasoningRaw, toolEvents],
  )

  if (segments.length === 0) {
    return (
      <ProcessEmptyState
        title="没有可展示的推理内容"
        hint="只有模型实际返回的推理才会显示；未返回推理时这里保持为空。"
      />
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      {segments.map((segment) => (
        <ReasoningCard
          key={`r:${segment.charStart}`}
          scopeKey={scopeKey}
          charStart={segment.charStart}
          text={segment.text}
          expandAll={expandAll}
        />
      ))}
    </div>
  )
}

function ReasoningCard({
  scopeKey,
  charStart,
  text,
  expandAll,
}: {
  scopeKey: string
  charStart: number
  text: string
  expandAll: boolean
}) {
  const bodyId = useId()
  const itemKey = reasoningItemKey(scopeKey, charStart)
  const { expanded, toggle } = useProcessVisibility({
    itemKey,
    storageKey: REASONING_VISIBILITY_STORAGE_KEY,
    defaultExpanded: expandAll,
  })

  return (
    <div className="v2-panel-soft">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        aria-controls={bodyId}
        className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <Lightbulb aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 text-sm font-medium">深度思考</span>
        <span className="num-tabular shrink-0 text-micro text-muted-foreground">{text.length} 字</span>
        <ChevronDown
          aria-hidden
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      {expanded && (
        <div
          id={bodyId}
          className="border-t border-border px-2.5 py-2 text-sm leading-6 text-muted-foreground whitespace-pre-wrap [overflow-wrap:anywhere]"
        >
          {text}
        </div>
      )}
    </div>
  )
}
