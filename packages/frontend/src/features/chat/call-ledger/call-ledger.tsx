'use client'

import { useId, useMemo, useState } from 'react'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import type { CallLedgerProps } from '@/features/chat/process-workspace/types'
import {
  buildProcessIndex,
  buildProcessRows,
  buildProcessSummary,
  groupProcessAnomalies,
  type ProcessRecord,
} from '@/features/chat/process-workspace/model/process-model'
import { describeProcessRecord } from '@/features/chat/process-workspace/model/record-display'
import { formatClockTime } from '@/features/chat/process-workspace/model/scope'
import {
  ProcessCoverageNotices,
  ProcessEmptyState,
  ProcessObservationWindow,
} from '@/features/chat/process-workspace/views/notices'
import {
  ProcessChip,
  ProcessRelationChip,
  ProcessStatusChip,
} from '@/features/chat/process-workspace/views/status'
import { ProcessOperationDetail } from '@/features/chat/process-workspace/views/operation-detail'
import { EMPTY_PROCESS_FILTER } from '@/features/chat/process-workspace/model/derived-views'
import { LedgerToolbar, type LedgerFilter } from './ledger-toolbar'

const PAGE_SIZE = 50

const EMPTY_LEDGER_FILTER: LedgerFilter = { ...EMPTY_PROCESS_FILTER, tool: 'all' }

/**
 * 全宽调用台账：当前消息的完整调用视图（不是全局 task-trace 诊断页）。
 * 默认关闭时由面板打开；Esc / 遮罩 / "返回回答" 都回到回答原阅读位置。
 */
