'use client'

import { useMemo, useState } from 'react'
import { ListTree } from 'lucide-react'
import {
  EMPTY_PROCESS_FILTER,
  buildProcessRows,
  groupProcessRows,
  type ProcessAnomalyGroup,
  type ProcessFilter,
  type ProcessIndex,
  type ProcessStatusFilter,
  type ProcessSummary,
} from '../model/process-model'
import { ProcessOperationRow } from './operation-row'
import { ProcessReasoningSection } from './reasoning-section'
import { ProcessToolbar } from './process-toolbar'
import { ProcessChip } from './status'
import { ProcessEmptyState } from './notices'
import type { ProcessSnapshot, ProcessWorkspaceCommands } from '../types'

/** 首屏父调用条数：Trace97 这类数百调用不一次铺满，其余用"显示其余"按原顺序补。 */
const INITIAL_PARENT_ROWS = 50

interface ProcessTabProps {
  snapshot: ProcessSnapshot
  scopeKey: string
  index: ProcessIndex
  summary: ProcessSummary
  anomalies: ProcessAnomalyGroup[]
  expandAll: boolean
  canCommand: boolean
  commands?: ProcessWorkspaceCommands
  onOpenLedger: () => void
}

const ANOMALY_TONE: Record<string, 'warning' | 'danger'> = {
  failed: 'danger',
  rejected: 'warning',
  aborted: 'warning',
  degraded: 'warning',
  orphan: 'warning',
  ambiguous: 'warning',
}

/** 过程页签：摘要 → 异常分组 → 推理摘要 → 调用树（父调用与子任务分开表达）。 */
export function ProcessProcessTab({
  snapshot,
  scopeKey,
  index,
  summary,
  anomalies,
  expandAll,
  canCommand,
  commands,
  onOpenLedger,
}: ProcessTabProps) {
  const [filter, setFilter] = useState<ProcessFilter>(EMPTY_PROCESS_FILTER)
  const [visibleParents, setVisibleParents] = useState(INITIAL_PARENT_ROWS)
  const [focusIndex, setFocusIndex] = useState<number | null>(null)

  const groups = useMemo(
    () => groupProcessRows(buildProcessRows(index, filter)),
    [index, filter],
  )
  const anomalyCount = useMemo(() => new Set(anomalies.flatMap((group) => group.ids)).size, [anomalies])
  const hasTools = index.records.length > 0
  const stageTotal = summary.stages.start + summary.stages.result + summary.stages.error
  const shownGroups = groups.slice(0, visibleParents)
  const remainingGroups = groups.length - shownGroups.length
  const shownRecords = shownGroups.reduce((total, group) => total + 1 + group.children.length, 0)

  const applyFilter = (next: ProcessFilter) => {
    setFilter(next)
    setVisibleParents(INITIAL_PARENT_ROWS)
  }

  const focusAnomaly = (kind: ProcessAnomalyGroup['kind']) => {
    applyFilter({ ...EMPTY_PROCESS_FILTER, status: kind as ProcessStatusFilter })
  }

  const revealRemaining = () => {
    // 记下第一个新增父调用的下标，展开后把焦点交给它（键盘用户不丢位置）
    setFocusIndex(visibleParents)
    setVisibleParents(groups.length)
  }

  return (
    <div className="flex flex-col gap-3">
      <section aria-label="本轮概况" className="flex flex-col gap-1">
        <h3 className="v2-section-title">这轮做了什么</h3>
        <p className="text-caption text-muted-foreground [overflow-wrap:anywhere]">
          {hasTools ? `${stageTotal} 条记录` : '没有工具调用记录'}
          {summary.summaryText ? ` · ${summary.summaryText}` : ''}
        </p>
      </section>

      {anomalies.length > 0 && (
        <section aria-label="异常分组" className="flex flex-col gap-1">
          <h4 className="text-caption font-medium text-foreground">异常分组</h4>
          <div className="flex flex-wrap gap-1.5">
            {anomalies.map((group) => {
              const active = filter.status === group.kind
              return (
                <button
                  key={group.kind}
                  type="button"
                  aria-pressed={active}
                  aria-label={`只看${group.label}（${group.ids.length} 条）`}
                  onClick={() => focusAnomaly(group.kind)}
                  className="cursor-pointer rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ProcessChip tone={ANOMALY_TONE[group.kind] ?? 'warning'} className={active ? 'ring-1 ring-ring' : undefined}>
                    {group.label} <span className="num-tabular">{group.ids.length}</span>
                  </ProcessChip>
                </button>
              )
            })}
          </div>
        </section>
      )}

      <section aria-label="推理摘要" className="flex flex-col gap-1">
        <h4 className="text-caption font-medium text-foreground">推理摘要</h4>
        <ProcessReasoningSection
          scopeKey={scopeKey}
          reasoningRaw={snapshot.reasoningRaw ?? ''}
          toolEvents={snapshot.toolEvents ?? []}
          expandAll={expandAll}
        />
      </section>

      <section aria-label="调用过程" className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-caption font-medium text-foreground">调用过程</h4>
          <button
            type="button"
            onClick={onOpenLedger}
            className="inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-lg border border-border bg-surface px-2.5 text-caption font-medium text-foreground transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ListTree aria-hidden className="h-3.5 w-3.5" />
            调用台账
          </button>
        </div>

        {hasTools ? (
          <>
            <ProcessToolbar filter={filter} onChange={applyFilter} anomalyCount={anomalyCount} />
            {groups.length === 0 ? (
              <ProcessEmptyState title="没有匹配的调用" hint="换个关键词或清掉筛选条件再试。" />
            ) : (
              <ul className="v2-panel overflow-hidden" aria-label="过程步骤">
                {shownGroups.map((group, position) => (
                  <ProcessOperationRow
                    key={group.row.id}
                    row={group.row}
                    childRows={group.children}
                    scopeKey={scopeKey}
                    expandAll={expandAll}
                    canCommand={canCommand}
                    commands={commands}
                    first={position === 0}
                    focusOnMount={focusIndex === position}
                  />
                ))}
              </ul>
            )}
            {remainingGroups > 0 && (
              <button
                type="button"
                onClick={revealRemaining}
                className="min-h-11 w-full cursor-pointer rounded-lg border border-border bg-surface px-3 text-caption font-medium text-foreground transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                显示其余 {remainingGroups} 个父调用
              </button>
            )}
            <p className="text-micro text-muted-foreground">
              已展示 {shownRecords} / {index.records.length} 条记录
              {summary.duplicateCount > 0 ? ` · 合并 ${summary.duplicateCount} 条重复事件` : ''}
            </p>
          </>
        ) : (
          <ProcessEmptyState title="本轮没有工具调用" hint="只有模型直接作答；推理摘要仍可在上方查看。" />
        )}
      </section>
    </div>
  )
}
