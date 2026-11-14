/**
 * 单条工具日志的读取与旧数据识别。
 *
 * 旧 512KB 兜底曾写入「N tool events compacted to fit size limit」伪记录（stage=result、
 * 复用最新 id、details.truncated），它不是一次真实调用：读取侧识别后不再产出条目，
 * 缺口改由 persisted 覆盖声明，避免台账把它算成一次成功操作。
 */
import type { WebSearchHit } from '../../utils/web-search'
import {
  isToolLogStatus,
  readOptionalString,
  type ToolLogDetails,
  type ToolLogEntry,
  type ToolLogStage,
} from './tool-log-model'
import { countValidHits } from './tool-log-projection'

const LEGACY_MATCH_WINDOW_MS = 15_000

export type LegacyIdAllocator = (
  key: string,
  stage: ToolLogStage,
  createdAt: number,
) => string

/** 旧记录没有 id 时按 tool+query 配对 start/result，窗口外不复用。 */
export const createLegacyIdAllocator = (): LegacyIdAllocator => {
  const pendingByKey = new Map<string, Array<{ id: string; createdAt: number }>>()
  let legacyCounter = 0

  return (key, stage, createdAt) => {
    if (stage === 'start') {
      const id = `legacy:${key}:${legacyCounter++}`
      const queue = pendingByKey.get(key) ?? []
      queue.push({ id, createdAt })
      pendingByKey.set(key, queue)
      return id
    }
    const queue = pendingByKey.get(key)
    if (queue && queue.length > 0) {
      while (queue.length > 0 && createdAt - queue[0].createdAt > LEGACY_MATCH_WINDOW_MS) {
        queue.shift()
      }
      const matched = queue.shift()
      if (queue.length === 0) {
        pendingByKey.delete(key)
      } else {
        pendingByKey.set(key, queue)
      }
      if (matched) return matched.id
    }
    return `legacy:${key}:${legacyCounter++}`
  }
}

/**
 * 读取侧对 hit 做无损透传：只补 snake_case 别名并校验 title/url。
 * 字段裁剪是写入侧（tool-log-sanitize）的职责且会逐个计量，
 * 读取再删一次会让历史/分享静默丢字段却报 complete。
 */
const normalizeHits = (hits: unknown): WebSearchHit[] | undefined => {
  if (!Array.isArray(hits)) return undefined
  const normalized = hits
    .map((hit) => {
      if (!hit || typeof hit !== 'object') return null
      const record = hit as Record<string, unknown>
      const title = typeof record.title === 'string' ? record.title : ''
      const url = typeof record.url === 'string' ? record.url : ''
      if (!title && !url) return null
      const result = { ...record, title, url } as unknown as WebSearchHit
      if (!result.imageUrl && typeof record.image_url === 'string') result.imageUrl = record.image_url
      if (!result.thumbnailUrl && typeof record.thumbnail_url === 'string') {
        result.thumbnailUrl = record.thumbnail_url
      }
      if (!result.thumbnailUrl && typeof record.thumbnail === 'string') {
        result.thumbnailUrl = record.thumbnail
      }
      return result
    })
    .filter((hit): hit is WebSearchHit => hit !== null)
  return normalized
}

