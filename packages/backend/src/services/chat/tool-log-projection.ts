/**
 * 工具日志读取投影：历史列表瘦身与投影缺口计量。
 *
 * 投影必须保留 id / callId / status / phase / source / 时间，以及 details 上的
 * parentCallId（父子）与 truncated（降级证据）；否则父子退化成 orphan、截断证据消失。
 * 凡是被本层省略的字段都要计量，不能宣布假的 complete。
 */
import type { ToolLogCoverageLayer } from '@aichat/shared/tool-operations'
import {
  TOOL_LOG_ENTRY_FIELDS,
  TOOL_LOG_PRESERVED_DETAIL_KEYS,
  isToolLogStatus,
  type ToolLogDetails,
  type ToolLogEntry,
} from './tool-log-model'

export const countValidHits = (hits: unknown): number => {
  if (!Array.isArray(hits)) return 0
  let count = 0
  for (const hit of hits) {
    if (!hit || typeof hit !== 'object') continue
    const record = hit as Record<string, unknown>
    if (typeof record.title === 'string' || typeof record.url === 'string') count += 1
  }
  return count
}

/** 历史列表投影：去掉 hits 与大体量 details，保留身份/父子/状态/来源/时间/降级证据。 */
export const projectEntryForHistoryList = (entry: ToolLogEntry): ToolLogEntry => {
  const slim: ToolLogEntry = {
    id: entry.id,
    tool: entry.tool,
    stage: entry.stage,
    createdAt: entry.createdAt,
  }
  if (isToolLogStatus(entry.status)) slim.status = entry.status
  if (entry.phase) slim.phase = entry.phase
  if (entry.callId) slim.callId = entry.callId
  if (entry.source) slim.source = entry.source
  if (entry.identifier) slim.identifier = entry.identifier
  if (entry.apiName) slim.apiName = entry.apiName
  if (typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt)) {
    slim.updatedAt = entry.updatedAt
  }
  if (typeof entry.endedAt === 'number' && Number.isFinite(entry.endedAt)) {
    slim.endedAt = entry.endedAt
  }
  if (entry.query) slim.query = entry.query
  if (entry.error) slim.error = entry.error
  if (entry.summary) slim.summary = entry.summary

  const source = (entry.details ?? {}) as Record<string, unknown>
  const details: ToolLogDetails = {}
  for (const key of TOOL_LOG_PRESERVED_DETAIL_KEYS) {
    const value = source[key]
    if (value !== undefined && value !== null) {
      ;(details as Record<string, unknown>)[key] = value
    }
  }

  const explicitHitsCount = typeof source.hitsCount === 'number' ? source.hitsCount : null
  const hitsLength = countValidHits(entry.hits)
  if (explicitHitsCount !== null) {
    details.hitsCount = explicitHitsCount
  } else if (hitsLength > 0) {
    details.hitsCount = hitsLength
  }

  if (Object.keys(details).length > 0) slim.details = details
  return slim
}

export const projectToolEventsForHistoryList = (entries: ToolLogEntry[]): ToolLogEntry[] => {
  if (!Array.isArray(entries) || entries.length === 0) return []
  return entries.map(projectEntryForHistoryList)
}

/**
 * 该值是否携带信息：空串、空数组、非法枚举都算「没有可保留的内容」，
 * 不计入投影缺口，避免详情页把「本来就没有」误报成「被删掉了」。
 */
const hasMeaningfulValue = (key: string, value: unknown): boolean => {
  if (value === undefined || value === null) return false
  if (typeof value === 'string' && value.trim() === '') return false
  if (Array.isArray(value) && value.length === 0) return false
  if (key === 'status' && !isToolLogStatus(value)) return false
  if (key === 'stage' && value !== 'start' && value !== 'result' && value !== 'error') return false
  return true
}

/** 投影缺口计量：本层省略掉的顶层字段与 details 字段数（有删必计）。 */
export const countProjectionLosses = (raw: Record<string, unknown>, delivered: ToolLogEntry): number => {
  let lost = 0
  const deliveredRecord = delivered as unknown as Record<string, unknown>
  for (const key of TOOL_LOG_ENTRY_FIELDS) {
    const rawValue = raw[key]
    if (!hasMeaningfulValue(key, rawValue)) continue
    if (deliveredRecord[key] === undefined) lost += 1
  }
  const rawDetails =
    raw.details && typeof raw.details === 'object' && !Array.isArray(raw.details)
      ? (raw.details as Record<string, unknown>)
      : null
  if (rawDetails) {
    const deliveredDetails = (delivered.details ?? {}) as Record<string, unknown>
    for (const key of Object.keys(rawDetails)) {
      const value = rawDetails[key]
      if (!hasMeaningfulValue(key, value)) continue
      if (deliveredDetails[key] === undefined) lost += 1
    }
  }
  return lost
}

export const buildProjectionLayer = (truncatedFields: number): ToolLogCoverageLayer =>
  truncatedFields > 0 ? { status: 'partial', truncatedFields } : { status: 'complete' }
