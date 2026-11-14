/**
 * 操作索引适配层 —— 唯一一处接触共享契约的地方。
 *
 * 投影、身份规则、结果推导全部来自 @aichat/shared/tool-operations（task-1 冻结），
 * 本文件只做类型收敛与视图需要的默认值，禁止在这里重复实现去重 / 父子连接。
 */
import type { ToolEvent } from '@/types'
import {
  buildToolOperationIndex,
  type ToolOperationIndex,
  type ToolOperationIndexInput,
  type ToolOperationOutcome,
  type ToolOperationRecord,
  type ToolOperationRecovery,
  type ToolOperationRelation,
} from '@aichat/shared/tool-operations'
import type { ProcessCoverage } from '../types'

/** 视图只依赖这些别名，共享契约换字段时改这一处。 */
export type ProcessOutcome = ToolOperationOutcome
export type ProcessRecord = ToolOperationRecord
export type ProcessIndex = ToolOperationIndex
export type ProcessRecovery = ToolOperationRecovery
export type ProcessRelation = ToolOperationRelation
export type ProcessIndexInput = ToolOperationIndexInput

export interface ProcessIndexSource {
  events: readonly ToolEvent[]
  coverage?: ProcessCoverage
}

/**
 * 事件 + 覆盖 → 索引。coverage 由 hydration 按三层给出；
 * 未给时共享契约会写成三层 unknown，界面据此标未知而不是完整。
 */
export const buildProcessIndex = (source: ProcessIndexSource | readonly ToolEvent[]): ProcessIndex =>
  buildToolOperationIndex(Array.isArray(source) ? (source as readonly ToolEvent[]) : source)
