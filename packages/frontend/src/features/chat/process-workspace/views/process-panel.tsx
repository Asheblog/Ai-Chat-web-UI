'use client'

import { useId, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ProcessScope, ProcessSnapshot, ProcessWorkspaceCommands, ProcessWorkspaceTab } from '../types'
import type { ProcessModel } from '../hooks/use-process-model'
import { useLatestFollow } from '../hooks/use-latest-follow'
import { ProcessProcessTab } from './process-tab'
import { ProcessSourcesTab } from './sources-tab'
import { ProcessArtifactsTab } from './artifacts-tab'
import { ProcessActions } from './process-actions'
import {
  ProcessCoverageNotices,
  ProcessObservationWindow,
  ProcessRunTerminalNotice,
} from './notices'
import { CallLedger } from '@/features/chat/call-ledger'

interface ProcessPanelProps {
  snapshot: ProcessSnapshot
  scope: ProcessScope
  model: ProcessModel
  defaultTab?: ProcessWorkspaceTab
  expandAll?: boolean
  onClose: () => void
}

const TABS: Array<{ value: ProcessWorkspaceTab; label: string }> = [
  { value: 'process', label: '过程' },
  { value: 'sources', label: '来源' },
  { value: 'artifacts', label: '产物' },
]

/** 工作区面板：头（标题 + 关闭）/ 页签 / 单滚动内容 / 页脚真实操作。 */
export function ProcessPanel({
  snapshot,
  scope,
  model,
  defaultTab = 'process',
  expandAll = false,
  onClose,
}: ProcessPanelProps) {
  const [tab, setTab] = useState<ProcessWorkspaceTab>(defaultTab)
  const [ledgerOpen, setLedgerOpen] = useState(false)
  const baseId = useId()
  const tabRefs = useRef<Record<ProcessWorkspaceTab, HTMLButtonElement | null>>({
    process: null,
    sources: null,
    artifacts: null,
  })
  const commands: ProcessWorkspaceCommands | undefined = snapshot.commands
  const follow = useLatestFollow(
    model.index.records.length,
    Boolean(snapshot.isStreaming),
  )
  const artifactCount = snapshot.artifacts?.length ?? 0
  const tabLabel = (value: ProcessWorkspaceTab, label: string) => {
    if (value === 'sources') return `${label} ${model.sources.length}`
    if (value === 'artifacts') return `${label} ${artifactCount}`
    return label
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <header className="flex items-start gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-title-s">本轮工作区</h2>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-micro text-muted-foreground">
            <span>{scope.readOnly ? (scope.origin === 'battle' ? 'Battle 只读' : '只读分享') : '可执行整轮操作'}</span>
            <ProcessObservationWindow coverage={model.index.coverage} />
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭工作区"
          className="v2-icon-button shrink-0"
        >
          <X aria-hidden className="h-4 w-4" />
        </button>
      </header>

      <div role="tablist" aria-label="工作区页签" className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        {TABS.map((entry) => {
          const selected = tab === entry.value
          return (
            <button
              key={entry.value}
              role="tab"
              type="button"
              id={`${baseId}-tab-${entry.value}`}
              aria-selected={selected}
              aria-controls={selected ? `${baseId}-panel-${entry.value}` : undefined}
              tabIndex={selected ? 0 : -1}
              ref={(node) => {
                tabRefs.current[entry.value] = node
              }}
              onClick={() => setTab(entry.value)}
              onKeyDown={(event) => {
                const isVertical = event.key === 'ArrowDown' || event.key === 'ArrowUp'
                if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft' && !isVertical) return
                event.preventDefault()
                const currentIndex = TABS.findIndex((candidate) => candidate.value === tab)
                const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown'
                const next = TABS[(currentIndex + (forward ? 1 : -1) + TABS.length) % TABS.length]
                setTab(next.value)
                tabRefs.current[next.value]?.focus()
              }}
              className={cn(
                'min-h-11 cursor-pointer rounded-lg px-2.5 text-caption font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selected
                  ? 'bg-signal-soft text-signal-text'
                  : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
              )}
            >
              {tabLabel(entry.value, entry.label)}
            </button>
          )
        })}
      </div>

      <div ref={follow.ref} onScroll={follow.onScroll} className="flex-1 overflow-y-auto overscroll-contain px-3 py-3">
        <div className="flex flex-col gap-2.5">
          <ProcessRunTerminalNotice terminal={model.terminal} />
          <ProcessCoverageNotices coverage={model.index.coverage} />
          {snapshot.isStreaming && model.activity && (
            <p role="status" className="text-caption text-muted-foreground [overflow-wrap:anywhere]">
              {model.activity}
            </p>
          )}

          <div
            role="tabpanel"
            id={`${baseId}-panel-${tab}`}
            aria-labelledby={`${baseId}-tab-${tab}`}
          >
            {tab === 'process' && (
              <ProcessProcessTab
                snapshot={snapshot}
                scopeKey={scope.key}
                index={model.index}
                summary={model.summary}
                anomalies={model.anomalies}
                expandAll={expandAll}
                canCommand={scope.canCommand}
                commands={commands}
                onOpenLedger={() => setLedgerOpen(true)}
              />
            )}
            {tab === 'sources' && (
              <ProcessSourcesTab sources={model.sources} />
            )}
            {tab === 'artifacts' && <ProcessArtifactsTab artifacts={snapshot.artifacts ?? []} />}
          </div>
        </div>
      </div>

      <footer className="flex flex-col gap-2 border-t border-border px-3 py-2">
        {snapshot.isStreaming && !follow.following && (
          <button
            type="button"
            onClick={follow.scrollToLatest}
            className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-border bg-surface text-caption font-medium text-foreground transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            回到最新活动
          </button>
        )}
        <ProcessActions
          canCommand={scope.canCommand}
          isStreaming={Boolean(snapshot.isStreaming)}
          target={scope.target}
          commands={commands}
        />
      </footer>

      {ledgerOpen && (
        <CallLedger
          meta={snapshot.meta}
          toolEvents={snapshot.toolEvents ?? []}
          coverage={snapshot.coverage}
          readOnly={!scope.canCommand}
          onReturn={() => setLedgerOpen(false)}
        />
      )}
    </div>
  )
}
