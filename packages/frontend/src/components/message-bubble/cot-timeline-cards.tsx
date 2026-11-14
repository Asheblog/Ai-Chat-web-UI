'use client'

import { ChevronDown, Lightbulb, Loader2 } from 'lucide-react'
import type { CotTimelineNode } from '@aichat/shared/cot-timeline'
import type { ToolEvent } from '@/types'
import { TypewriterReasoning } from '@/components/typewriter-reasoning'
import { CotToolGroupStep, CotToolStep } from './cot-step-parts'
import { usePersistedExpand } from './use-persisted-expand'
import { FadeScrollContainer } from './fade-scroll-container'
import { VerticalLineScroller } from './vertical-line-scroller'

const REASONING_VISIBILITY_STORAGE_KEY = 'aichat.cot_reasoning_visibility'
const TOOL_VISIBILITY_STORAGE_KEY = 'aichat.cot_tool_visibility'

const DOT_CLASS = 'absolute -left-[19px] h-2 w-2 rounded-full border-2 border-background'

const CARD_SHELL_CLASS = 'overflow-hidden rounded-lg border border-border bg-background/50'
const CARD_SHELL_COMPACT_CLASS = 'rounded-md transition-colors duration-200 hover:bg-surface-subtle/40'

const CARD_BUTTON_CLASS =
  'flex w-full cursor-pointer flex-col gap-1.5 px-3 py-2 text-left transition-colors duration-200 hover:bg-surface-subtle/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring'
const CARD_BUTTON_COMPACT_CLASS =
  'flex w-full cursor-pointer flex-col gap-0.5 px-2 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring'

function CardShell({
  dotClass,
  compact,
  children,
}: {
  dotClass: string
  compact?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="relative">
      <span
        aria-hidden
        className={`${DOT_CLASS} ${compact ? 'top-3' : 'top-4'} ${dotClass}`}
      />
      {children}
    </div>
  )
}

export function CotReasoningCard({
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
  compact = false,
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
  /** 提纲层的紧凑单行：常态不显示预览行，只保留标题 */
  compact?: boolean
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

  // 提纲层常态只留一行；流式末段仍给单行滚动，保证「正在想什么」看得见
  const showPreview = !expanded && (!compact || Boolean(isStreamingTail))

  return (
    <CardShell dotClass={dotClass} compact={compact}>
      <div className={compact ? CARD_SHELL_COMPACT_CLASS : CARD_SHELL_CLASS}>
        <button
          type="button"
          className={compact ? CARD_BUTTON_COMPACT_CLASS : CARD_BUTTON_CLASS}
          onClick={() => {
            toggle()
            onInteract?.()
          }}
          aria-expanded={expanded}
        >
          <div className="flex w-full items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-muted-foreground">
              <Lightbulb className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
              <span className="shrink-0">深度思考</span>
              {isStreamingTail && (
                <Loader2
                  className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground"
                  aria-hidden
                />
              )}
              {!isStreamingTail && durationText && (
                <span className="shrink-0 text-xs text-muted-foreground">· {durationText}</span>
              )}
            </div>
            <ChevronDown
              aria-hidden
              className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${
                expanded ? 'rotate-180' : ''
              }`}
            />
          </div>
          {showPreview && (
            <VerticalLineScroller
              text={text}
              className="w-full pl-[22px] text-xs text-muted-foreground"
              active={Boolean(isStreamingTail)}
            />
          )}
        </button>
        {expanded && (
          <div className={compact ? 'border-t border-border px-2 py-2' : 'border-t border-border px-3 py-2.5'}>
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
    </CardShell>
  )
}

export function CotToolCard({
  baseKey,
  event,
  dotClass,
  overrideExpanded,
  onInteract,
  compact = false,
}: {
  baseKey: string
  event: ToolEvent
  dotClass: string
  overrideExpanded?: boolean | null
  onInteract?: () => void
  compact?: boolean
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
    <CardShell dotClass={dotClass} compact={compact}>
      <CotToolStep
        event={event}
        open={expanded}
        compact={compact}
        onOpenChange={(next) => {
          setExpanded(next)
          onInteract?.()
        }}
      />
    </CardShell>
  )
}

export function CotToolGroupCard({
  baseKey,
  node,
  dotClass,
  overrideExpanded,
  onInteract,
  compact = false,
}: {
  baseKey: string
  node: Extract<CotTimelineNode, { type: 'toolGroup' }>
  dotClass: string
  overrideExpanded?: boolean | null
  onInteract?: () => void
  compact?: boolean
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
    <CardShell dotClass={dotClass} compact={compact}>
      <CotToolGroupStep
        node={node}
        open={expanded}
        compact={compact}
        onOpenChange={(next) => {
          setExpanded(next)
          onInteract?.()
        }}
      />
    </CardShell>
  )
}
