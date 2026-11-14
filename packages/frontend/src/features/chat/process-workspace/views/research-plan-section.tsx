'use client'

import { useState } from 'react'
import { Check, Pencil, Play, RotateCcw, Send, X } from 'lucide-react'
import { cn, extractErrorMessage } from '@/lib/utils'
import type { ResearchPlanApprovalState, ResearchPlanPayload } from '@aichat/shared/chat-stream-contract'
import type { ProcessRecord } from '../model/process-model'
import type { ProcessWorkspaceCommands } from '../types'

/**
 * 研究计划审批：本轮唯一的真实审批入口（旧正文计划卡已清理）。
 * approve / adjust(必填 feedback, max 2000) / cancel / continue 全部沿 commands 真回调；
 * 计划过期或调用中止后给"重新发起"，由宿主用原问题重新发起。
 * 只读或没有回调时不渲染任何可执行按钮，也不谎称审批入口在别处。
 */
function ResearchPlan({
  record,
  canCommand,
  commands,
}: {
  record: ProcessRecord
  canCommand: boolean
  commands?: ProcessWorkspaceCommands
}) {
  const plan = record.event.details?.plan as ResearchPlanPayload | undefined
  const approval = record.event.details?.approval as ResearchPlanApprovalState | undefined
  const [adjusting, setAdjusting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState<string | null>(null)
  const kind = approval?.kind === 'search_unavailable' ? 'search_unavailable' : 'plan'
  // 联网搜索不可用时后端只发 approval、不带 plan：这一支仍然要能"继续"，不能整块不渲染。
  if (!plan && kind !== 'search_unavailable') return null
  const decision = approval?.decision
  const revision = typeof approval?.revision === 'number' ? approval.revision : undefined
  const callId = record.callId ?? record.id
  const pending = record.status === 'pending' && record.phase === 'pending_approval'
  const decide = commands?.onResearchPlanDecision
  const reissue = commands?.onReissuePlan
  const interactive = pending && canCommand && Boolean(decide)
  const expired = decision === 'expired'
  const aborted = record.status === 'aborted'

  /**
   * 审批回调可能是异步的、也可能抛错：统一 await + catch，用 alert 呈现真实原因。
   * 返回是否成功，调用方据此决定收起编辑区还是留在原地（失败不丢输入）。
   */
  const run = async (action: (() => Promise<unknown> | unknown) | undefined): Promise<boolean> => {
    if (!action) return false
    setError(null)
    setSubmitting(true)
    try {
      await action()
      return true
    } catch (err) {
      setError(extractErrorMessage(err))
      return false
    } finally {
      setSubmitting(false)
    }
  }

  const submitAdjust = async () => {
    const value = feedback.trim()
    if (!value) {
      setError('请先写清要调整的方向')
      return
    }
    const ok = await run(() => decide?.({ callId, decision: 'adjust', feedback: value.slice(0, 2000), revision }))
    if (ok) setAdjusting(false)
  }

  const title = kind === 'search_unavailable' ? '深度研究：联网搜索不可用' : (plan?.title ?? '研究计划')

  return (
    <Section title="研究计划">
      <div className="rounded-lg border border-border bg-surface px-2.5 py-2">
        <p className="text-sm font-medium text-foreground [overflow-wrap:anywhere]">{title}</p>
        {kind === 'plan' && plan && (
          <p className="mt-0.5 text-caption text-muted-foreground [overflow-wrap:anywhere]">{plan.objective}</p>
        )}
        <ul className="mt-1.5 flex list-decimal flex-col gap-0.5 pl-4 text-caption text-muted-foreground">
          {(kind === 'plan' && plan ? plan.sub_questions : []).slice(0, 6).map((question, index) => (
            <li key={index} className="[overflow-wrap:anywhere]">{question.question}</li>
          ))}
        </ul>
        {kind === 'plan' && plan && plan.sub_questions.length > 6 && (
          <p className="mt-1 text-micro text-muted-foreground">
            其余 {plan.sub_questions.length - 6} 个子问题未在此展开
          </p>
        )}
        {decision && (
          <p className="mt-1.5 text-micro text-muted-foreground">
            审批结果：{DECISION_LABELS[decision] ?? decision}
          </p>
        )}

        {interactive && !adjusting && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {kind === 'plan' ? (
              <>
                <PlanButton
                  disabled={submitting}
                  onClick={() => void run(() => decide?.({ callId, decision: 'approve', revision }))}
                  icon={Check}
                >
                  批准计划
                </PlanButton>
                <PlanButton onClick={() => setAdjusting(true)} icon={Pencil}>调整计划</PlanButton>
              </>
            ) : (
              <PlanButton
                disabled={submitting}
                onClick={() => void run(() => decide?.({ callId, decision: 'continue', revision }))}
                icon={Play}
              >
                基于已有知识继续
              </PlanButton>
            )}
            <PlanButton
              muted
              disabled={submitting}
              onClick={() => void run(() => decide?.({ callId, decision: 'cancel', revision }))}
              icon={X}
            >
              取消
            </PlanButton>
          </div>
        )}

        {interactive && adjusting && (
          <div className="mt-2 flex flex-col gap-1.5">
            <label className="text-caption font-medium text-foreground" htmlFor={`adjust-${callId}`}>
              要调整的方向
            </label>
            <textarea
              id={`adjust-${callId}`}
              value={feedback}
              maxLength={2000}
              rows={3}
              onChange={(event) => setFeedback(event.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `adjust-error-${callId}` : undefined}
              className="w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-caption text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="例如：只保留政策与产业两条主线，补充地方落地数据"
            />
            <p className="text-micro text-muted-foreground">{feedback.length} / 2000</p>

            <div className="flex flex-wrap gap-1.5">
              <PlanButton onClick={() => void submitAdjust()} icon={Send} disabled={submitting}>
                {submitting ? '正在提交…' : '提交调整并重新生成计划'}
              </PlanButton>
              <PlanButton
                muted
                disabled={submitting}
                onClick={() => {
                  setAdjusting(false)
                  setError(null)
                }}
                icon={X}
              >
                取消调整
              </PlanButton>
            </div>
          </div>
        )}

        {(expired || aborted) && reissue && (
          <div className="mt-2 flex flex-col gap-1.5">
            <p className="text-micro text-muted-foreground">
              {expired ? '计划已过期，需要重新发起。' : '计划调用已中止，需要重新发起。'}
            </p>
            <div>
              <PlanButton
                onClick={() => reissue({ reason: expired ? 'expired' : 'aborted', planTitle: title })}
                icon={RotateCcw}
              >
                重新发起（使用原问题）
              </PlanButton>
            </div>
          </div>
        )}

        {error && (
          <p
            id={`adjust-error-${callId}`}
            role="alert"
            className="mt-1.5 rounded-lg border border-[hsl(var(--destructive)/0.3)] bg-[hsl(var(--destructive)/0.06)] px-2 py-1.5 text-micro text-destructive [overflow-wrap:anywhere]"
          >
            {error}
          </p>
        )}

        {pending && !canCommand && (
          <p className="mt-1.5 text-micro text-muted-foreground">计划待确认；当前视图为只读，不提供审批操作。</p>
        )}
        {pending && canCommand && !decide && (
          <p className="mt-1.5 text-micro text-muted-foreground">计划待确认；当前视图没有审批回调，无法在此批准。</p>
        )}
      </div>
    </Section>
  )
}

export function ResearchPlanSection(props: {
  record: ProcessRecord
  canCommand: boolean
  commands?: ProcessWorkspaceCommands
}) {
  return <ResearchPlan {...props} />
}

/** 详情里的分区外壳：标题 + 内容，保持各段一致。 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h4 className="text-caption font-medium text-foreground">{title}</h4>
      {children}
    </section>
  )
}

const DECISION_LABELS: Record<string, string> = {
  approve: '已批准',
  adjust: '已调整',
  cancel: '已取消',
  continue: '继续（基于已有知识）',
  expired: '已过期',
}

function PlanButton({
  children,
  onClick,
  icon: Icon,
  muted = false,
  disabled = false,
}: {
  children: React.ReactNode
  onClick: () => void
  icon: typeof Check
  muted?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-lg border border-border px-2.5 text-caption transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        muted
          ? 'text-muted-foreground hover:bg-surface-hover hover:text-foreground'
          : 'bg-surface font-medium text-foreground hover:bg-surface-hover',
      )}
    >
      <Icon aria-hidden className="h-3.5 w-3.5" />
      {children}
    </button>
  )
}