export function CallLedger({ meta, toolEvents, coverage, readOnly = false, onReturn, className }: CallLedgerProps) {
  const [filter, setFilter] = useState<LedgerFilter>(EMPTY_LEDGER_FILTER)
  const [visible, setVisible] = useState(PAGE_SIZE)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const tableId = useId()

  const index = useMemo(() => buildProcessIndex({ events: toolEvents ?? [], coverage }), [toolEvents, coverage])
  const summary = useMemo(() => buildProcessSummary(index), [index])
  const anomalies = useMemo(() => groupProcessAnomalies(index), [index])
  const anomalyCount = useMemo(() => new Set(anomalies.flatMap((group) => group.ids)).size, [anomalies])

  const toolOptions = useMemo(
    () => Array.from(new Set(index.records.map((record) => record.identifier ?? record.tool))).sort(),
    [index.records],
  )

  // 工具筛选在行层做：命中子任务保留父链作为上下文行，不再伪造"只剩 records"的中间 index。
  const rows = useMemo(() => buildProcessRows(index, filter), [index, filter])
  const matchedRows = useMemo(() => rows.filter((row) => !row.context), [rows])
  const contextRows = rows.length - matchedRows.length
  const shown = rows.slice(0, visible)
  const remaining = rows.length - shown.length

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onReturn?.() }}>
      <DialogContent
        className={cn(
          'flex h-[min(880px,calc(100dvh-2rem))] w-[min(1120px,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0',
          className,
        )}
        aria-describedby={undefined}
      >
        <header className="flex items-start gap-3 border-b border-border px-5 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-title-m">本轮调用台账</h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-micro text-muted-foreground">
              <span className="num-tabular">
                {summary.totalOperations} 条唯一记录 · {summary.parentCalls} 个父调用 · {summary.subtasks} 个子任务
              </span>
              <span aria-hidden>·</span>
              <ProcessObservationWindow coverage={index.coverage} />
              {readOnly && <ProcessChip>只读</ProcessChip>}
            </div>
          </div>
          <button
            type="button"
            onClick={onReturn}
            className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-border px-2.5 text-caption text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
            返回回答
          </button>
        </header>

        <div className="flex flex-col gap-2 px-5 pt-3">
          <ProcessCoverageNotices coverage={index.coverage} />
          <LedgerToolbar
            filter={filter}
            onChange={(next) => {
              setFilter(next)
              setVisible(PAGE_SIZE)
            }}
            toolOptions={toolOptions}
            anomalyCount={anomalyCount}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
          {rows.length === 0 ? (
            <ProcessEmptyState
              title={index.records.length === 0 ? '本轮没有工具调用记录' : '没有匹配的调用'}
              hint={index.records.length === 0 ? '只有模型直接作答时台账为空，不补造记录。' : '换个关键词或清掉筛选条件再试。'}
            />
          ) : (
            <table id={tableId} className="w-full border-collapse text-left text-caption">
              <caption className="sr-only">
            本轮工具调用台账，共 {rows.length} 行，命中 {matchedRows.length} 条
            {contextRows > 0 ? `，${contextRows} 行仅为父调用上下文` : ''}
          </caption>
              <thead>
                <tr className="border-b border-border text-micro text-muted-foreground">
                  <th scope="col" className="py-2 pr-2 font-medium">任务 / 调用</th>
                  <th scope="col" className="w-32 py-2 pr-2 font-medium">状态</th>
                  <th scope="col" className="w-40 py-2 pr-2 font-medium">来源 / 工具</th>
                  <th scope="col" className="w-24 py-2 font-medium">记录时间</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => {
                  const expanded = expandedId === row.id
                  const label = describeProcessRecord(row.record)
                  return (
                    <LedgerRow
                      key={row.id}
                      row={row}
                      label={label}
                      expanded={expanded}
                      onToggle={() => setExpandedId(expanded ? null : row.id)}
                      readOnly={readOnly}
                    />
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-2 text-micro text-muted-foreground">
          <span className="num-tabular">
            已展示 {shown.length} / {rows.length} 行
            {summary.duplicateCount > 0 ? ` · 合并 ${summary.duplicateCount} 条重复事件` : ''}
            {contextRows > 0 ? ` · 其中 ${contextRows} 行为父调用上下文` : ''}
            {summary.orphans > 0 ? ` · 归属未知 ${summary.orphans}` : ''}
            {summary.ambiguous > 0 ? ` · 父调用歧义 ${summary.ambiguous}` : ''}
          </span>
          {remaining > 0 && (
            <button
              type="button"
              onClick={() => setVisible((current) => current + PAGE_SIZE)}
              className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-border px-2.5 text-caption text-foreground transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              展开更多（还有 {remaining} 行）
            </button>
          )}
        </footer>
      </DialogContent>
    </Dialog>
  )
}

function LedgerRow({
  row,
  label,
  expanded,
  onToggle,
  readOnly,
}: {
  row: ReturnType<typeof buildProcessRows>[number]
  label: ReturnType<typeof describeProcessRecord>
  expanded: boolean
  onToggle: () => void
  readOnly: boolean
}) {
  const record: ProcessRecord = row.record
  const time = formatClockTime(
    typeof record.event.updatedAt === 'number' ? record.event.updatedAt : record.event.createdAt,
  )
  return (
    <>
      <tr className="border-b border-border/70 align-top transition-colors hover:bg-surface-hover">
        <td className="py-1.5 pr-2">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className="flex min-h-11 w-full cursor-pointer items-start gap-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            style={row.depth > 0 ? { paddingLeft: row.depth * 12 } : undefined}
          >
            <ChevronRight
              aria-hidden
              className={cn(
                'mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none',
                expanded && 'rotate-90',
              )}
            />
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-foreground [overflow-wrap:anywhere]">{label.title}</span>
              <span className="mt-0.5 flex flex-wrap items-center gap-1">
                {row.context && <ProcessChip>上下文（父调用）</ProcessChip>}
                <ProcessRelationChip record={record} />
                {record.degraded && <ProcessChip tone="warning">降级</ProcessChip>}
                {record.childIds.length > 0 && <ProcessChip>{record.childIds.length} 个子任务</ProcessChip>}
              </span>
            </span>
          </button>
        </td>
        <td className="py-2 pr-2"><ProcessStatusChip record={record} /></td>
        <td className="py-2 pr-2 text-muted-foreground [overflow-wrap:anywhere]">
          {record.source ? <span className="mr-1">{record.source}</span> : null}
          {record.identifier ?? record.tool}
        </td>
        <td className="num-tabular py-2 text-muted-foreground">{time || '—'}</td>
      </tr>
      {expanded && (
        <tr className="border-b border-border/70">
          <td colSpan={4} className="bg-surface-subtle/40">
            <ProcessOperationDetail record={record} canCommand={false} commands={undefined} />
            {readOnly && <span className="sr-only">只读视图</span>}
          </td>
        </tr>
      )}
    </>
  )
}
