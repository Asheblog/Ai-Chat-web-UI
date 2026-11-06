'use client'

import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { ShareSelectionToolSummary } from '@/components/chat/share-selection-tool-summary'
import { useChatStore, useChatMessages } from '@/store/chat-store'
import { messageKey } from '@/features/chat/store/utils'
import type { MessageMeta, ToolEvent } from '@/types'

interface ShareSelectionPanelProps {
  sessionId: number
  metas: MessageMeta[]
  selectedMessageIds: number[]
  onExit: () => void
  onNext: () => void
}

const isBlockedByResearchPlan = (events: ToolEvent[] | undefined): boolean =>
  Boolean(
    events?.some((event) => {
      const toolId = event.identifier || event.apiName || event.tool
      return toolId === 'research_plan' && (event.status === 'rejected' || event.status === 'aborted')
    }),
  )

/** 仅在分享选择模式挂载；正文订阅不会污染普通聊天视口。 */
export function ShareSelectionPanel({
  sessionId,
  metas,
  selectedMessageIds,
  onExit,
  onNext,
}: ShareSelectionPanelProps) {
  // 摘要只由「可分享 / 被 research_plan 阻断」的 id 集合决定；正文 chunk 不触发重算与重渲染。
  const shareSignature = useChatMessages((state) => {
    const selectable: number[] = []
    const blocked: number[] = []
    const seen = new Set<number>()
    for (const meta of metas) {
      if (meta.sessionId !== sessionId || typeof meta.id !== 'number') continue
      if (!Number.isFinite(meta.id) || meta.pendingSync || meta.isPlaceholder) continue
      if (seen.has(meta.id)) continue
      seen.add(meta.id)
      const events = state.messageBodies[messageKey(meta.id)]?.toolEvents
      if (meta.role === 'assistant' && isBlockedByResearchPlan(events)) {
        blocked.push(meta.id)
        continue
      }
      selectable.push(meta.id)
    }
    return `${selectable.join(',')}#${blocked.join(',')}`
  })
  const setShareSelection = useChatStore((state) => state.setShareSelection)
  const clearShareSelection = useChatStore((state) => state.clearShareSelection)

  const { selectableIds, blockedIds } = useMemo(() => {
    const [selectablePart, blockedPart = ''] = shareSignature.split('#')
    const selectable = selectablePart ? selectablePart.split(',').map(Number) : []
    const blocked = new Set(blockedPart ? blockedPart.split(',').map(Number) : [])
    return { selectableIds: selectable, blockedIds: blocked }
  }, [shareSignature])

  const selectedCount = selectedMessageIds.length
  const selectedIdSet = useMemo(() => new Set(selectedMessageIds), [selectedMessageIds])
  const selectableCount = selectableIds.length
  const isAllSelectableChosen =
    selectableCount > 0 && selectableIds.every((id) => selectedIdSet.has(id))
  const highlightedId = selectedMessageIds[0] ?? null
  const highlightedEvents = useChatMessages(
    (state) => (highlightedId == null ? undefined : state.messageBodies[messageKey(highlightedId)]?.toolEvents),
  )

  const handleToggleSelectAll = () => {
    if (selectableCount === 0) return
    if (isAllSelectableChosen) {
      clearShareSelection()
      return
    }
    setShareSelection(sessionId, selectableIds)
  }

  return (
    <>
      <div className="mb-3 rounded-xl border border-primary/25 bg-primary/8 px-4 py-3 text-sm text-foreground">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-medium text-primary">分享选择模式已开启</p>
            <p className="text-xs text-primary/80 mt-1">
              已选 {selectedCount} 条消息 · 仅当前会话可分享，切换会话将自动清空选择
            </p>
            <ShareSelectionToolSummary
              sessionId={sessionId}
              messageId={highlightedId}
              bodyEvents={highlightedEvents}
              title="首条选中消息的工具调用"
              className="mt-2 max-w-md"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={handleToggleSelectAll} disabled={selectableCount === 0}>
              {isAllSelectableChosen ? '反选' : '全选'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => clearShareSelection()} disabled={selectedCount === 0}>
              清空选中
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onExit}>
              返回聊天
            </Button>
            <Button type="button" size="sm" onClick={onNext} disabled={selectedCount === 0}>
              下一步
            </Button>
          </div>
        </div>
      </div>

      <div className="lg:hidden fixed bottom-24 left-0 right-0 z-30 px-4 pointer-events-none">
        <div className="pointer-events-auto flex items-center justify-between gap-3 rounded-full border border-primary/30 bg-[hsl(var(--surface))/0.95] px-4 py-3 shadow-lg backdrop-blur">
          <span className="text-sm text-foreground">
            已选 <span className="font-semibold text-primary">{selectedCount}</span> 条消息
            {blockedIds.size > 0 ? (
              <span className="ml-1 text-xs text-muted-foreground">（{blockedIds.size} 条不可分享）</span>
            ) : null}
          </span>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={handleToggleSelectAll} disabled={selectableCount === 0}>
              {isAllSelectableChosen ? '反选' : '全选'}
            </Button>
            <Button type="button" size="sm" onClick={onNext} disabled={selectedCount === 0}>
              下一步
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}
