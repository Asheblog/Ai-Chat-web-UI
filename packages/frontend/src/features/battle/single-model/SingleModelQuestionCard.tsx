import { Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { QuestionDraft } from './types'

interface SingleModelQuestionCardProps {
  question: QuestionDraft
  index: number
  totalQuestions: number
  isRunning: boolean
  onRemoveQuestion: (localId: string) => void
  onUpdateQuestion: (localId: string, updater: (current: QuestionDraft) => QuestionDraft) => void
}

export function SingleModelQuestionCard({
  question,
  index,
  totalQuestions,
  isRunning,
  onRemoveQuestion,
  onUpdateQuestion,
}: SingleModelQuestionCardProps) {
  return (
    <div className="rounded-2xl border border-border/70 bg-[hsl(var(--surface))/0.36] p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{question.title.trim() || `题目 ${index + 1}`}</h3>
            <Badge variant="outline">runs {question.runsPerQuestion}</Badge>
            <Badge variant="outline">pass {question.passK}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">题号、元信息、题目正文与期望答案分层展示，减少长表单压迫感。</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => onRemoveQuestion(question.localId)} disabled={isRunning || totalQuestions <= 1}>
          <Trash2 className="mr-1 h-4 w-4" />删除
        </Button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Question ID（可选）</Label>
          <Input
            value={question.questionId}
            onChange={(e) => onUpdateQuestion(question.localId, (current) => ({ ...current, questionId: e.target.value }))}
            disabled={isRunning}
          />
        </div>
        <div className="space-y-2">
          <Label>标题（可选）</Label>
          <Input
            value={question.title}
            onChange={(e) => onUpdateQuestion(question.localId, (current) => ({ ...current, title: e.target.value }))}
            disabled={isRunning}
          />
        </div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-2">
        <div className="space-y-2">
          <Label>题目</Label>
          <Textarea
            rows={5}
            value={question.prompt}
            onChange={(e) => onUpdateQuestion(question.localId, (current) => ({ ...current, prompt: e.target.value }))}
            disabled={isRunning}
          />
        </div>
        <div className="space-y-2">
          <Label>期望答案</Label>
          <Textarea
            rows={5}
            value={question.expectedAnswer}
            onChange={(e) => onUpdateQuestion(question.localId, (current) => ({ ...current, expectedAnswer: e.target.value }))}
            disabled={isRunning}
          />
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:max-w-[420px]">
        <div className="space-y-2">
          <Label>Runs (1-3)</Label>
          <Input
            value={String(question.runsPerQuestion)}
            onChange={(e) => {
              const parsed = Number.parseInt(e.target.value, 10)
              const runs = Number.isFinite(parsed) ? Math.min(3, Math.max(1, parsed)) : question.runsPerQuestion
              onUpdateQuestion(question.localId, (current) => ({
                ...current,
                runsPerQuestion: runs,
                passK: Math.min(current.passK, runs),
              }))
            }}
            disabled={isRunning}
          />
        </div>
        <div className="space-y-2">
          <Label>Pass K (1-3)</Label>
          <Input
            value={String(question.passK)}
            onChange={(e) => {
              const parsed = Number.parseInt(e.target.value, 10)
              const passK = Number.isFinite(parsed) ? Math.min(3, Math.max(1, parsed)) : question.passK
              onUpdateQuestion(question.localId, (current) => ({
                ...current,
                passK: Math.min(passK, current.runsPerQuestion),
              }))
            }}
            disabled={isRunning}
          />
        </div>
      </div>
    </div>
  )
}
