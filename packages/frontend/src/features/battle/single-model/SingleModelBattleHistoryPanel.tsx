import { History, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDate } from '@/lib/utils'
import type { BattleRunSummary } from '@/types'
import { getVisibleHistoryItems } from './single-model-dashboard'

interface SingleModelBattleHistoryPanelProps {
  history: BattleRunSummary[]
  expanded: boolean
  historyLoading: boolean
  historyLoadingRunId: number | null
  isRunning: boolean
  onToggleExpanded: () => void
  onRefresh: () => void
  onViewRun: (runId: number) => void
  onReuseRun: (runId: number) => void
}

const toStatusLabel = (status: BattleRunSummary['status']) => {
  if (status === 'pending') return '排队中'
  if (status === 'running') return '运行中'
  if (status === 'completed') return '已完成'
  if (status === 'cancelled') return '已取消'
  if (status === 'error') return '失败'
  return '未开始'
}

export function SingleModelBattleHistoryPanel({
  history,
  expanded,
  historyLoading,
  historyLoadingRunId,
  isRunning,
  onToggleExpanded,
  onRefresh,
  onViewRun,
  onReuseRun,
}: SingleModelBattleHistoryPanelProps) {
  const visibleHistory = getVisibleHistoryItems(history, expanded)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-base"><History className="h-4 w-4" />最近历史</CardTitle>
          <CardDescription>默认仅展示最近 3 条，可展开全部历史</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={historyLoading || isRunning}>
          <RefreshCw className={`mr-2 h-4 w-4 ${historyLoading ? 'animate-spin' : ''}`} />
          刷新
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {visibleHistory.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">暂无单模型多问题历史记录</div>
        ) : (
          visibleHistory.map((item) => (
            <div key={item.id} className="rounded-lg border border-border/70 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-sm font-medium">{item.title || `任务 #${item.id}`}</div>
                  <div className="text-xs text-muted-foreground">#{item.id} · {formatDate(item.createdAt)}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={item.status === 'completed' ? 'default' : item.status === 'error' ? 'destructive' : 'secondary'}>
                    {toStatusLabel(item.status)}
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onViewRun(item.id)}
                    disabled={isRunning || historyLoadingRunId === item.id}
                  >
                    查看记录
                  </Button>
                  <Button size="sm" onClick={() => onReuseRun(item.id)} disabled={isRunning || historyLoadingRunId === item.id}>
                    复用为新任务
                  </Button>
                </div>
              </div>
            </div>
          ))
        )}

        {history.length > 3 ? (
          <Button variant="ghost" size="sm" onClick={onToggleExpanded} className="px-0 text-sm text-muted-foreground hover:text-foreground">
            {expanded ? '收起历史' : '展开全部历史'}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}
