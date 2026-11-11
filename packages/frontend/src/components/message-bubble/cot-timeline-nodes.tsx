'use client'

import { useMemo } from 'react'
import {
  cotTimelineNodeKey,
  resolveSegmentPlayedLength,
  type CotTimelineNode,
} from '@aichat/shared/cot-timeline'
import { resolveEventStatus } from '@aichat/shared/tool-events'
import { ResearchPlanCard } from './research-plan-card'
import { CotReasoningCard, CotToolCard, CotToolGroupCard } from './cot-timeline-cards'

const resolveDotClass = (node: CotTimelineNode) => {
  if (node.type === 'reasoning') return 'bg-amber-400'
  const status = node.type === 'toolGroup' ? node.status : resolveEventStatus(node.event)
  if (status === 'running' || status === 'pending') return 'bg-blue-400 animate-pulse'
  if (status === 'error' || status === 'rejected' || status === 'aborted') return 'bg-rose-400'
  return 'bg-emerald-400'
}

export interface CotTimelineNodesProps {
  nodes: CotTimelineNode[]
  baseKey: string
  /** 消息仍在流式输出（工具/推理可能继续追加） */
  isStreaming: boolean
  /** reasoningStatus === 'streaming'：只有此时末段推理才算「未结束」 */
  isReasoningStreaming: boolean
  reasoningPlayedLength?: number
  /** 完成态下推理卡是否默认展开（Battle 详情传 true） */
  defaultExpanded?: boolean
  /** 只给第一段推理卡展示的时长文案 */
  durationText?: string | null
  /** 统一覆盖：true=全部展开，false=全部折叠，null=各卡自管 */
  overrideExpanded?: boolean | null
  /** 提纲层紧凑行 */
  compact?: boolean
  onInteract?: () => void
}

/**
 * 时间轴的节点列表：推理 / 工具 / 工具组 / 研究计划卡平铺成兄弟节点。
 * 折叠级别由外层决定 —— 传 overrideExpanded 即「全部展开 / 全部折叠」，
 * 传 null 则每张卡各自维护展开态（提纲层的单步下钻就靠这个）。
 */
export function CotTimelineNodes({
  nodes,
  baseKey,
  isStreaming,
  isReasoningStreaming,
  reasoningPlayedLength,
  defaultExpanded = false,
  durationText = null,
  overrideExpanded = null,
  compact = false,
  onInteract,
}: CotTimelineNodesProps) {
  const lastReasoningIndex = useMemo(() => {
    for (let i = nodes.length - 1; i >= 0; i -= 1) {
      if (nodes[i].type === 'reasoning') return i
    }
    return -1
  }, [nodes])

  const firstReasoningIndex = useMemo(() => {
    for (let i = 0; i < nodes.length; i += 1) {
      if (nodes[i].type === 'reasoning') return i
    }
    return -1
  }, [nodes])

  // 只有 reasoningStatus 仍为 streaming 时，末段推理才算「未结束」，
  // 才会启用单行滚动 / 打字机；已经 done 的推理段即使消息仍在跑工具也保持静态。
  const activeReasoningIndex = isReasoningStreaming ? lastReasoningIndex : -1

  return (
    <>
      {nodes.map((node, index) => {
        const reactKey = cotTimelineNodeKey(node, index)
        const dotClass = resolveDotClass(node)
        if (node.type === 'reasoning') {
          return (
            <CotReasoningCard
              key={reactKey}
              baseKey={baseKey}
              text={node.text}
              charStart={node.charStart}
              defaultExpanded={defaultExpanded}
              isStreamingTail={Boolean(isStreaming) && index === activeReasoningIndex}
              playedLength={resolveSegmentPlayedLength(
                reasoningPlayedLength,
                node.charStart,
                node.text.length,
              )}
              durationText={index === firstReasoningIndex ? durationText : null}
              dotClass={dotClass}
              overrideExpanded={overrideExpanded}
              compact={compact}
              onInteract={onInteract}
            />
          )
        }
        if (node.type === 'toolGroup') {
          return (
            <CotToolGroupCard
              key={reactKey}
              baseKey={baseKey}
              node={node}
              dotClass={dotClass}
              overrideExpanded={overrideExpanded}
              compact={compact}
              onInteract={onInteract}
            />
          )
        }
        const toolId = node.event.identifier || node.event.apiName || node.event.tool
        if (toolId === 'research_plan') {
          return (
            <div key={reactKey} className="relative">
              <span
                aria-hidden
                className={`absolute -left-[19px] top-4 h-2 w-2 rounded-full border-2 border-background ${dotClass}`}
              />
              <ResearchPlanCard event={node.event} isStreaming={isStreaming} />
            </div>
          )
        }
        return (
          <CotToolCard
            key={reactKey}
            baseKey={baseKey}
            event={node.event}
            dotClass={dotClass}
            overrideExpanded={overrideExpanded}
            compact={compact}
            onInteract={onInteract}
          />
        )
      })}
    </>
  )
}
