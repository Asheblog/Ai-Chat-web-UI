'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  FileText,
  Lightbulb,
  Play,
  RotateCcw,
  Search,
  X,
} from 'lucide-react'
import type { ResearchPlanApprovalState, ResearchPlanPayload } from '@aichat/shared/chat-stream-contract'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/use-toast'
import { useChatStore } from '@/store/chat-store'
import { messageKey } from '@/features/chat/store/utils'
import { respondResearchPlanApproval } from '@/features/chat/api/streaming'
import type { ToolEvent } from '@/types'
import { cn } from '@/lib/utils'

const PREVIEW_QUESTIONS = 6

const parseExpiresAt = (value: string | number | undefined): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

const formatCountdown = (remainingMs: number): string => {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function ResearchPlanCard({
  event,
  isStreaming = false,
}: {
  event: ToolEvent
  isStreaming?: boolean
}) {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const [showAdjust, setShowAdjust] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const cardRef = useRef<HTMLDivElement>(null)

  const plan = event.details?.plan as ResearchPlanPayload | undefined
  const approval = event.details?.approval as ResearchPlanApprovalState | undefined
  const kind = approval?.kind === 'search_unavailable' ? 'search_unavailable' : 'plan'
  const decision = approval?.decision
  const revision = typeof approval?.revision === 'number' ? approval.revision : 0
  const expiresAt = parseExpiresAt(approval?.expiresAt)
  const expired = expiresAt != null && expiresAt <= now
  const terminal =
    event.status === 'success' ||
    event.status === 'rejected' ||
    event.status === 'aborted' ||
    event.status === 'error'
  const interactive =
    event.status === 'pending' && event.phase === 'pending_approval' && isStreaming && !expired
  const canAdjust = interactive && kind === 'plan' && revision < 2

  const messageMetas = useChatStore((state) => state.messageMetas)
  const messageBodies = useChatStore((state) => state.messageBodies)
  const originalQuestion = useMemo(() => {
    const sessionMetas = messageMetas
      .filter((meta) => meta.sessionId === event.sessionId)
      .slice()
      .sort((a, b) => {
        const aTime = typeof a.createdAt === 'string' ? Date.parse(a.createdAt) : (a.createdAt ?? 0)
        const bTime = typeof b.createdAt === 'string' ? Date.parse(b.createdAt) : (b.createdAt ?? 0)
        return aTime - bTime
      })
    const targetIndex = sessionMetas.findIndex(
      (meta) => messageKey(meta.id) === messageKey(event.messageId),
    )
    for (let i = Math.min(targetIndex, sessionMetas.length - 1); i >= 0; i -= 1) {
      const meta = sessionMetas[i]
      if (!meta || meta.role !== 'user') continue
      const body = messageBodies[messageKey(meta.id)]
      const content = typeof body?.content === 'string' ? body.content.trim() : ''
      if (content) return content
    }
    return plan?.objective?.trim() || plan?.title?.trim() || ''
  }, [event.messageId, event.sessionId, messageBodies, messageMetas, plan?.objective, plan?.title])

  useEffect(() => {
    if (!interactive && expiresAt == null) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [expiresAt, interactive])

  useEffect(() => {
    if (!interactive) return
    const raf = window.requestAnimationFrame(() => {
      if (typeof cardRef.current?.scrollIntoView === 'function') {
        cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    })
    return () => window.cancelAnimationFrame(raf)
  }, [interactive, event.callId, event.id])

  const respond = async (nextDecision: 'approve' | 'adjust' | 'cancel' | 'continue') => {
    const callId = event.callId || event.id
    if (!callId) return
    if (nextDecision === 'adjust' && !feedback.trim()) return
    setBusy(true)
    try {
      await respondResearchPlanApproval(
        event.sessionId,
        callId,
        nextDecision,
        nextDecision === 'adjust' ? feedback.trim() : undefined,
      )
    } catch (error) {
      toast({
        title: '计划确认失败',
        description: error instanceof Error ? error.message : '请稍后重试',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  const relaunch = () => {
    window.dispatchEvent(
      new CustomEvent('aichat:composer-prefill', {
        detail: { content: originalQuestion },
      }),
    )
  }

  const remainingMs = expiresAt != null ? expiresAt - now : 0
  const statusLabel =
    decision === 'approve' || event.status === 'success'
      ? '已确认'
      : decision === 'adjust'
        ? '已提交调整意见'
        : event.status === 'rejected' || decision === 'cancel'
          ? '已取消'
          : event.status === 'aborted' || decision === 'expired'
            ? '已过期'
            : event.status === 'error'
              ? '未通过'
              : '等待确认'

  const statusClass = cn(
    'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-micro font-medium',
    event.status === 'pending' && !expired && 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
    event.status === 'success' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    (event.status === 'rejected' || event.status === 'aborted' || event.status === 'error' || expired) &&
      'bg-slate-500/10 text-slate-600 dark:text-slate-300',
  )

  return (
    <div
      ref={cardRef}
      className={cn(
        'rounded-lg border border-border/70 bg-background/70 px-3 py-3',
        interactive && 'border-amber-400/50 ring-2 ring-amber-400/20',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Lightbulb className="h-4 w-4 shrink-0 text-amber-500" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-foreground">
                {kind === 'search_unavailable' ? '深度研究：联网搜索不可用' : '研究计划确认'}
              </span>
              {revision > 0 && kind === 'plan' && (
                <span className="text-micro text-muted-foreground">第 {revision + 1} 稿</span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {kind === 'search_unavailable'
                ? '当前没有可用搜索引擎，是否基于已有知识继续？'
                : plan?.objective || '模型正在整理研究计划'}
            </p>
          </div>
        </div>
        <span className={statusClass}>
          {interactive ? <CalendarClock className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
          {statusLabel}
        </span>
      </div>

      {kind === 'plan' && plan && (
        <div className="mt-3 space-y-2 border-t border-border/60 pt-2">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              研究标题
            </h4>
            <p className="mt-1 text-sm leading-6 text-foreground">{plan.title}</p>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              子问题与搜索关键词
            </h4>
            <ol className="mt-1 space-y-1.5">
              {plan.sub_questions.slice(0, PREVIEW_QUESTIONS).map((item, index) => (
                <li key={`${item.question}-${index}`} className="text-sm leading-6 text-foreground">
                  <span className="mr-1 text-muted-foreground">{index + 1}.</span>
                  {item.question}
                  <span className="mt-0.5 flex flex-wrap gap-1 sm:ml-5">
                    {item.keywords.map((keyword) => (
                      <span
                        key={keyword}
                        className="inline-flex items-center gap-1 rounded bg-muted/60 px-1.5 py-0.5 text-micro text-muted-foreground"
                      >
                        <Search className="h-3 w-3" />
                        {keyword}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <RotateCcw className="h-3.5 w-3.5" />
              预计工具轮数 {plan.estimated_tool_rounds.min}-{plan.estimated_tool_rounds.max} 轮
            </span>
            <span className="inline-flex items-center gap-1">
              <FileText className="h-3.5 w-3.5" />
              Markdown 引用报告 + PDF
            </span>
          </div>

          {plan.notes ? (
            <p className="text-xs leading-5 text-muted-foreground">
              备注：{plan.notes}
            </p>
          ) : null}
        </div>
      )}

      {interactive && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
          {kind === 'plan' ? (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowAdjust((value) => !value)}
                disabled={busy || !canAdjust}
                aria-label="调整研究计划"
              >
                <ClipboardList className="mr-1.5 h-3.5 w-3.5" />
                调整计划
              </Button>
              <Button
                size="sm"
                onClick={() => respond('approve')}
                disabled={busy}
                aria-label="开始研究"
              >
                <Play className="mr-1.5 h-3.5 w-3.5" />
                开始研究
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              onClick={() => respond('continue')}
              disabled={busy}
              aria-label="基于已有知识继续"
            >
              继续
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => respond('cancel')}
            disabled={busy}
            aria-label="取消深度研究"
          >
            <X className="mr-1.5 h-3.5 w-3.5" />
            取消
          </Button>
          {interactive && expiresAt != null && (
            <span className="ml-auto text-micro text-muted-foreground">
              {formatCountdown(remainingMs)} 后自动过期
            </span>
          )}
        </div>
      )}

      {interactive && showAdjust && canAdjust && (
        <div className="mt-2 space-y-2 border-t border-border/60 pt-2">
          <Textarea
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder="例如：请补充成本与供应链风险维度，重点看 2026 年后的变化"
            maxLength={2000}
            rows={3}
            aria-label="计划调整意见"
          />
          <Button
            size="sm"
            variant="secondary"
            onClick={() => respond('adjust')}
            disabled={busy || !feedback.trim()}
          >
            提交调整并重新生成计划
          </Button>
        </div>
      )}

      {!interactive &&
        (expired || decision === 'expired' || event.status === 'aborted') &&
        kind === 'plan' && (
        <div className="mt-3 flex items-center justify-end border-t border-border/60 pt-3">
          <Button size="sm" variant="outline" onClick={relaunch}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            重新发起
          </Button>
        </div>
      )}
    </div>
  )
}
