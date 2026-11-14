/**
 * 覆盖归一化与文案 —— 三层覆盖的形状直接来自共享契约。
 *
 * trace 无证据就是 unknown；persisted.partial 是真正的记录丢失或字段裁剪；
 * projection.partial 只表示当前列表视图精简，不代表原记录丢失。
 * 展示只保留列表精简与明确运行缺口；持久化状态和未知快照保留在数据层。
 */
import {
  buildToolLogCoverage,
  type ToolLogCoverage,
  type ToolLogCoverageLayer,
} from '@aichat/shared/tool-operations'
import type { ProcessCoverage } from '../types'

export type NormalizedProcessCoverage = ToolLogCoverage

/** 外部只传关心的层；缺省层由共享契约补成 unknown。 */
export const normalizeProcessCoverage = (input?: ProcessCoverage): NormalizedProcessCoverage =>
  buildToolLogCoverage(input)

export type ProcessCoverageTone = 'neutral' | 'warning' | 'danger'

export interface ProcessCoverageNote {
  layer: 'trace' | 'projection'
  tone: ProcessCoverageTone
  text: string
}

/** 只在有正计数时写数字：0 和缺失都当作"没有确证缺口"，不写成"丢弃 0 条"。 */
const countText = (layer: ToolLogCoverageLayer): string => {
  const parts: string[] = []
  if (typeof layer.droppedRecords === 'number' && layer.droppedRecords > 0) {
    parts.push(`丢弃 ${layer.droppedRecords} 条记录`)
  }
  if (typeof layer.truncatedFields === 'number' && layer.truncatedFields > 0) {
    parts.push(`裁剪 ${layer.truncatedFields} 个字段`)
  }
  return parts.join('，')
}

/** 只写确证事实；unknown 不显示成 0，也不显示成完整。 */
export const describeProcessCoverage = (coverage: NormalizedProcessCoverage): ProcessCoverageNote[] => {
  const notes: ProcessCoverageNote[] = []

  if (coverage.projection.status === 'partial') {
    notes.push({ layer: 'projection', tone: 'neutral', text: '列表视图已精简，打开详情查看' })
  }

  if (coverage.trace.status === 'partial') {
    const detail = countText(coverage.trace)
    notes.push({
      layer: 'trace',
      tone: 'warning',
      text: detail ? `本次运行链路有缺口：${detail}` : '本次运行链路有缺口',
    })
  }

  return notes
}

/** 观测窗口只用真实时间戳，缺失返回 null 由界面标未知。 */
export const describeObservationWindow = (
  coverage: NormalizedProcessCoverage,
): { start: number | null; end: number | null } => ({
  start: typeof coverage.trace.startedAt === 'number' ? coverage.trace.startedAt : null,
  end: typeof coverage.trace.turnEndedAt === 'number' ? coverage.trace.turnEndedAt : null,
})
