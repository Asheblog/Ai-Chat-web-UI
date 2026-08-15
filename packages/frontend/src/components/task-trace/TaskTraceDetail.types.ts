import type {
  LatexTraceEventRecord,
  LatexTraceSummary,
  TaskTraceEventRecord,
  TaskTraceSummary,
} from '@/types'

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
