import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import type { LatexTraceEventRecord, TaskTraceEventRecord } from '@/types'
import { statusLabels, formatDateTime, formatDuration } from './TaskTraceConsole.utils'
import type { TaskTraceDetailDialogProps } from './TaskTraceDetailDialog'
import type { FC } from 'react'

export const TraceMetaSection: FC<{
  detail: NonNullable<TaskTraceDetailDialogProps['detail']>
}> = ({ detail }) => (
  <>
    <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
      <MetaItem label="会话" value={detail.trace.sessionId ?? '-'} />
      <MetaItem label="Actor" value={detail.trace.actor} muted />
      <div>
        <span className="text-muted-foreground">状态：</span>
        <Badge
          variant={
            detail.trace.status === 'completed'
              ? 'default'
              : detail.trace.status === 'error'
                ? 'destructive'
                : 'secondary'
          }
          className="ml-2"
        >
          {statusLabels[detail.trace.status] ?? detail.trace.status}
        </Badge>
      </div>
      <MetaItem
        label="开始"
        value={formatDateTime(detail.trace.startedAt)}
        muted
      />
      <MetaItem
        label="结束"
        value={formatDateTime(detail.trace.endedAt)}
        muted
      />
      <MetaItem label="耗时" value={formatDuration(detail.trace.durationMs)} />
    </div>
    <div className="text-sm text-muted-foreground">
      LaTeX 日志：
      {detail.latexTrace
        ? `${detail.latexTrace.matchedBlocks} / ${detail.latexTrace.unmatchedBlocks}`
        : '未记录'}
    </div>
  </>
)

export const TraceTabs: FC<{
  activeTab: 'trace' | 'latex'
  hasLatex: boolean
  onTabChange: (tab: 'trace' | 'latex') => void
  onExportTrace: () => void
  onExportLatex: () => void
  onDeleteLatex: () => void
}> = ({
  activeTab,
  hasLatex,
  onTabChange,
  onExportTrace,
  onExportLatex,
  onDeleteLatex,
}) => (
  <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={activeTab === 'trace' ? 'default' : 'outline'}
          onClick={() => onTabChange('trace')}
        >
          主日志
        </Button>
        <Button
          size="sm"
          variant={activeTab === 'latex' ? 'default' : 'outline'}
          disabled={!hasLatex}
          onClick={() => onTabChange('latex')}
        >
          LaTeX 日志
        </Button>
      </div>
      <div className="ml-auto flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={onExportTrace}>
          导出主日志
        </Button>
        {hasLatex && (
          <>
            <Button variant="outline" size="sm" onClick={onExportLatex}>
              导出 LaTeX
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={onDeleteLatex}
            >
              删除 LaTeX
            </Button>
          </>
        )}
      </div>
    </div>
  </div>
)

export const TraceEvents: FC<{
  events: TaskTraceEventRecord[]
  truncated: boolean
}> = ({ events, truncated }) => (
  <ScrollArea className="h-[50vh] rounded-xl border bg-muted/30 p-4">
    <div className="space-y-3">
      {events.map((evt) => (
        <div
          key={evt.id}
          className="rounded-lg border bg-card p-3 transition-all hover:shadow-sm"
        >
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-mono">#{evt.seq}</span>
            <span>{formatDateTime(evt.timestamp)}</span>
          </div>
          <div className="mt-1 font-semibold text-sm">{evt.eventType}</div>
          <pre className="mt-2 overflow-x-auto rounded bg-muted/50 p-2 text-xs font-mono">
            {JSON.stringify(evt.payload ?? {}, null, 2)}
          </pre>
        </div>
      ))}
      {events.length === 0 && (
        <div className="py-8 text-center text-sm text-muted-foreground">
          暂无事件
        </div>
      )}
      {truncated && (
        <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 px-3 py-2 text-xs text-yellow-700 dark:text-yellow-400">
          ⚠️ 仅显示前 2000 条事件，完整记录请使用导出功能
        </div>
      )}
    </div>
  </ScrollArea>
)

export const LatexEvents: FC<{
  events: LatexTraceEventRecord[]
  truncated: boolean
  loading: boolean
}> = ({ events, truncated, loading }) => (
  <ScrollArea className="h-[50vh] rounded-xl border bg-muted/30 p-4">
    {loading && <Skeleton className="h-16 w-full" />}
    {!loading && (
      <div className="space-y-3">
        {events.map((evt) => (
          <div
            key={evt.seq}
            className="rounded-lg border bg-card p-3 transition-all hover:shadow-sm"
          >
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-mono">#{evt.seq}</span>
              <Badge variant={evt.matched ? 'default' : 'secondary'}>
                {evt.matched ? '命中' : '未匹配'}
              </Badge>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">原因：{evt.reason}</div>
            <div className="mt-2 text-xs font-semibold">原始：</div>
            <pre className="mb-2 mt-1 overflow-x-auto rounded bg-muted/40 p-2 text-xs font-mono">
              {evt.raw}
            </pre>
            <div className="text-xs font-semibold">转换：</div>
            <pre className="mt-1 overflow-x-auto rounded bg-muted/40 p-2 text-xs font-mono">
              {evt.normalized}
            </pre>
          </div>
        ))}
        {events.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            暂无 LaTeX 记录
          </div>
        )}
        {truncated && (
          <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 px-3 py-2 text-xs text-yellow-700 dark:text-yellow-400">
            ⚠️ 内容较多，仅展示部分段落
          </div>
        )}
      </div>
    )}
  </ScrollArea>
)

const MetaItem: FC<{ label: string; value: string | number | null; muted?: boolean }> = ({
  label,
  value,
  muted,
}) => (
  <div className={`truncate ${muted ? 'text-xs' : ''}`}>
    <span className="text-muted-foreground">{label}：</span>
    <span className={muted ? 'text-xs' : ''}>{value}</span>
  </div>
)
