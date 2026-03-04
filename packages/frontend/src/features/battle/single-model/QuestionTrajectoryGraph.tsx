'use client'

import { AlertTriangle, Check, Loader2, Scale, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export type SingleAttemptNodeStatus = 'pending' | 'running' | 'judging' | 'done' | 'judge_error' | 'error'

export interface SingleAttemptNodeView {
  attemptIndex: number
  status: SingleAttemptNodeStatus
  passed: boolean
  score?: number | null
  error?: string | null
}

export interface SingleQuestionTrajectoryView {
  questionIndex: number
  title: string
  passCount: number
  passK: number
  runsPerQuestion: number
  passed: boolean
  attempts: SingleAttemptNodeView[]
}

interface QuestionTrajectoryGraphProps {
  questions: SingleQuestionTrajectoryView[]
  selectedNodeKey?: string | null
  onNodeClick?: (questionIndex: number, attemptIndex: number) => void
  isRunning?: boolean
}

const statusLabel = (attempt: SingleAttemptNodeView) => {
  if (attempt.status === 'pending') return '待执行'
  if (attempt.status === 'running') return '运行中'
  if (attempt.status === 'judging') return '评测中'
  if (attempt.status === 'error') return '执行失败'
  if (attempt.status === 'judge_error') return '裁判异常'
  const scoreLabel = attempt.score != null ? attempt.score.toFixed(2) : '--'
  return attempt.passed ? `通过 ${scoreLabel}` : `未过 ${scoreLabel}`
}

const NodeIcon = ({ attempt }: { attempt: SingleAttemptNodeView }) => {
  if (attempt.status === 'running') return <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
  if (attempt.status === 'judging') return <Scale className="h-4 w-4" />
  if (attempt.status === 'pending') return <span className="h-2.5 w-2.5 rounded-full bg-current/50" />
  if (attempt.status === 'judge_error') return <AlertTriangle className="h-4 w-4" />
  if (attempt.status === 'done' && attempt.passed) return <Check className="h-4 w-4" />
  return <X className="h-4 w-4" />
}

const nodeToneClass = (attempt: SingleAttemptNodeView) => {
  if (attempt.status === 'running') return 'border-primary bg-primary/10 text-primary animate-pulse motion-reduce:animate-none'
  if (attempt.status === 'judging') return 'border-amber-500 bg-amber-500/10 text-amber-600 dark:text-amber-400'
  if (attempt.status === 'pending') return 'border-dashed border-muted-foreground/35 bg-muted/40 text-muted-foreground'
  if (attempt.status === 'done' && attempt.passed) return 'border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
  return 'border-destructive bg-destructive/10 text-destructive'
}

const connectorToneClass = (attempt: SingleAttemptNodeView, isRunning: boolean) => {
  if (attempt.status === 'running' || attempt.status === 'judging') {
    return isRunning ? 'bg-primary/80 animate-pulse motion-reduce:animate-none' : 'bg-primary/60'
  }
  if (attempt.status === 'done' && attempt.passed) return 'bg-emerald-500/70'
  if (attempt.status === 'error' || attempt.status === 'judge_error' || (attempt.status === 'done' && !attempt.passed)) {
    return 'bg-destructive/60'
  }
  return 'bg-border'
}

export function QuestionTrajectoryGraph({
  questions,
  selectedNodeKey,
  onNodeClick,
  isRunning = false,
}: QuestionTrajectoryGraphProps) {
  if (questions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
        暂无题目轨迹
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {questions.map((question) => (
        <div
          key={`trajectory-question-${question.questionIndex}`}
          className="rounded-xl border border-border/70 bg-[hsl(var(--surface))/0.42] p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{question.title}</div>
              <div className="text-xs text-muted-foreground">
                问题 {question.questionIndex} · PassK={question.passK}
              </div>
            </div>
            <Badge variant={question.passed ? 'default' : 'secondary'}>
              {question.passCount}/{question.runsPerQuestion} 通过
            </Badge>
          </div>

          <div className="mt-3 overflow-x-auto">
            <div className="flex min-w-max items-center gap-2 pb-1">
              {question.attempts.map((attempt, index) => {
                const key = `${question.questionIndex}#${attempt.attemptIndex}`
                const selected = selectedNodeKey === key
                return (
                  <div key={`trajectory-attempt-${key}`} className="flex items-center gap-2">
                    {index > 0 ? (
                      <div
                        className={cn(
                          'h-[2px] w-8 rounded-full transition-colors duration-300',
                          connectorToneClass(attempt, isRunning),
                        )}
                      />
                    ) : null}

                    <button
                      type="button"
                      className={cn(
                        'flex min-w-[122px] cursor-pointer flex-col items-start gap-1 rounded-xl border px-3 py-2 text-left transition-all duration-200',
                        'hover:border-primary/70 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
                        nodeToneClass(attempt),
                        selected && 'ring-2 ring-primary ring-offset-2',
                      )}
                      onClick={() => onNodeClick?.(question.questionIndex, attempt.attemptIndex)}
                      aria-label={`问题${question.questionIndex} 第${attempt.attemptIndex}次尝试`}
                    >
                      <div className="flex items-center gap-1.5 text-xs font-medium">
                        <NodeIcon attempt={attempt} />
                        <span>#{attempt.attemptIndex}</span>
                      </div>
                      <div className="line-clamp-1 text-[11px] opacity-90">{statusLabel(attempt)}</div>
                      {attempt.error ? (
                        <div className="line-clamp-1 text-[10px] opacity-80">{attempt.error}</div>
                      ) : null}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
