import { StatisticsCard } from '../ui/StatisticsCard'
import { buildMonitorStats } from './single-model-dashboard'
import type { SingleQuestionTrajectoryView } from './QuestionTrajectoryGraph'
import type { QuestionDraft, SingleModelRunStatus } from './types'
import type { BattleRunSummary } from '@/types'

interface SingleModelBattleOverviewProps {
  selectedModelLabel: string | null
  selectedJudgeLabel: string | null
  questions: QuestionDraft[]
  questionViews: SingleQuestionTrajectoryView[]
  runStatus: SingleModelRunStatus
  summary: BattleRunSummary['summary'] | null
  computedStability: number
}

export function SingleModelBattleOverview({
  selectedModelLabel,
  selectedJudgeLabel,
  questions,
  questionViews,
  runStatus,
  summary,
  computedStability,
}: SingleModelBattleOverviewProps) {
  const stats = buildMonitorStats(questionViews, runStatus)
  const configuredAttempts = questions.reduce((total, question) => total + question.runsPerQuestion, 0)
  const readyCount = [selectedModelLabel, selectedJudgeLabel].filter(Boolean).length
  const stability = summary?.stabilityScore ?? computedStability
  const totalQuestions = summary?.totalQuestions ?? questions.length
  const passedQuestions = summary?.passedQuestions ?? stats.passedQuestions

  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <StatisticsCard
        label="模型配置"
        value={`${readyCount}/2 就绪`}
        subValue={readyCount === 2 ? `${selectedModelLabel} / ${selectedJudgeLabel}` : '先选择参赛模型与裁判模型'}
        icon="models"
        variant={readyCount === 2 ? 'success' : 'default'}
      />
      <StatisticsCard
        label="评测规模"
        value={`${questions.length} 题`}
        subValue={`计划执行 ${configuredAttempts} 次尝试`}
        icon="target"
        variant={questions.length > 0 ? 'default' : 'warning'}
      />
      <StatisticsCard
        label="运行进度"
        value={`${stats.completedAttempts}/${stats.totalAttempts || configuredAttempts}`}
        subValue={runStatus === 'running' || runStatus === 'pending' ? '实时更新中' : '等待开始'}
        icon="time"
        variant={runStatus === 'error' ? 'error' : runStatus === 'running' || runStatus === 'pending' ? 'warning' : 'default'}
        progress={stats.totalAttempts || configuredAttempts ? stats.progressPercent : 0}
      />
      <StatisticsCard
        label="稳定性"
        value={`${(stability * 100).toFixed(1)}%`}
        subValue={totalQuestions > 0 ? `${passedQuestions}/${totalQuestions} 题通过` : '等待结果'}
        icon="rate"
        variant={passedQuestions > 0 ? 'success' : 'default'}
      />
    </section>
  )
}
