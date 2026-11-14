/**
 * 覆盖归一化与文案 —— 三层覆盖的形状直接来自共享契约。
 *
 * trace 无证据就是 unknown；persisted.partial 是真正的记录丢失或字段裁剪；
 * projection.partial 只表示当前列表视图精简，不代表原记录丢失。两者文案必须分开。
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
  layer: 'trace' | 'persisted' | 'projection'
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

  if (coverage.persisted.status === 'partial') {
    // 没有正计数时只说"尚不完整"，不凭空断言已经丢了记录
    const detail = countText(coverage.persisted)
    notes.push({
      layer: 'persisted',
      tone: 'warning',
      text: detail ? `持久化记录不完整：${detail}` : '持久化记录尚不完整',
    })
  } else if (coverage.persisted.status === 'unknown') {
    notes.push({ layer: 'persisted', tone: 'neutral', text: '持久化记录状态未知' })
  }

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
  } else if (coverage.trace.status === 'unknown') {
    // 流式过程中 trace 也是 unknown：只说没有快照，不声称本轮已经结束
    notes.push({ layer: 'trace', tone: 'neutral', text: '无原始运行链路快照' })
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
