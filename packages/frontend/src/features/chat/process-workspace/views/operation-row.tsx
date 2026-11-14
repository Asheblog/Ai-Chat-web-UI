'use client'

import { useEffect, useId, useRef } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ProcessRow } from '../model/derived-views'
import { describeProcessRecord } from '../model/record-display'
import type { ProcessWorkspaceCommands } from '../types'
import { TOOL_VISIBILITY_STORAGE_KEY, toolItemKey } from '../model/disclosure'
import { useProcessVisibility } from '../hooks/use-process-disclosure'
import { ProcessOperationDetail } from './operation-detail'
import { ProcessChip, ProcessRelationChip, ProcessStatusChip } from './status'

interface ProcessOperationRowProps {
  row: ProcessRow
  /** 父行下的子记录：只有父行展开时才渲染，子任务不单独占首屏 */
  childRows?: ProcessRow[]
  scopeKey: string
  expandAll: boolean
  canCommand: boolean
  commands?: ProcessWorkspaceCommands
  /** 分组标题下的首行需要更紧的上边距 */
  first?: boolean
  /** "显示其余" 之后把焦点交给第一个新增的父行 */
  focusOnMount?: boolean
}

/** 一行 = 一条唯一记录。父行展开显示子任务，详情按需展开，不默认铺开。 */
export function ProcessOperationRow({
  row,
  childRows = [],
  scopeKey,
  expandAll,
  canCommand,
  commands,
  first = false,
  focusOnMount = false,
}: ProcessOperationRowProps) {
  const { record } = row
  const bodyId = useId()
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const { expanded, toggle } = useProcessVisibility({
    itemKey: toolItemKey(scopeKey, record.callId ?? record.id),
    storageKey: TOOL_VISIBILITY_STORAGE_KEY,
    defaultExpanded: expandAll,
  })
  const { title } = describeProcessRecord(record)
  const childCount = record.childIds.length

  useEffect(() => {
    if (focusOnMount) buttonRef.current?.focus()
  }, [focusOnMount])

  return (
    <li
      className={cn('min-w-0', first ? 'mt-0' : 'border-t border-border/70')}
      style={row.depth > 0 ? { marginLeft: row.depth * 12 } : undefined}
      data-testid={`operation-${record.id}`}
      data-relation={record.relation}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        aria-controls={bodyId}
        className="flex min-h-11 w-full cursor-pointer items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <ChevronRight
          aria-hidden
          className={cn(
            'mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none',
            expanded && 'rotate-90',
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-foreground [overflow-wrap:anywhere]">{title}</span>
          <span className="mt-1 flex flex-wrap items-center gap-1">
            <ProcessStatusChip record={record} />
            <ProcessRelationChip record={record} />
            {record.degraded && <ProcessChip tone="warning">降级</ProcessChip>}
            {record.recovery.attempts !== undefined && (
              <ProcessChip>
                <span className="num-tabular">尝试 {record.recovery.attempts} 次</span>
              </ProcessChip>
            )}
            {childCount > 0 && (
              <ProcessChip>
                <span className="num-tabular">{childCount} 个子任务</span>
              </ProcessChip>
            )}
            {record.duplicateCount > 0 && (
              <ProcessChip>
                <span className="num-tabular">合并 {record.duplicateCount} 条重复</span>
              </ProcessChip>
            )}
          </span>
        </span>
        <span className="mt-0.5 shrink-0 text-micro text-muted-foreground [overflow-wrap:anywhere]">
          {record.identifier ?? record.tool}
        </span>
      </button>
      {expanded && (
        <div id={bodyId}>
          {childRows.length > 0 && (
            <ul className="ml-3 border-l border-border pl-1" aria-label={`${title} 的子任务`}>
              {childRows.map((childRow) => (
                <ProcessOperationRow
                  key={childRow.id}
                  row={childRow}
                  childRows={[]}
                  scopeKey={scopeKey}
                  expandAll={expandAll}
                  canCommand={canCommand}
                  commands={commands}
                  first
                />
              ))}
            </ul>
          )}
          <ProcessOperationDetail record={record} canCommand={canCommand} commands={commands} />
        </div>
      )}
    </li>
  )
}
