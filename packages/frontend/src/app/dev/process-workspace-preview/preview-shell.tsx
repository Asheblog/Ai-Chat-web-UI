'use client'

import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import type { PreviewCase, PreviewCaseId } from './preview-cases'
import { PREVIEW_CASE_IDS, PREVIEW_CASES } from './preview-cases'
import { ChatSurface } from './chat-surface'
import { ShareConsumer } from './share-consumer'
import { BattleConsumer } from './battle-consumer'

/** 案例 → 真实消费方：聊天走 Entry + Host，分享走 ShareViewer，Battle 走 BattleShareViewer。 */
const CONSUMER_LABEL: Record<PreviewCaseId, string> = {
  completed: 'CotTimeline + ProcessWorkspaceHost',
  running: 'CotTimeline + ProcessWorkspaceHost',
  failure: 'CotTimeline + ProcessWorkspaceHost',
  approval: 'CotTimeline + ProcessWorkspaceHost',
  trace97: 'CotTimeline + ProcessWorkspaceHost',
  stress: 'CotTimeline + ProcessWorkspaceHost',
  empty: 'CotTimeline + ProcessWorkspaceHost',
  share: '真实 ShareViewer（只读消费方）',
  battle: '真实 BattleShareViewer（只读消费方）',
}

function CaseLink({ target, active }: { target: PreviewCaseId; active: boolean }) {
  const entry = PREVIEW_CASES[target]
  return (
    <a
      href={`?case=${target}`}
      data-preview-case-link={target}
      aria-current={active ? 'page' : undefined}
      title={entry.summary}
      className={cn(
        'shrink-0 rounded-full border px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'border-foreground bg-foreground text-background'
          : 'border-border bg-surface text-muted-foreground hover:bg-surface-hover hover:text-foreground',
      )}
    >
      {entry.label}
    </a>
  )
}

export function PreviewShell({ caseId }: { caseId: PreviewCaseId }) {
  const previewCase: PreviewCase = PREVIEW_CASES[caseId]
  const facts = previewCase.provenance.facts ?? []
  const isShare = previewCase.id === 'share'
  const isBattle = previewCase.id === 'battle'
  const provenanceTone = useMemo(() => {
    if (previewCase.provenance.kind === 'trace97-excerpt') return 'border-warning/40 bg-warning/10'
    if (previewCase.provenance.kind === 'synthesized') return 'border-destructive/30 bg-destructive/5'
    return 'border-border bg-surface-subtle'
  }, [previewCase.provenance.kind])

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-background text-foreground">
      <div className="border-b border-border bg-background-alt/80 backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 sm:px-6">
          <span className="text-xs font-semibold tracking-tight">过程工作区 · dev 验收</span>
          <span className="rounded-md bg-surface px-1.5 py-0.5 text-[11px] text-muted-foreground">
            {CONSUMER_LABEL[previewCase.id]}
          </span>
          <nav aria-label="验收案例" className="flex flex-1 flex-wrap items-center gap-1.5">
            {PREVIEW_CASE_IDS.map(id => (
              <CaseLink key={id} target={id} active={id === previewCase.id} />
            ))}
          </nav>
        </div>
        <div
          data-preview-provenance={previewCase.provenance.kind}
          className={cn('flex flex-wrap items-start gap-x-3 gap-y-1 border-t px-4 py-1.5 text-[11px] sm:px-6', provenanceTone)}
        >
          <span className="font-medium">{previewCase.provenance.title}</span>
          <span className="max-w-[68rem] text-muted-foreground">{previewCase.provenance.detail}</span>
          {facts.map(fact => (
            <span key={`${fact.label}-${fact.value}`} className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {fact.label} · {fact.value}
            </span>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {isShare ? (
          <ShareConsumer previewCase={previewCase} />
        ) : isBattle ? (
          <BattleConsumer previewCase={previewCase} />
        ) : (
          <ChatSurface previewCase={previewCase} />
        )}
      </div>
    </div>
  )
}
