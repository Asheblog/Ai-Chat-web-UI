import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { TraceMetaSection, TraceTabs, TraceEvents, LatexEvents } from './TaskTraceDetailSections'
import type { FC } from 'react'
import type { TaskTraceDetailDialogProps } from './TaskTraceDetail.types'

export type { TaskTraceDetailDialogProps } from './TaskTraceDetail.types'

export const TaskTraceDetailDialog: FC<TaskTraceDetailDialogProps> = ({
  open,
  selected,
  detail,
  detailLoading,
  detailTab,
  onTabChange,
  onClose,
  onExportTrace,
  onExportLatex,
  onDeleteLatex,
  onEnsureLatexEvents,
  latexEvents,
  latexTruncated,
  latexLoading,
}) => {
  const traceId = detail?.trace.id ?? selected?.id

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-4xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>追踪详情 #{traceId}</DialogTitle>
          <DialogDescription>查看该任务的执行状态、事件和耗时。</DialogDescription>
        </DialogHeader>
        {detailLoading && <div role="status" className="h-24 w-full animate-pulse rounded-lg bg-surface-subtle p-4 text-sm text-muted-foreground motion-reduce:animate-none">正在加载追踪详情…</div>}
        {!detailLoading && !detail && <div role="status" className="rounded-lg border border-border bg-surface-subtle p-5 text-sm leading-relaxed text-muted-foreground">详情未加载，请关闭后重新打开该记录。</div>}
        {!detailLoading && detail && (
          <div className="min-h-0 space-y-4 overflow-y-auto [overflow-wrap:anywhere]">
            <TraceMetaSection detail={detail} />
            <TraceTabs
              activeTab={detailTab}
              hasLatex={Boolean(detail.latexTrace)}
              onTabChange={(tab) => {
                onTabChange(tab)
                if (
                  tab === 'latex' &&
                  detail.latexTrace &&
                  latexEvents.length === 0 &&
                  !latexLoading
                ) {
                  onEnsureLatexEvents(detail.trace.id)
                }
              }}
              onExportTrace={() => onExportTrace(detail.trace.id)}
              onExportLatex={() => onExportLatex(detail.trace.id)}
              onDeleteLatex={() => onDeleteLatex(detail.trace.id)}
            />
            {detailTab === 'trace' && (
              <TraceEvents events={detail.events} truncated={detail.truncated} />
            )}
            {detailTab === 'latex' && detail.latexTrace && (
              <LatexEvents
                events={latexEvents}
                truncated={latexTruncated}
                loading={latexLoading}
              />
            )}
            {detailTab === 'latex' && !detail.latexTrace && (
              <div className="rounded-xl border border-dashed py-8 text-center text-sm text-muted-foreground">
                该任务未记录 LaTeX 日志
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
