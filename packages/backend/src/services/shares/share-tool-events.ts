/**
 * 分享快照的工具事件投影。
 *
 * 分享面只读、由分享 payload 直接消费，因此必须与历史/Battle 保持同一身份语义：
 * 保留 id / callId / status / source / phase / 时间与 details（含 parentCallId、fallbackUsed），
 * 不把 pending / rejected / aborted 压平成 running / success / error。
 *
 * hit 直接复用后端持久化的 WebSearchHit 契约（engine/rank/sourceEngines/mergeScore/
 * publishedDate/siteName/authority/query/queryLanguage 等一并不丢），
 * 这样分享投影不省略任何已持久化字段，projection 的 complete 声明才成立。
 */
import type { WebSearchHit } from '../../utils/web-search'
import { readOptionalString, resolveToolLogStatus, type ToolLogEntry } from '../chat/tool-log-model'

/** 与持久化契约同一份 hit 形状，不另建投影字段表。 */
export type ShareToolEventHit = WebSearchHit

export interface ShareToolEvent {
  id: string
  tool: string
  stage: 'start' | 'result' | 'error'
  status: 'running' | 'success' | 'error' | 'pending' | 'rejected' | 'aborted'
  callId?: string
  source?: string
  identifier?: string
  apiName?: string
  phase?: string
  query?: string
  url?: string
  summary?: string
  error?: string
  createdAt: number
  updatedAt?: number
  endedAt?: number
  hits?: ShareToolEventHit[]
  details?: Record<string, unknown>
}

export const buildShareToolEvents = (entries: ToolLogEntry[]): ShareToolEvent[] => {
  if (!Array.isArray(entries) || entries.length === 0) return []

  return entries.map((entry) => {
    const details = entry.details ? ({ ...entry.details } as Record<string, unknown>) : undefined
    const event: ShareToolEvent = {
      id: entry.id,
      tool: entry.tool,
      stage: entry.stage,
      status: resolveToolLogStatus(entry),
      createdAt: entry.createdAt,
    }
    const callId = readOptionalString(entry.callId)
    if (callId) event.callId = callId
    const source = readOptionalString(entry.source)
    if (source) event.source = source
    const identifier = readOptionalString(entry.identifier)
    if (identifier) event.identifier = identifier
    const apiName = readOptionalString(entry.apiName)
    if (apiName) event.apiName = apiName
    const phase = readOptionalString(entry.phase)
    if (phase) event.phase = phase
    if (entry.query) event.query = entry.query
    if (entry.summary) event.summary = entry.summary
    if (entry.error) event.error = entry.error
    if (typeof entry.updatedAt === 'number') event.updatedAt = entry.updatedAt
    if (typeof entry.endedAt === 'number') event.endedAt = entry.endedAt

    const url = readOptionalString(details?.url)
    if (url) event.url = url

    if (Array.isArray(entry.hits) && entry.hits.length > 0) {
      event.hits = entry.hits.map((hit) => ({ ...hit }))
    }
    if (details && Object.keys(details).length > 0) event.details = details
    return event
  })
}
