'use client'

import { useMemo } from 'react'
import { ChevronDown, Lightbulb, Loader2 } from 'lucide-react'
import {
  buildInterleavedCotNodes,
  cotTimelineNodeKey,
  resolveSegmentPlayedLength,
  type CotTimelineNode,
} from '@aichat/shared/cot-timeline'
import { resolveEventStatus } from '@aichat/shared/tool-events'
import type { MessageMeta, ToolEvent } from '@/types'
import { TypewriterReasoning } from '@/components/typewriter-reasoning'
import { formatDurationSeconds } from './message-metrics'
import { CotToolGroupStep, CotToolStep } from './cot-step-parts'
import { usePersistedExpand } from './use-persisted-expand'

const REASONING_VISIBILITY_STORAGE_KEY = 'aichat.cot_reasoning_visibility'
const TOOL_VISIBILITY_STORAGE_KEY = 'aichat.cot_tool_visibility'

export interface CotTimelineProps {
  meta: MessageMeta
  reasoningRaw: string
  toolEvents: ToolEvent[]
  /** 完成态下推理卡是否默认展开（Battle 详情传 true） */
  defaultExpanded?: boolean
  /** 流式中：末段推理卡片使用打字机并自动展开 */
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
 * 每个 reasoning / tool / toolGroup 节点都是消息体的一级兄弟卡片，
 * 各自独立折叠、各自持久化，不再有共享外壳。
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
  const baseKey = resolveBaseKey(meta)

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

  const durationText = formatDurationSeconds(meta.reasoningDurationSeconds)
  const hasMeaningfulDuration =
    durationText !== null && (meta.reasoningDurationSeconds ?? 0) > 0

  if (nodes.length === 0) return null

  return (
    <div className="mb-3 space-y-2" data-message-panel="interactive">
      {nodes.map((node, index) => {
        const reactKey = cotTimelineNodeKey(node, index)
        if (node.type === 'reasoning') {
          return (
            <CotReasoningCard
              key={reactKey}
              baseKey={baseKey}
              text={node.text}
              charStart={node.charStart}
              defaultExpanded={defaultExpanded}
              isStreamingTail={Boolean(isStreaming) && index === lastReasoningIndex}
              playedLength={resolveSegmentPlayedLength(
                reasoningPlayedLength,
                node.charStart,
                node.text.length,
              )}
              durationText={
                index === firstReasoningIndex && hasMeaningfulDuration
                  ? durationText
                  : null
              }
            />
          )
        }
        if (node.type === 'toolGroup') {
          return <CotToolGroupCard key={reactKey} baseKey={baseKey} node={node} />
        }
        return <CotToolCard key={reactKey} baseKey={baseKey} event={node.event} />
      })}
    </div>
  )
}

function CotReasoningCard({
  baseKey,
  text,
  charStart,
  defaultExpanded,
  isStreamingTail,
  playedLength = 0,
  durationText,
}: {
  baseKey: string
  text: string
  charStart: number
  defaultExpanded: boolean
  isStreamingTail?: boolean
  playedLength?: number
  durationText?: string | null
}) {
  const itemKey = baseKey ? `${baseKey}:reasoning:${charStart}` : ''
  const { expanded, toggle } = usePersistedExpand({
    storageKey: REASONING_VISIBILITY_STORAGE_KEY,
    itemKey,
    defaultExpanded,
    autoExpand: Boolean(isStreamingTail),
    hasData: text.length > 0,
  })

  if (!text) return null

  return (
    <div className="overflow-hidden rounded-lg border border-border/60 bg-background/50">
      <button
        type="button"
        className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left transition-colors duration-200 hover:bg-muted/40"
        onClick={toggle}
        aria-expanded={expanded}
      >
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-muted-foreground">
          <Lightbulb className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          <span>深度思考</span>
          {isStreamingTail && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          {!isStreamingTail && durationText && (
            <span className="text-xs text-muted-foreground">· {durationText}</span>
          )}
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${
            expanded ? 'rotate-180' : ''
          }`}
        />
      </button>
      {expanded && (
        <div className="border-t border-border/60 px-3 py-2.5">
          {isStreamingTail ? (
            <TypewriterReasoning
              text={text}
              isStreaming
              speed={20}
              initialPlayedLength={playedLength}
            />
          ) : (
            <div className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
              {text}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function CotToolCard({ baseKey, event }: { baseKey: string; event: ToolEvent }) {
  const status = resolveEventStatus(event)
  const isActive = status === 'running' || status === 'pending'
  const eventKey = event.callId || event.id || 'tool'
  const itemKey = baseKey ? `${baseKey}:tool:${eventKey}` : ''
  const { expanded, setExpanded } = usePersistedExpand({
    storageKey: TOOL_VISIBILITY_STORAGE_KEY,
    itemKey,
    defaultExpanded: false,
    autoExpand: isActive,
    hasData: true,
  })

  return <CotToolStep event={event} open={expanded} onOpenChange={setExpanded} />
}

function CotToolGroupCard({
  baseKey,
  node,
}: {
  baseKey: string
  node: Extract<CotTimelineNode, { type: 'toolGroup' }>
}) {
  const firstEvent = node.events[0]
  const groupSeed = firstEvent ? firstEvent.callId || firstEvent.id : node.toolType
  const itemKey = baseKey ? `${baseKey}:toolgroup:${node.toolType}:${groupSeed}` : ''
  const { expanded, setExpanded } = usePersistedExpand({
    storageKey: TOOL_VISIBILITY_STORAGE_KEY,
    itemKey,
    defaultExpanded: false,
    autoExpand: node.status === 'running',
    hasData: true,
  })

  return <CotToolGroupStep node={node} open={expanded} onOpenChange={setExpanded} />
}
