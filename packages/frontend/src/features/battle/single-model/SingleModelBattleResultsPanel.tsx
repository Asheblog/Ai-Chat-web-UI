import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { BattleRunSummary } from '@/types'
import { QuestionTrajectoryGraph, type SingleQuestionTrajectoryView } from './QuestionTrajectoryGraph'

interface SingleModelBattleResultsPanelProps {
  runId: number | null
  isRunning: boolean
  summary: BattleRunSummary['summary'] | null
  computedStability: number
  questionViews: SingleQuestionTrajectoryView[]
  selectedNodeKey: string | null
  onNodeClick: (questionIndex: number, attemptIndex: number) => void
}

export function SingleModelBattleResultsPanel({
  runId,
  isRunning,
  summary,
  computedStability,
  questionViews,
  selectedNodeKey,
  onNodeClick,
}: SingleModelBattleResultsPanelProps) {
  const stability = summary?.stabilityScore ?? computedStability
  const passedQuestions = summary?.passedQuestions ?? questionViews.filter((item) => item.passed).length
  const totalQuestions = summary?.totalQuestions ?? questionViews.length

  return (
    <Card className="border-slate-800/70 bg-slate-950 text-slate-50 shadow-[0_20px_60px_rgba(2,6,23,0.35)]">
      <CardHeader>
        <CardTitle>问题轨迹与结果</CardTitle>
        <CardDescription className="text-slate-300">
          稳定性 {(stability * 100).toFixed(1)}%
          {totalQuestions > 0 ? ` · ${passedQuestions}/${totalQuestions} 题通过` : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {runId == null && !isRunning ? (
          <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 p-6 text-sm text-slate-300">
            <p className="font-medium text-slate-100">运行结果将在这里出现</p>
            <p className="mt-2 text-slate-400">先选择参赛模型和裁判模型，填写至少一道题目与期望答案，然后点击“开始评测”。</p>
          </div>
        ) : (
          <>
            <p className="text-xs text-slate-400">轨迹节点可点击，弹窗会展示实时输出、推理过程与裁判结果。</p>
            <QuestionTrajectoryGraph
              questions={questionViews}
              selectedNodeKey={selectedNodeKey}
              onNodeClick={onNodeClick}
              isRunning={isRunning}
            />
          </>
        )}
      </CardContent>
    </Card>
  )
}
