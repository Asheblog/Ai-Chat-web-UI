'use client'

import { useId, useMemo } from 'react'
import { buildInterleavedCotNodes } from '@aichat/shared/cot-timeline'
import { buildCotTimelineSummary } from '@aichat/shared/cot-timeline-view'
import type { MessageMeta, ToolEvent } from '@/types'
import { formatDurationSeconds } from './message-metrics'
import { CotTimelineHeader, CotTimelineSummaryBar } from './cot-timeline-summary-bar'
import { CotTimelineOutline } from './cot-timeline-outline'
import { CotTimelineNodes } from './cot-timeline-nodes'
import { useCotTimelineLevel } from './use-cot-timeline-level'

export interface CotTimelineProps {
  meta: MessageMeta
  reasoningRaw: string
  toolEvents: ToolEvent[]
  /** 完成态下直接进入「全部展开」层（Battle 详情传 true） */
  defaultExpanded?: boolean
  /** 流式中：末段推理卡片展开后使用打字机播放 */
  isStreaming?: boolean
  reasoningPlayedLength?: number
}

const resolveBaseKey = (meta: Pick<MessageMeta, 'stableKey' | 'id' | 'clientMessageId'>) => {
  if (meta.stableKey) return meta.stableKey
  if (meta.id != null) return String(meta.id)
  if (meta.clientMessageId) return meta.clientMessageId
  return ''
}

/**
 * 统一 CoT 时间轴：主聊天 / 分享 / Battle 共用。
 *
 * 三段折叠：
 * - collapsed：整条压成一行摘要（完成态默认），正文不再被 100+ 步顶走；
 * - outline：每步一行的提纲，限高滚动，单步仍可就地展开；
 * - expanded：每步细节全开，即原来的「全部展开」。
 * 级别偏好由 useCotTimelineLevel 持久化，用户手选优先于流式自动切换。
 */
export function CotTimeline({
  meta,
  reasoningRaw,
  toolEvents,
  defaultExpanded = false,
  isStreaming = false,
  reasoningPlayedLength,
}: CotTimelineProps) {
  const nodes = useMemo(
    () => buildInterleavedCotNodes(reasoningRaw, toolEvents),
    [reasoningRaw, toolEvents],
  )
  const summary = useMemo(() => buildCotTimelineSummary(nodes), [nodes])
  const baseKey = resolveBaseKey(meta)
  const bodyId = useId()
  const { level, setLevel } = useCotTimelineLevel({
    itemKey: baseKey,
    isStreaming,
    defaultLevel: defaultExpanded ? 'expanded' : null,
  })

  const durationText = formatDurationSeconds(meta.reasoningDurationSeconds)
  const hasMeaningfulDuration =
    durationText !== null && (meta.reasoningDurationSeconds ?? 0) > 0
  const effectiveDurationText = hasMeaningfulDuration ? durationText : null

  if (nodes.length === 0) return null

  const handleInteract = () => {
    // 在「全部展开」层点单张卡 = 退出统一态，交回提纲层与该卡自己的记忆
    if (level === 'expanded') setLevel('outline')
  }

  const nodesProps = {
    nodes,
    baseKey,
    isStreaming,
    isReasoningStreaming: meta.reasoningStatus === 'streaming',
    reasoningPlayedLength,
    defaultExpanded,
    durationText: effectiveDurationText,
    onInteract: handleInteract,
  }

  return (
    <div className="mb-3">
      {level === 'collapsed' ? (
        <CotTimelineSummaryBar
          summary={summary}
          durationText={effectiveDurationText}
          isStreaming={isStreaming}
          bodyId={bodyId}
          onExpand={() => setLevel('outline')}
        />
      ) : (
        <>
          <CotTimelineHeader
            level={level}
            stepCount={nodes.length}
            bodyId={bodyId}
            onExpandAll={() => setLevel('expanded')}
            onCollapseAll={() => setLevel('outline')}
            onCollapse={() => setLevel('collapsed')}
          />
          <div id={bodyId} data-testid="cot-timeline-body" data-level={level}>
            {level === 'outline' ? (
              <CotTimelineOutline stickToBottomKey={isStreaming ? nodes.length : null}>
                <CotTimelineNodes {...nodesProps} overrideExpanded={null} compact />
              </CotTimelineOutline>
            ) : (
              <div className="relative pl-6">
                <div
                  aria-hidden
                  className="absolute bottom-2 left-[9px] top-2 w-px bg-border/70"
                />
                <div className="space-y-2">
                  <CotTimelineNodes {...nodesProps} overrideExpanded />
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
