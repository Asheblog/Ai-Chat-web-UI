'use client'

import { useEffect, useRef } from 'react'
import {
  cotTimelineNodeKey,
  resolveSegmentPlayedLength,
  type CotTimelineNode,
} from '@aichat/shared/cot-timeline'
import { ResearchPlanCard } from './research-plan-card'
import { CotReasoningCard, CotToolCard, CotToolGroupCard } from './cot-timeline-cards'

export interface CotTimelineNodesProps {
  nodes: CotTimelineNode[]
  baseKey: string
  isStreaming: boolean
  activeReasoningCharStart: number | null
  reasoningPlayedLength?: number
  defaultExpanded?: boolean
  overrideExpanded?: boolean | null
  compact?: boolean
  failedNodeIndex?: number
  failureRequest?: number
  focusRequest?: { index: number; version: number }
  onInteract?: () => void
}

/** 只渲染当前已展示的节点，交错顺序、分组和稳定 key 由 shared 维护。 */
export function CotTimelineNodes({
  nodes,
  baseKey,
  isStreaming,
  activeReasoningCharStart,
  reasoningPlayedLength,
  defaultExpanded = false,
  overrideExpanded = null,
  compact = false,
  failedNodeIndex = -1,
  failureRequest,
  focusRequest,
  onInteract,
}: CotTimelineNodesProps) {
  const listRef = useRef<HTMLOListElement>(null)
  useEffect(() => {
    if (focusRequest) {
      const target = listRef.current?.children[focusRequest.index] as HTMLElement | undefined
      target?.focus()
    }
  }, [focusRequest])
  return (
    <ol ref={listRef} aria-label="过程步骤" className="m-0 list-none p-0">
      {nodes.map((node, index) => {
        const reactKey = cotTimelineNodeKey(node, index)
        let content
        if (node.type === 'reasoning') {
          content = (
            <CotReasoningCard
              baseKey={baseKey}
              text={node.text}
              charStart={node.charStart}
              defaultExpanded={defaultExpanded}
              isStreamingTail={node.charStart === activeReasoningCharStart}
              playedLength={resolveSegmentPlayedLength(
                reasoningPlayedLength,
                node.charStart,
                node.text.length,
              )}
              overrideExpanded={overrideExpanded}
              onInteract={onInteract}
            />
          )
        } else if (node.type === 'toolGroup') {
          content = (
            <CotToolGroupCard
              baseKey={baseKey}
              node={node}
              revealFailureRequest={index === failedNodeIndex ? failureRequest : undefined}
              overrideExpanded={overrideExpanded}
              compact={compact}
              onInteract={onInteract}
            />
          )
        } else {
          const toolId = node.event.identifier || node.event.apiName || node.event.tool
          content = toolId === 'research_plan' ? (
            <ResearchPlanCard event={node.event} isStreaming={isStreaming} />
          ) : (
            <CotToolCard
              baseKey={baseKey}
              event={node.event}
              revealFailureRequest={index === failedNodeIndex ? failureRequest : undefined}
              overrideExpanded={overrideExpanded}
              compact={compact}
              onInteract={onInteract}
            />
          )
        }
        return (
          <li key={reactKey} tabIndex={-1} data-failure-target={index === failedNodeIndex ? true : undefined} className="grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)] gap-1 rounded-md focus:outline-none focus:ring-2 focus:ring-ring sm:gap-2">
            <span aria-hidden className="pt-3.5 text-xs tabular-nums text-muted-foreground">
              {String(index + 1).padStart(2, '0')}
            </span>
            <div className="min-w-0">{content}</div>
          </li>
        )
      })}
    </ol>
  )
}
