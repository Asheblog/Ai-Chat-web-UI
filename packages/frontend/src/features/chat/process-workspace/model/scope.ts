/**
 * 作用域、整轮终态与格式化：工作区所有"这条消息是谁"的判断只在这里。
 *
 * 作用域键必须与旧实现完全一致，顺序是 stableKey → String(id) → clientMessageId，
 * 否则既有披露偏好（sessionStorage/localStorage 里按 key 存的记录）会全部失效。
 */
import type { MessageMeta } from '@/types'
import type {
  ProcessCommandTarget,
  ProcessOrigin,
  ProcessRunTerminal,
  ProcessScope,
  ProcessStopReason,
} from '../types'

/** 与旧 cot-timeline 的 resolveBaseKey 同序：stableKey → id → clientMessageId。 */
export const resolveProcessScopeKey = (
  meta: Pick<MessageMeta, 'stableKey' | 'id' | 'clientMessageId'>,
): string => {
  if (typeof meta.stableKey === 'string' && meta.stableKey.trim()) return meta.stableKey
  if (meta.id != null && String(meta.id).trim()) return String(meta.id)
  if (typeof meta.clientMessageId === 'string' && meta.clientMessageId.trim()) return meta.clientMessageId
  return ''
}

export interface ResolveProcessScopeInput {
  readOnly?: boolean
}

/**
 * chat 可派发命令；share 强制只读；Battle 用 sessionId 0 表示与聊天会话隔离，
 * 因此一律不发 chat 命令（即便调用方忘了传 readOnly）。
 */
export function resolveProcessScope(
  meta: MessageMeta,
  input: ResolveProcessScopeInput = {},
): ProcessScope {
  const sessionId = typeof meta.sessionId === 'number' && Number.isFinite(meta.sessionId) ? meta.sessionId : 0
  const requestedReadOnly = input.readOnly === true
  const origin: ProcessOrigin = sessionId <= 0 ? 'battle' : requestedReadOnly ? 'share' : 'chat'
  const readOnly = requestedReadOnly || sessionId <= 0
  const target: ProcessCommandTarget = {
    sessionId,
    messageId: meta.id,
    clientMessageId: typeof meta.clientMessageId === 'string' ? meta.clientMessageId : null,
  }
  return {
    key: resolveProcessScopeKey(meta),
    sessionId,
    origin,
    readOnly,
    canCommand: !readOnly && sessionId > 0,
    target,
  }
}

const readRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : null

const readStopReason = (value: unknown): ProcessStopReason | undefined =>
  value === 'stop_tools' || value === 'budget_exhausted' ? value : undefined

/**
 * 整轮终态读取顺序：显式 props.runTerminal > meta.metadata.runResult > meta 扁平同名字段。
 * 缺字段就是未知，不默认成"已生成最终回答"。
 */
export const resolveRunTerminal = (
  meta: MessageMeta,
  override?: ProcessRunTerminal,
): ProcessRunTerminal => {
  if (override) {
    const terminal: ProcessRunTerminal = {}
    const stopReason = readStopReason(override.stopReason)
    if (stopReason) terminal.stopReason = stopReason
    if (typeof override.finalAnswerGenerated === 'boolean') {
      terminal.finalAnswerGenerated = override.finalAnswerGenerated
    }
    return terminal
  }

  const flat = meta as unknown as Record<string, unknown>
  const envelopeRunResult = readRecord(readRecord(flat.metadata)?.runResult)
  const terminal: ProcessRunTerminal = {}
  const stopReason = readStopReason(envelopeRunResult?.stopReason) ?? readStopReason(flat.stopReason)
  if (stopReason) terminal.stopReason = stopReason
  const generated = envelopeRunResult?.finalAnswerGenerated
  const finalAnswerGenerated =
    typeof generated === 'boolean'
      ? generated
      : typeof flat.finalAnswerGenerated === 'boolean'
        ? (flat.finalAnswerGenerated as boolean)
        : undefined
  if (finalAnswerGenerated !== undefined) terminal.finalAnswerGenerated = finalAnswerGenerated
  return terminal
}

export interface ProcessRunTerminalView {
  /** 未生成最终回答时是硬事实：不能显示成功徽标 */
  finalAnswerMissing: boolean
  stopReason?: ProcessStopReason
  /** 摘要条 / 面板顶部的一行说明，null 表示无需额外说明 */
  note: string | null
  tone: 'neutral' | 'warning'
}

export const describeRunTerminal = (terminal: ProcessRunTerminal): ProcessRunTerminalView => {
  const finalAnswerMissing = terminal.finalAnswerGenerated === false
  let note: string | null = null
  if (finalAnswerMissing) {
    note = '未生成最终回答'
  } else if (terminal.stopReason === 'stop_tools') {
    note = '已停止后续工具，用已有资料作答'
  } else if (terminal.stopReason === 'budget_exhausted') {
    note = '工具预算耗尽后收尾'
  }
  const stopReason = terminal.stopReason ?? undefined
  return {
    finalAnswerMissing,
    stopReason,
    note,
    tone: finalAnswerMissing || stopReason ? 'warning' : 'neutral',
  }
}

/** 与旧实现一致：只有正数才显示耗时，分钟数只在 >=60 秒时出现。 */
export const formatProcessDuration = (seconds: number | null | undefined): string | null => {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null
  const total = Math.floor(seconds)
  const minutes = Math.floor(total / 60)
  return minutes > 0 ? `${minutes} 分 ${total % 60} 秒` : `${total} 秒`
}

const pad = (value: number) => String(value).padStart(2, '0')

/** 记录时间：台账列用，缺失即空串（不写 00:00）。 */
export const formatClockTime = (value: number | null | undefined): string => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return ''
  const date = new Date(value)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export const formatByteSize = (bytes: number | null | undefined): string | null => {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return null
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
