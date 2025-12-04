import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type {
  LatexTraceEventRecord,
  LatexTraceSummary,
  TaskTraceEventRecord,
  TaskTraceSummary,
} from '@/types'
import { TraceMetaSection, TraceTabs, TraceEvents, LatexEvents } from './TaskTraceDetailSections'
import type { FC } from 'react'

export type TaskTraceDetailDialogProps = {
  open: boolean
  selected: TaskTraceSummary | null
  detail: {
    trace: TaskTraceSummary
    latexTrace: LatexTraceSummary | null
    events: TaskTraceEventRecord[]
    truncated: boolean
  } | null
  detailLoading: boolean
  detailTab: 'trace' | 'latex'
  onTabChange: (tab: 'trace' | 'latex') => void
  onClose: () => void
  onExportTrace: (traceId: number) => void
  onExportLatex: (traceId: number) => void
  onDeleteLatex: (traceId: number) => void
  onEnsureLatexEvents: (traceId: number) => void
  latexEvents: LatexTraceEventRecord[]
  latexTruncated: boolean
  latexLoading: boolean
}

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
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>追踪详情 #{traceId}</DialogTitle>
        </DialogHeader>
        {detailLoading && <div className="h-24 w-full animate-pulse rounded-xl bg-muted/30" />}
        {!detailLoading && detail && (
          <div className="space-y-4 overflow-y-auto">
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