export const parseSingleEntry = (
  rawRecord: Record<string, unknown>,
  allocateLegacyId: LegacyIdAllocator,
): ToolLogEntry | null => {
  const stage = rawRecord.stage
  if (stage !== 'start' && stage !== 'result' && stage !== 'error') return null

  const tool = typeof rawRecord.tool === 'string' && rawRecord.tool.trim() ? rawRecord.tool : 'unknown'
  const createdAt =
    typeof rawRecord.createdAt === 'number' && Number.isFinite(rawRecord.createdAt)
      ? rawRecord.createdAt
      : Date.now()
  const query = typeof rawRecord.query === 'string' ? rawRecord.query : undefined
  const id =
    typeof rawRecord.id === 'string' && rawRecord.id.trim()
      ? rawRecord.id.trim()
      : allocateLegacyId(`${tool}::${(query || '').trim().toLowerCase()}`, stage, createdAt)

  const entry: ToolLogEntry = { id, tool, stage, createdAt }
  if (query) entry.query = query
  if (isToolLogStatus(rawRecord.status)) entry.status = rawRecord.status
  const phase = readOptionalString(rawRecord.phase)
  if (phase) entry.phase = phase
  const callId = readOptionalString(rawRecord.callId)
  if (callId) entry.callId = callId
  const source = readOptionalString(rawRecord.source)
  if (source) entry.source = source
  const identifier = readOptionalString(rawRecord.identifier)
  if (identifier) entry.identifier = identifier
  const apiName = readOptionalString(rawRecord.apiName)
  if (apiName) entry.apiName = apiName
  if (typeof rawRecord.updatedAt === 'number' && Number.isFinite(rawRecord.updatedAt)) {
    entry.updatedAt = rawRecord.updatedAt
  }
  if (typeof rawRecord.endedAt === 'number' && Number.isFinite(rawRecord.endedAt)) {
    entry.endedAt = rawRecord.endedAt
  }

  const hitsCountFromArray = countValidHits(rawRecord.hits)
  const hits = normalizeHits(rawRecord.hits)
  if (hits && hits.length > 0) entry.hits = hits

  const error = readOptionalString(rawRecord.error)
  if (error) entry.error = error
  const summary = readOptionalString(rawRecord.summary)
  if (summary) entry.summary = summary

  if (rawRecord.details && typeof rawRecord.details === 'object') {
    const candidate = rawRecord.details as Record<string, unknown>
    const normalized: ToolLogDetails = {}
    if (typeof candidate.code === 'string') normalized.code = candidate.code
    if (typeof candidate.input === 'string') normalized.input = candidate.input
    if (typeof candidate.stdout === 'string') normalized.stdout = candidate.stdout
    if (typeof candidate.stderr === 'string') normalized.stderr = candidate.stderr
    if (typeof candidate.exitCode === 'number' && Number.isFinite(candidate.exitCode)) {
      normalized.exitCode = candidate.exitCode
    }
    if (typeof candidate.durationMs === 'number' && Number.isFinite(candidate.durationMs)) {
      normalized.durationMs = candidate.durationMs
    }
    if (typeof candidate.truncated === 'boolean') normalized.truncated = candidate.truncated
    for (const [key, value] of Object.entries(candidate)) {
      if (
        key === 'code' ||
        key === 'input' ||
        key === 'stdout' ||
        key === 'stderr' ||
        key === 'exitCode' ||
        key === 'durationMs' ||
        key === 'truncated'
      ) {
        continue
      }
      if (value !== undefined) normalized[key] = value
    }
    if (Object.keys(normalized).length > 0) entry.details = normalized
  } else if (hitsCountFromArray > 0) {
    entry.details = { hitsCount: hitsCountFromArray }
  }

  return entry
}

export interface LegacyCompactedMarkerMatch {
  isMarker: boolean
  /** 旧 marker 的 summary 记录了原本有多少条事件被压掉。 */
  droppedRecords?: number
}

const COMPACTED_MARKER_SUMMARY = /^(?:(\d+)\s+)?tool events compacted to fit size limit$/i

/** 识别旧 512KB 兜底写入的 compacted 伪记录（不是真实工具调用）。 */
export const detectLegacyCompactedMarker = (
  rawRecord: Record<string, unknown>,
  entry: ToolLogEntry,
): LegacyCompactedMarkerMatch => {
  if (entry.tool === 'compacted') return { isMarker: true }
  if (entry.details?.truncated !== true) return { isMarker: false }
  const summary = typeof rawRecord.summary === 'string' ? rawRecord.summary.trim() : ''
  const matched = COMPACTED_MARKER_SUMMARY.exec(summary)
  if (!matched) return { isMarker: false }
  const parsed = matched[1] ? Number.parseInt(matched[1], 10) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0
    ? { isMarker: true, droppedRecords: parsed }
    : { isMarker: true }
}
