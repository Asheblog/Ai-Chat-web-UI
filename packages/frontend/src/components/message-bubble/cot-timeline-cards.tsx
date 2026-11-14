'use client'

import { useEffect, useId } from 'react'
import { ChevronDown, Lightbulb, Loader2 } from 'lucide-react'
import type { CotTimelineNode } from '@aichat/shared/cot-timeline'
import type { ToolEvent } from '@/types'
import { TypewriterReasoning } from '@/components/typewriter-reasoning'
import { CotToolGroupStep, CotToolStep } from './cot-step-parts'
import { usePersistedExpand } from './use-persisted-expand'

const REASONING_VISIBILITY_STORAGE_KEY = 'aichat.cot_reasoning_visibility'
const TOOL_VISIBILITY_STORAGE_KEY = 'aichat.cot_tool_visibility'

export function CotReasoningCard({
  baseKey,
  text,
  charStart,
  defaultExpanded,
  isStreamingTail,
  playedLength = 0,
  overrideExpanded,
  onInteract,
}: {
  baseKey: string
  text: string
  charStart: number
  defaultExpanded: boolean
  isStreamingTail?: boolean
  playedLength?: number
  overrideExpanded?: boolean | null
  onInteract?: () => void
}) {
  const bodyId = useId()
  const { expanded, toggle } = usePersistedExpand({
    storageKey: REASONING_VISIBILITY_STORAGE_KEY,
    itemKey: baseKey ? baseKey + ':reasoning:' + charStart : '',
    defaultExpanded,
    autoExpand: false,
    hasData: text.length > 0,
    overrideExpanded,
  })
  if (!text) return null

  return (
    <div className="min-w-0 rounded-md">
      <button
        type="button"
        className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left transition-colors duration-200 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={() => { toggle(); onInteract?.() }}
        aria-expanded={expanded}
        aria-controls={bodyId}
      >
        <Lightbulb className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 text-sm font-medium">深度思考</span>
        {isStreamingTail ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary motion-reduce:animate-none" aria-hidden />
        ) : (
          <span className="text-xs text-muted-foreground">思考</span>
        )}
        <ChevronDown
          aria-hidden
          className={'h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none ' + (expanded ? 'rotate-180' : '')}
        />
      </button>
      {expanded && (
        <div id={bodyId} className="mb-2 border-t border-border px-2 py-3 text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
          {isStreamingTail ? (
            <TypewriterReasoning text={text} isStreaming speed={20} initialPlayedLength={playedLength} />
          ) : (
            <div className="whitespace-pre-wrap break-words">{text}</div>
          )}
        </div>
      )}
    </div>
  )
}

export function CotToolCard({
  baseKey, event, overrideExpanded, onInteract, compact = false, revealFailureRequest,
}: {
  baseKey: string
  event: ToolEvent
  overrideExpanded?: boolean | null
  onInteract?: () => void
  compact?: boolean
  revealFailureRequest?: number
}) {
  const eventKey = event.callId || event.id || 'tool'
  const { expanded, setExpanded } = usePersistedExpand({
    storageKey: TOOL_VISIBILITY_STORAGE_KEY,
    itemKey: baseKey ? baseKey + ':tool:' + eventKey : '',
    defaultExpanded: false,
    autoExpand: false,
    hasData: true,
    overrideExpanded,
  })
  useEffect(() => {
    if (revealFailureRequest !== undefined) setExpanded(true)
  }, [revealFailureRequest, setExpanded])
  return (
    <CotToolStep
      event={event}
      open={expanded}
      compact={compact}
      onOpenChange={next => { setExpanded(next); onInteract?.() }}
    />
  )
}

export function CotToolGroupCard({
  baseKey, node, overrideExpanded, onInteract, compact = false, revealFailureRequest,
}: {
  baseKey: string
  node: Extract<CotTimelineNode, { type: 'toolGroup' }>
  overrideExpanded?: boolean | null
  onInteract?: () => void
  compact?: boolean
  revealFailureRequest?: number
}) {
  const firstEvent = node.events[0]
  const groupSeed = firstEvent ? firstEvent.callId || firstEvent.id : node.toolType
  const { expanded, setExpanded } = usePersistedExpand({
    storageKey: TOOL_VISIBILITY_STORAGE_KEY,
    itemKey: baseKey ? baseKey + ':toolgroup:' + node.toolType + ':' + groupSeed : '',
    defaultExpanded: false,
    autoExpand: false,
    hasData: true,
    overrideExpanded,
  })
  useEffect(() => {
    if (revealFailureRequest !== undefined) setExpanded(true)
  }, [revealFailureRequest, setExpanded])
  return (
    <CotToolGroupStep
      node={node}
      revealFailureRequest={revealFailureRequest}
      open={expanded}
      compact={compact}
      onOpenChange={next => { setExpanded(next); onInteract?.() }}
    />
  )
}
