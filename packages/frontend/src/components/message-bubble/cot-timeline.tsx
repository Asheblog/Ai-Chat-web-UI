'use client'

import { useCallback, useMemo, useState } from 'react'
import { ChevronDown, ChevronsUpDown, Lightbulb, Loader2 } from 'lucide-react'
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
import { FadeScrollContainer } from './fade-scroll-container'
import { SingleLineScroller } from './single-line-scroller'

const REASONING_VISIBILITY_STORAGE_KEY = 'aichat.cot_reasoning_visibility'
const TOOL_VISIBILITY_STORAGE_KEY = 'aichat.cot_tool_visibility'

export interface CotTimelineProps {
  meta: MessageMeta
  reasoningRaw: string
  toolEvents: ToolEvent[]
  /** 完成态下推理卡是否默认展开（Battle 详情传 true） */
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

const resolveDotClass = (node: CotTimelineNode) => {
  if (node.type === 'reasoning') return 'bg-amber-400'
  const status = node.type === 'toolGroup' ? node.status : resolveEventStatus(node.event)
  if (status === 'running' || status === 'pending') return 'bg-blue-400 animate-pulse'
  if (status === 'error' || status === 'rejected' || status === 'aborted') return 'bg-rose-400'
  return 'bg-emerald-400'
}

/**
 * 统一 CoT 时间轴：主聊天 / 分享 / Battle 共用。
 * 顶部提供统一展开/折叠开关，左侧提供时间轴轨道；
 * 每个 reasoning / tool / toolGroup 节点仍是独立卡片，可单独折叠与持久化。
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
  const [masterExpanded, setMasterExpanded] = useState<boolean | null>(null)

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

  // 只有 reasoningStatus 仍为 streaming 时，末段推理才算“未结束”，
  // 才会启用单行滚动 / 打字机；已经 done 的推理段即使消息仍在跑工具也保持静态。
  const activeReasoningIndex = meta.reasoningStatus === 'streaming' ? lastReasoningIndex : -1

  const durationText = formatDurationSeconds(meta.reasoningDurationSeconds)
  const hasMeaningfulDuration =
    durationText !== null && (meta.reasoningDurationSeconds ?? 0) > 0

  const clearMasterOverride = useCallback(() => {
    setMasterExpanded(null)
  }, [])

  if (nodes.length === 0) return null

  return (
    <div className="mb-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          过程时间轴 · {nodes.length} 步
        </span>
        <button
          type="button"
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border/70 bg-background/60 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors duration-200 hover:bg-muted/40 hover:text-foreground"
          onClick={() => setMasterExpanded((current) => current !== true)}
          aria-pressed={masterExpanded === true}
        >
          <ChevronsUpDown className="h-3.5 w-3.5" />
          {masterExpanded === true ? '全部折叠' : '全部展开'}
        </button>
      </div>

      <div className="relative pl-6" data-message-panel="interactive">
        <div
          aria-hidden
          className="absolute bottom-2 left-[9px] top-2 w-px bg-border/70"
        />
        <div className="space-y-2">
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
                  durationText={
                    index === firstReasoningIndex && hasMeaningfulDuration
                      ? durationText
                      : null
                  }
                  dotClass={dotClass}
                  overrideExpanded={masterExpanded}
                  onInteract={clearMasterOverride}
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
                  overrideExpanded={masterExpanded}
                  onInteract={clearMasterOverride}
                />
              )
            }
            return (
              <CotToolCard
                key={reactKey}
                baseKey={baseKey}
                event={node.event}
                dotClass={dotClass}
                overrideExpanded={masterExpanded}
                onInteract={clearMasterOverride}
              />
            )
          })}
        </div>
      </div>
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
  dotClass,
  overrideExpanded,
  onInteract,
}: {
  baseKey: string
  text: string
  charStart: number
  defaultExpanded: boolean
  isStreamingTail?: boolean
  playedLength?: number
  durationText?: string | null
  dotClass: string
  overrideExpanded?: boolean | null
  onInteract?: () => void
}) {
  const itemKey = baseKey ? `${baseKey}:reasoning:${charStart}` : ''
  const { expanded, toggle } = usePersistedExpand({
    storageKey: REASONING_VISIBILITY_STORAGE_KEY,
    itemKey,
    defaultExpanded,
    autoExpand: false,
    hasData: text.length > 0,
    overrideExpanded,
  })

  if (!text) return null

  return (
    <div className="relative">
      <span
        aria-hidden
        className={`absolute -left-[19px] top-4 h-2 w-2 rounded-full border-2 border-background ${dotClass}`}
      />
      <div className="overflow-hidden rounded-lg border border-border/60 bg-background/50">
        <button
          type="button"
          className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left transition-colors duration-200 hover:bg-muted/40"
          onClick={() => {
            toggle()
            onInteract?.()
          }}
          aria-expanded={expanded}
        >
          <div className="flex shrink-0 items-center gap-2 text-sm font-medium text-muted-foreground">
            <Lightbulb className="h-3.5 w-3.5 shrink-0 text-amber-500" />
            <span>深度思考</span>
            {isStreamingTail && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            {!isStreamingTail && durationText && (
              <span className="text-xs text-muted-foreground">· {durationText}</span>
            )}
          </div>
          {!expanded && (
            <SingleLineScroller
              text={text}
              className="min-w-0 flex-1 text-xs text-muted-foreground"
              active={Boolean(isStreamingTail)}
            />
          )}
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${
              expanded ? 'rotate-180' : ''
            }`}
          />
        </button>
        {expanded && (
          <div className="border-t border-border/60 px-3 py-2.5">
            <FadeScrollContainer
              maxHeightClassName="max-h-72"
              stickToBottomKey={isStreamingTail ? text.length : null}
            >
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
            </FadeScrollContainer>
          </div>
        )}
      </div>
    </div>
  )
}

function CotToolCard({
  baseKey,
  event,
  dotClass,
  overrideExpanded,
  onInteract,
}: {
  baseKey: string
  event: ToolEvent
  dotClass: string
  overrideExpanded?: boolean | null
  onInteract?: () => void
}) {
  const eventKey = event.callId || event.id || 'tool'
  const itemKey = baseKey ? `${baseKey}:tool:${eventKey}` : ''
  const { expanded, setExpanded } = usePersistedExpand({
    storageKey: TOOL_VISIBILITY_STORAGE_KEY,
    itemKey,
    defaultExpanded: false,
    autoExpand: false,
    hasData: true,
    overrideExpanded,
  })

  return (
    <div className="relative">
      <span
        aria-hidden
        className={`absolute -left-[19px] top-4 h-2 w-2 rounded-full border-2 border-background ${dotClass}`}
      />
      <CotToolStep
        event={event}
        open={expanded}
        onOpenChange={(next) => {
          setExpanded(next)
          onInteract?.()
        }}
      />
    </div>
  )
}

function CotToolGroupCard({
  baseKey,
  node,
  dotClass,
  overrideExpanded,
  onInteract,
}: {
  baseKey: string
  node: Extract<CotTimelineNode, { type: 'toolGroup' }>
  dotClass: string
  overrideExpanded?: boolean | null
  onInteract?: () => void
}) {
  const firstEvent = node.events[0]
  const groupSeed = firstEvent ? firstEvent.callId || firstEvent.id : node.toolType
  const itemKey = baseKey ? `${baseKey}:toolgroup:${node.toolType}:${groupSeed}` : ''
  const { expanded, setExpanded } = usePersistedExpand({
    storageKey: TOOL_VISIBILITY_STORAGE_KEY,
    itemKey,
    defaultExpanded: false,
    autoExpand: false,
    hasData: true,
    overrideExpanded,
  })

  return (
    <div className="relative">
      <span
        aria-hidden
        className={`absolute -left-[19px] top-4 h-2 w-2 rounded-full border-2 border-background ${dotClass}`}
      />
      <CotToolGroupStep
        node={node}
        open={expanded}
        onOpenChange={(next) => {
          setExpanded(next)
          onInteract?.()
        }}
      />
    </div>
  )
}
