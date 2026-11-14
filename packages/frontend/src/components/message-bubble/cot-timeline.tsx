'use client'

import { useId, useMemo, useState } from 'react'
import { buildInterleavedCotNodes, buildToolStepTitle } from '@aichat/shared/cot-timeline'
import { buildCotTimelineSummary } from '@aichat/shared/cot-timeline-view'
import { resolveEventStatus } from '@aichat/shared/tool-events'
import type { MessageMeta, ToolEvent } from '@/types'
import { CotTimelineHeader, CotTimelineSummaryBar } from './cot-timeline-summary-bar'
import { CotTimelineOutline } from './cot-timeline-outline'
import { CotTimelineNodes } from './cot-timeline-nodes'
import { useCotTimelineDisclosure, useCotTimelineLevel } from './use-cot-timeline-level'
import { isFailedCotToolEvent } from './cot-timeline-failure'

export interface CotTimelineProps {
  meta: MessageMeta
  reasoningRaw: string
  toolEvents: ToolEvent[]
  /** 调用方显式展开详情（Battle 详情保留原行为）。 */
  defaultExpanded?: boolean
  isStreaming?: boolean
  reasoningPlayedLength?: number
}

const INITIAL_STEP_COUNT = 7
const resolveBaseKey = (meta: Pick<MessageMeta, 'stableKey' | 'id' | 'clientMessageId'>) =>
  meta.stableKey || (meta.id != null ? String(meta.id) : meta.clientMessageId) || ''

const formatProcessDuration = (seconds: number | null | undefined) => {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null
  const total = Math.floor(seconds)
  const minutes = Math.floor(total / 60)
  return minutes > 0 ? minutes + ' 分 ' + total % 60 + ' 秒' : total + ' 秒'
}

/** 已完成时一行摘要，查看后首屏七步；数据和交错顺序完全沿用 shared。 */
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
  const { visibleCount, setVisibleCount } = useCotTimelineDisclosure(baseKey, INITIAL_STEP_COUNT)
  const [navigation, setNavigation] = useState<{ key: string; version: number; index: number; failure: boolean } | null>(null)
  const firstFailedIndex = nodes.findIndex(node => {
    const events = node.type === 'tool' ? [node.event] : node.type === 'toolGroup' ? node.events : []
    return events.some(isFailedCotToolEvent)
  })
  const showAll = defaultExpanded || level === 'expanded'
  const visibleNodes = showAll ? nodes : nodes.slice(0, visibleCount)
  const remainingCount = nodes.length - visibleNodes.length
  const activeReasoningCharStart = useMemo(() => {
    if (!isStreaming || meta.reasoningStatus !== 'streaming') return null
    for (let i = nodes.length - 1; i >= 0; i -= 1) {
      const node = nodes[i]
      if (node.type === 'reasoning') return node.charStart
    }
    return null
  }, [isStreaming, meta.reasoningStatus, nodes])
  const durationText = formatProcessDuration(meta.reasoningDurationSeconds)
  const activityText = useMemo(() => {
    if (!isStreaming) return null
    const events = nodes.flatMap(node =>
      node.type === 'tool' ? [node.event] : node.type === 'toolGroup' ? node.events : [],
    )
    const active = events.slice().reverse().find(event =>
      ['running', 'pending'].includes(resolveEventStatus(event)),
    )
    if (active) {
      const prefix = resolveEventStatus(active) === 'pending' ? '等待确认 · ' : '正在执行 · '
      return prefix + buildToolStepTitle(active)
    }
    return meta.reasoningStatus === 'streaming' ? '正在思考' : '正在整理回答'
  }, [isStreaming, meta.reasoningStatus, nodes])

  if (nodes.length === 0) return null

  const openProcess = () => {
    if (firstFailedIndex >= 0) {
      setVisibleCount(Math.max(visibleCount, firstFailedIndex + 1))
      setNavigation(previous => ({ key: baseKey, version: (previous?.version ?? 0) + 1, index: firstFailedIndex, failure: true }))
    }
    setLevel('outline')
  }
  const revealRemaining = () => {
    setNavigation(previous => ({ key: baseKey, version: (previous?.version ?? 0) + 1, index: visibleNodes.length, failure: false }))
    setVisibleCount(nodes.length)
    setLevel('outline')
  }

  return (
    <div className="mb-3 min-w-0">
      {level === 'collapsed' ? (
        <CotTimelineSummaryBar
          summary={summary}
          durationText={durationText}
          isStreaming={isStreaming}
          activityText={activityText}
          bodyId={bodyId}
          onExpand={openProcess}
        />
      ) : (
        <div className="min-w-0 rounded-xl border border-border bg-background">
          <CotTimelineHeader
            stepCount={nodes.length}
            durationText={durationText}
            activityText={activityText}
            isStreaming={isStreaming}
            failedCount={summary.failedCount}
            bodyId={bodyId}
            onCollapse={() => setLevel('collapsed')}
          />
          <div id={bodyId} data-testid="cot-timeline-body" data-level={level}>
            <CotTimelineOutline>
              <CotTimelineNodes
                nodes={visibleNodes}
                baseKey={baseKey}
                isStreaming={isStreaming}
                activeReasoningCharStart={activeReasoningCharStart}
                reasoningPlayedLength={reasoningPlayedLength}
                defaultExpanded={defaultExpanded}
                overrideExpanded={level === 'expanded' ? true : null}
                compact
                failedNodeIndex={firstFailedIndex}
                failureRequest={navigation?.key === baseKey && navigation.failure ? navigation.version : undefined}
                focusRequest={navigation?.key === baseKey ? navigation : undefined}
                onInteract={() => setLevel('outline')}
              />
              {remainingCount > 0 && (
                <div className="mt-2 border-t border-border pt-3 pb-1">
                  <button
                    type="button"
                    className="min-h-11 w-full cursor-pointer rounded-lg bg-surface px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={revealRemaining}
                  >
                    查看其余 {remainingCount} 步
                  </button>
                </div>
              )}
            </CotTimelineOutline>
          </div>
        </div>
      )}
    </div>
  )
}
