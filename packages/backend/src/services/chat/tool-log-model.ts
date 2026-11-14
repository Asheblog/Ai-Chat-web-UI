/**
 * 工具日志记录模型 —— 持久化、读取与投影共用的字段契约。
 *
 * 任何压缩层与投影都必须保留 id / callId / status / phase / source / 时间，
 * 以及 details 上的 truncated（降级证据）与 parentCallId（父子关系）。
 */
import { resolveEventStatus } from '@aichat/shared/tool-events'
import type { WebSearchHit } from '../../utils/web-search'

export type ToolLogStage = 'start' | 'result' | 'error'

export type ToolLogStatus = 'running' | 'success' | 'error' | 'pending' | 'rejected' | 'aborted'

export interface ToolLogDetails {
  code?: string
  input?: string
  stdout?: string
  stderr?: string
  exitCode?: number
  durationMs?: number
  /** 运行时真实截断证据（工具/引擎自己截的），shared 据此判定执行降级。 */
  truncated?: boolean
  /** 存储层为控制体积做的裁剪（>500 字符、512KB 压缩），不是执行降级。 */
  storageTruncated?: boolean
  [key: string]: unknown
}

export interface ToolLogEntry {
  id: string
  tool: string
  stage: ToolLogStage
  status?: ToolLogStatus
  phase?: string
  callId?: string
  source?: string
  identifier?: string
  apiName?: string
  query?: string
  hits?: WebSearchHit[]
  error?: string
  summary?: string
  createdAt: number
  updatedAt?: number
  endedAt?: number
  details?: ToolLogDetails
}

/** 本轮运行由「停止后续工具 / 预算收尾」结束时才有的结果标记。 */
export type ToolRunStopReason = 'stop_tools' | 'budget_exhausted'

export interface ToolLogRunResult {
  stopReason?: ToolRunStopReason
  finalAnswerGenerated?: boolean
}

export const TOOL_LOG_STATUSES: readonly ToolLogStatus[] = [
  'running',
  'success',
  'error',
  'pending',
  'rejected',
  'aborted',
]

export const isToolLogStatus = (value: unknown): value is ToolLogStatus =>
  typeof value === 'string' && (TOOL_LOG_STATUSES as readonly string[]).includes(value)

export const readOptionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined

export const TOOL_LOG_LIMITS = {
  hitSnippetChars: 200,
  hits: 10,
  detailStringChars: 500,
  detailArrayItems: 20,
  queryChars: 500,
  summaryChars: 500,
  errorChars: 500,
} as const

/** 摘要压缩层与历史列表投影都保留的 details 键：身份/父子/来源/时间/降级证据。 */
export const TOOL_LOG_PRESERVED_DETAIL_KEYS = [
  'parentCallId',
  'groupId',
  'taskType',
  'engine',
  'queryLanguage',
  'originalQuery',
  'expandedQuery',
  'source',
  'toolSource',
  'url',
  'title',
  'reasoningOffset',
  'reasoningOffsetStart',
  'reasoningOffsetEnd',
  'startedAt',
  'endedAt',
  'durationMs',
  'fallbackUsed',
  'recovery',
  'outcome',
  'autoTriggered',
  'plan',
  'approval',
  'intervention',
  'truncated',
  'storageTruncated',
] as const

/** 极简压缩层只保留父子、恢复与降级证据，其余一律计量为被裁剪字段。 */
export const TOOL_LOG_EXTREME_DETAIL_KEYS = [
  'parentCallId',
  'groupId',
  'fallbackUsed',
  'truncated',
  'storageTruncated',
] as const

/**
 * 展示用状态解析：直接复用 @aichat/shared/tool-events 的 resolveEventStatus（单一实现），
 * 这里只做类型适配，不复制任何分支。
 */
export const resolveToolLogStatus = (
  entry: Pick<ToolLogEntry, 'status' | 'phase' | 'stage'>,
): ToolLogStatus => resolveEventStatus(entry)

/** 记录上可持久化的顶层字段（不含 details），用于投影缺口计量。 */
export const TOOL_LOG_ENTRY_FIELDS = [
  'id',
  'tool',
  'stage',
  'status',
  'phase',
  'callId',
  'source',
  'identifier',
  'apiName',
  'query',
  'hits',
  'error',
  'summary',
  'createdAt',
  'updatedAt',
  'endedAt',
] as const
