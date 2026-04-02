import { ListChecks, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { QuestionDraft } from './types'
import { SingleModelQuestionCard } from './SingleModelQuestionCard'

interface SingleModelQuestionWorkspaceProps {
  questions: QuestionDraft[]
  isRunning: boolean
  onAddQuestion: () => void
  onRemoveQuestion: (localId: string) => void
  onUpdateQuestion: (localId: string, updater: (current: QuestionDraft) => QuestionDraft) => void
}

export function SingleModelQuestionWorkspace({
  questions,
  isRunning,
  onAddQuestion,
  onRemoveQuestion,
  onUpdateQuestion,
}: SingleModelQuestionWorkspaceProps) {
  return (
    <Card className="rounded-3xl border-border/70 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg"><ListChecks className="h-5 w-5" />Step 2. 题目工作区</CardTitle>
          <CardDescription>每题独立设置 runs 与 passK，默认保持结构清晰，便于批量扫描。</CardDescription>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="secondary">{questions.length} 题</Badge>
          <Button variant="outline" onClick={onAddQuestion} disabled={isRunning || questions.length >= 50}>
            <Plus className="mr-2 h-4 w-4" />新增题目
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {questions.map((question, idx) => (
          <SingleModelQuestionCard
            key={question.localId}
            question={question}
            index={idx}
            totalQuestions={questions.length}
            isRunning={isRunning}
            onRemoveQuestion={onRemoveQuestion}
            onUpdateQuestion={onUpdateQuestion}
          />
        ))}
      </CardContent>
    </Card>
  )
}
