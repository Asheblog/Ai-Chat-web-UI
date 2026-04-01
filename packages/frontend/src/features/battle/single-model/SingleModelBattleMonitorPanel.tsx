import { Activity, Clock3, ListTodo, TimerReset } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { buildMonitorStats } from './single-model-dashboard'
import type { SingleQuestionTrajectoryView } from './QuestionTrajectoryGraph'
import type { SingleModelRunStatus } from './types'

interface SingleModelBattleMonitorPanelProps {
  runId: number | null
  runStatus: SingleModelRunStatus
  error: string | null
  questionViews: SingleQuestionTrajectoryView[]
}

const statusLabel = (runStatus: SingleModelRunStatus) => {
  if (runStatus === 'pending') return '排队中'
  if (runStatus === 'running') return '运行中'
  if (runStatus === 'completed') return '已完成'
  if (runStatus === 'cancelled') return '已取消'
  if (runStatus === 'error') return '失败'
  return '未开始'
}

export function SingleModelBattleMonitorPanel({ runId, runStatus, error, questionViews }: SingleModelBattleMonitorPanelProps) {
  const stats = buildMonitorStats(questionViews, runStatus)

  return (
    <Card className="rounded-3xl border-slate-800/70 bg-slate-950 text-slate-50 shadow-[0_20px_60px_rgba(2,6,23,0.3)]">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5" />运行观测台</CardTitle>
            <CardDescription className="text-slate-300">回答“现在跑到哪里了”，并把关键状态固定在视线里。</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={runStatus === 'error' ? 'destructive' : runStatus === 'running' || runStatus === 'pending' ? 'default' : 'secondary'}>
              {statusLabel(runStatus)}
            </Badge>
            {runId ? <Badge variant="secondary">任务 #{runId}</Badge> : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive" className="border-red-500/40 bg-red-950/35 text-red-100 [&>svg]:text-red-300">
            <AlertTitle>运行异常</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900/65 p-4">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-slate-300">总进度</span>
            <span className="font-medium text-white">{stats.completedAttempts}/{stats.totalAttempts}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-800">
            <div className="h-full rounded-full bg-emerald-400 transition-all duration-300" style={{ width: `${Math.min(100, Math.max(0, stats.progressPercent))}%` }} />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/65 p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-400"><TimerReset className="h-4 w-4" />进行中</div>
            <div className="mt-2 text-2xl font-semibold text-white">{stats.activeAttempts}</div>
            <div className="mt-1 text-xs text-slate-400">正在生成或评测的尝试数</div>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/65 p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-400"><Clock3 className="h-4 w-4" />待执行</div>
            <div className="mt-2 text-2xl font-semibold text-white">{stats.pendingAttempts}</div>
            <div className="mt-1 text-xs text-slate-400">尚未启动的尝试数</div>
          </div>
        </div>

        <Separator className="bg-slate-800" />

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-emerald-200"><ListTodo className="h-4 w-4" />已通过题目</div>
            <div className="mt-2 text-2xl font-semibold text-white">{stats.passedQuestions}</div>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/65 p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-400"><ListTodo className="h-4 w-4" />当前未达标</div>
            <div className="mt-2 text-2xl font-semibold text-white">{stats.failedQuestions}</div>
          </div>
        </div>

        {runId == null && runStatus === 'idle' ? (
          <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-4 text-sm text-slate-300">
            配置完成后点击“开始评测”。运行进度、当前状态和关键统计会在这里实时更新。
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
