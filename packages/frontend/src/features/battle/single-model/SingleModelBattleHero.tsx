import Link from 'next/link'
import { ArrowLeft, Copy, Play, RefreshCw, Share2, Square } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { SingleModelRunStatus } from './types'

interface SingleModelBattleHeroProps {
  runId: number | null
  runStatus: SingleModelRunStatus
  isRunning: boolean
  sharing: boolean
  shareLink: string | null
  copiedShareLink: boolean
  sourceRunId: number | null
  error: string | null
  onStart: () => void
  onCancel: () => void
  onNewTask: () => void
  onShare: () => void
  onCopyShareLink: () => void
}

const statusLabel = (runStatus: SingleModelRunStatus) => {
  if (runStatus === 'pending') return '排队中'
  if (runStatus === 'running') return '运行中'
  if (runStatus === 'completed') return '已完成'
  if (runStatus === 'cancelled') return '已取消'
  if (runStatus === 'error') return '失败'
  return '未开始'
}

const statusVariant = (runStatus: SingleModelRunStatus): 'default' | 'secondary' | 'destructive' => {
  if (runStatus === 'running' || runStatus === 'pending' || runStatus === 'completed') return 'default'
  if (runStatus === 'error') return 'destructive'
  return 'secondary'
}

export function SingleModelBattleHero({
  runId,
  runStatus,
  isRunning,
  sharing,
  shareLink,
  copiedShareLink,
  sourceRunId,
  error,
  onStart,
  onCancel,
  onNewTask,
  onShare,
  onCopyShareLink,
}: SingleModelBattleHeroProps) {
  return (
    <section className="rounded-[28px] border border-slate-800/70 bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.18),transparent_28%),linear-gradient(135deg,#020617_0%,#0f172a_55%,#111827_100%)] p-5 text-slate-50 shadow-[0_24px_80px_rgba(2,6,23,0.38)] md:p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <Link href="/main/battle" className="inline-flex items-center text-sm text-slate-300 transition-colors hover:text-white">
            <ArrowLeft className="mr-1 h-4 w-4" />
            返回模式选择
          </Link>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-white md:text-3xl">单模型多问题大乱斗</h1>
              <Badge variant={statusVariant(runStatus)}>{statusLabel(runStatus)}</Badge>
              {runId ? <Badge variant="secondary">任务 #{runId}</Badge> : null}
            </div>
            <p className="max-w-3xl text-sm text-slate-300 md:text-[15px]">
              先选模型，再配题，再开跑。左侧负责配置，右侧实时观测运行进度与稳定性结果。
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 lg:justify-end">
          <Button onClick={onStart} disabled={isRunning} className="gap-2 bg-emerald-500 text-slate-950 hover:bg-emerald-400">
            <Play className="h-4 w-4" />开始评测
          </Button>
          <Button variant="outline" onClick={onCancel} disabled={!runId || (runStatus !== 'running' && runStatus !== 'pending')} className="gap-2 border-slate-700 bg-slate-950/30 text-slate-100 hover:bg-slate-900">
            <Square className="h-4 w-4" />取消
          </Button>
          <Button variant="outline" onClick={onNewTask} disabled={isRunning} className="gap-2 border-slate-700 bg-slate-950/30 text-slate-100 hover:bg-slate-900">
            <RefreshCw className="h-4 w-4" />新任务
          </Button>
          <Button variant="outline" onClick={onShare} disabled={!runId || sharing} className="gap-2 border-slate-700 bg-slate-950/30 text-slate-100 hover:bg-slate-900">
            <Share2 className="h-4 w-4" />{sharing ? '生成中...' : '分享'}
          </Button>
        </div>
      </div>

      {sourceRunId ? (
        <div className="mt-4 rounded-2xl border border-slate-700/80 bg-slate-950/35 px-4 py-3 text-sm text-slate-300">
          已加载历史记录 #{sourceRunId} 的模型配置与题目。点击“新任务”可清空执行结果并直接重跑。
        </div>
      ) : null}

      {shareLink ? (
        <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0 text-sm text-emerald-50">
            <span className="font-medium">分享链接：</span>
            <a className="ml-1 break-all underline-offset-4 hover:underline" href={shareLink} target="_blank" rel="noreferrer">
              {shareLink}
            </a>
          </div>
          <Button variant="secondary" size="sm" onClick={onCopyShareLink} className="gap-2 self-start md:self-auto">
            <Copy className="h-4 w-4" />{copiedShareLink ? '已复制' : '复制链接'}
          </Button>
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive" className="mt-4 border-red-500/40 bg-red-950/35 text-red-100 [&>svg]:text-red-300">
          <AlertTitle>执行异常</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </section>
  )
}
