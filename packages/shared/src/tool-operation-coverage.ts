/**
 * ToolLogCoverage —— 工具调用台账三层覆盖状态。
 *
 * trace / persisted / projection 是三条不同的数据来源，各自独立三态：
 * - complete：该层数据完整可用
 * - partial：该层拿到数据但有明确缺口（丢记录/截断字段/未结束）
 * - unknown：没有该层证据，调用方不得把它当成 complete 或 0
 *
 * 任何一层缺失都只写 unknown；缺口计量只写调用方确证的数字。
 */

export type ToolCoverageStatus = 'complete' | 'partial' | 'unknown'

export type ToolCoverageLayerName = 'trace' | 'persisted' | 'projection'

export interface ToolLogCoverageLayer {
  status: ToolCoverageStatus
  /** 该层数据对应的快照时间（persisted 读取/写入时刻） */
  asOf?: number
  /** trace 层事件起点 */
  startedAt?: number
  /** trace 层轮次结束时间；缺失表示轮次尚未结束 */
  turnEndedAt?: number
  /** 该层明确丢弃的记录数（例如 512KB 压缩丢条目），未知时不写 */
  droppedRecords?: number
  /** 该层明确被截断的字段数，未知时不写 */
  truncatedFields?: number
}

export interface ToolLogCoverage {
  trace: ToolLogCoverageLayer
  persisted: ToolLogCoverageLayer
  projection: ToolLogCoverageLayer
}

export type ToolLogCoverageLayerInput = Partial<ToolLogCoverageLayer> | ToolCoverageStatus

export interface ToolLogCoverageInput {
  trace?: ToolLogCoverageLayerInput
  persisted?: ToolLogCoverageLayerInput
  projection?: ToolLogCoverageLayerInput
}

const COVERAGE_STATUSES: readonly ToolCoverageStatus[] = ['complete', 'partial', 'unknown']

const NUMERIC_LAYER_FIELDS: ReadonlyArray<keyof ToolLogCoverageLayer> = [
  'asOf',
  'startedAt',
  'turnEndedAt',
  'droppedRecords',
  'truncatedFields',
]

const normalizeCoverageStatus = (value: unknown): ToolCoverageStatus =>
  COVERAGE_STATUSES.includes(value as ToolCoverageStatus) ? (value as ToolCoverageStatus) : 'unknown'

const normalizeCoverageLayer = (input?: ToolLogCoverageLayerInput): ToolLogCoverageLayer => {
  if (typeof input === 'string') return { status: normalizeCoverageStatus(input) }
  if (!input || typeof input !== 'object') return { status: 'unknown' }

  const layer: ToolLogCoverageLayer = { status: normalizeCoverageStatus(input.status) }
  for (const field of NUMERIC_LAYER_FIELDS) {
    const value = input[field]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      ;(layer as unknown as Record<string, number>)[field] = value
    }
  }
  return layer
}

/** 缺省覆盖快照：三层全部 unknown（冻结，避免下游误改共享常量）。 */
export const UNKNOWN_TOOL_LOG_COVERAGE: ToolLogCoverage = Object.freeze({
  trace: Object.freeze({ status: 'unknown' }),
  persisted: Object.freeze({ status: 'unknown' }),
  projection: Object.freeze({ status: 'unknown' }),
}) as ToolLogCoverage

export const buildToolLogCoverage = (input?: ToolLogCoverageInput): ToolLogCoverage => ({
  trace: normalizeCoverageLayer(input?.trace),
  persisted: normalizeCoverageLayer(input?.persisted),
  projection: normalizeCoverageLayer(input?.projection),
})
