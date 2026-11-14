/**
 * 工具日志持久化瘦身：按字段上限裁剪内容，并如实计量被裁剪/被删除的字段数。
 * 只裁内容与体积，不丢身份：id / callId / status / phase / source / 时间 / details 身份键恒定保留。
 */
import type { WebSearchHit, WebSearchQueryLanguage } from '../../utils/web-search'
import {
  TOOL_LOG_LIMITS,
  isToolLogStatus,
  readOptionalString,
  type ToolLogDetails,
  type ToolLogEntry,
} from './tool-log-model'

export interface SerializedEntry {
  entry: ToolLogEntry
  truncatedFields: number
}

const LARGE_DETAIL_TEXT_KEYS = ['resultText', 'excerpt', 'content', 'attempts'] as const

const KNOWN_DETAIL_KEYS: ReadonlySet<string> = new Set([
  'code',
  'input',
  'stdout',
  'stderr',
  'exitCode',
  'durationMs',
  'truncated',
  ...LARGE_DETAIL_TEXT_KEYS,
])

/** 命中对象上按契约与展示需要保留的字段；未列出的字段一律删除并逐个计量。 */
const RETAINED_HIT_FIELDS: ReadonlySet<string> = new Set([
  'title',
  'url',
  'snippet',
  'imageUrl',
  'image_url',
  'thumbnailUrl',
  'thumbnail_url',
  'thumbnail',
  'engine',
  'query',
  'queryLanguage',
  'rank',
  'sourceEngines',
  'mergeScore',
  'publishedDate',
  'siteName',
  'authority',
])

const QUERY_LANGUAGES: readonly WebSearchQueryLanguage[] = ['zh', 'en', 'unknown']

export const clip = (value: string, max: number): string =>
  value.length > max ? value.slice(0, max) : value

export const copyIdentity = (target: ToolLogEntry, source: ToolLogEntry): void => {
  if (isToolLogStatus(source.status)) target.status = source.status
  if (source.phase) target.phase = source.phase
  if (source.callId) target.callId = source.callId
  if (source.source) target.source = source.source
  if (source.identifier) target.identifier = source.identifier
  if (source.apiName) target.apiName = source.apiName
  if (typeof source.updatedAt === 'number' && Number.isFinite(source.updatedAt)) {
    target.updatedAt = source.updatedAt
  }
  if (typeof source.endedAt === 'number' && Number.isFinite(source.endedAt)) {
    target.endedAt = source.endedAt
  }
}

export const pickDetails = (
  details: ToolLogDetails | undefined,
  keys: readonly string[],
): ToolLogDetails | undefined => {
  if (!details) return undefined
  const picked: ToolLogDetails = {}
  for (const key of keys) {
    const value = (details as Record<string, unknown>)[key]
    if (value !== undefined && value !== null) {
      ;(picked as Record<string, unknown>)[key] = value
    }
  }
  return Object.keys(picked).length > 0 ? picked : undefined
}

/** 压缩前后同一条记录的字段损失计数（truncated/storageTruncated 是标记本身，不参与比较）。 */
export const countLostFields = (before: ToolLogEntry, after: ToolLogEntry): number => {
  let lost = 0
  for (const key of Object.keys(before) as Array<keyof ToolLogEntry>) {
    if (key === 'details') continue
    const value = before[key]
    if (value === undefined || value === null) continue
    if (after[key] === undefined) lost += 1
  }
  const beforeDetails = (before.details ?? {}) as Record<string, unknown>
  const afterDetails = (after.details ?? {}) as Record<string, unknown>
  for (const key of Object.keys(beforeDetails)) {
    if (key === 'truncated' || key === 'storageTruncated') continue
    const value = beforeDetails[key]
    if (value === undefined || value === null) continue
    if (afterDetails[key] === undefined) lost += 1
  }
  return lost
}

interface HitSanitizeResult {
  hit: WebSearchHit
  lostFields: number
}

const sanitizeHit = (hit: WebSearchHit): HitSanitizeResult => {
  const raw = hit as unknown as Record<string, unknown>
  let lostFields = 0
  const slim: WebSearchHit = { title: hit.title, url: hit.url }

  if (typeof raw.snippet === 'string' && raw.snippet) {
    const snippet = clip(raw.snippet, TOOL_LOG_LIMITS.hitSnippetChars)
    slim.snippet = snippet
    if (snippet.length < raw.snippet.length) lostFields += 1
  }

  const imageUrl = readOptionalString(raw.imageUrl) ?? readOptionalString(raw.image_url)
  if (imageUrl) slim.imageUrl = imageUrl
  const thumbnailUrl =
    readOptionalString(raw.thumbnailUrl) ??
    readOptionalString(raw.thumbnail_url) ??
    readOptionalString(raw.thumbnail)
  if (thumbnailUrl) slim.thumbnailUrl = thumbnailUrl

  const engine = readOptionalString(raw.engine)
  if (engine) slim.engine = engine
  const query = typeof raw.query === 'string' ? raw.query : undefined
  if (query) slim.query = query
  if (typeof raw.queryLanguage === 'string' && QUERY_LANGUAGES.includes(raw.queryLanguage as WebSearchQueryLanguage)) {
    slim.queryLanguage = raw.queryLanguage as WebSearchQueryLanguage
  }
  if (typeof raw.rank === 'number' && Number.isFinite(raw.rank)) slim.rank = raw.rank
  if (Array.isArray(raw.sourceEngines)) {
    const engines = raw.sourceEngines.filter((item): item is string => typeof item === 'string')
    if (engines.length > 0) slim.sourceEngines = engines
  }
  if (typeof raw.mergeScore === 'number' && Number.isFinite(raw.mergeScore)) {
    slim.mergeScore = raw.mergeScore
  }
  const publishedDate = readOptionalString(raw.publishedDate)
  if (publishedDate) slim.publishedDate = publishedDate
  const siteName = readOptionalString(raw.siteName)
  if (siteName) slim.siteName = siteName
  if (typeof raw.authority === 'number' && Number.isFinite(raw.authority)) {
    slim.authority = raw.authority
  }

  for (const key of Object.keys(raw)) {
    if (RETAINED_HIT_FIELDS.has(key)) continue
    const value = raw[key]
    if (value === undefined || value === null) continue
    lostFields += 1
  }

  return { hit: slim, lostFields }
}

export const sanitizeEntry = (entry: ToolLogEntry): SerializedEntry => {
  let truncatedFields = 0
  let detailsTruncated = false

  const result: ToolLogEntry = {
    id: entry.id,
    tool: entry.tool,
    stage: entry.stage,
    createdAt: entry.createdAt,
  }
  copyIdentity(result, entry)

  if (entry.query) {
    result.query = clip(entry.query, TOOL_LOG_LIMITS.queryChars)
    if (result.query.length < entry.query.length) truncatedFields += 1
  }
  if (entry.error) {
    result.error = clip(entry.error, TOOL_LOG_LIMITS.errorChars)
    if (result.error.length < entry.error.length) truncatedFields += 1
  }
  if (entry.summary) {
    result.summary = clip(entry.summary, TOOL_LOG_LIMITS.summaryChars)
    if (result.summary.length < entry.summary.length) truncatedFields += 1
  }

  if (Array.isArray(entry.hits) && entry.hits.length > 0) {
    if (entry.hits.length > TOOL_LOG_LIMITS.hits) truncatedFields += 1
    result.hits = entry.hits.slice(0, TOOL_LOG_LIMITS.hits).map((hit) => {
      const sanitizedHit = sanitizeHit(hit)
      truncatedFields += sanitizedHit.lostFields
      return sanitizedHit.hit
    })
  }

  if (entry.details && Object.keys(entry.details).length > 0) {
    const source = entry.details as Record<string, unknown>
    const sanitized: ToolLogDetails = {}

    const takeString = (key: string) => {
      const value = source[key]
      if (typeof value !== 'string') return
      const clipped = clip(value, TOOL_LOG_LIMITS.detailStringChars)
      ;(sanitized as Record<string, unknown>)[key] = clipped
      if (clipped.length < value.length) {
        truncatedFields += 1
        detailsTruncated = true
      }
    }

    takeString('code')
    takeString('input')
    takeString('stdout')
    takeString('stderr')
    if (typeof source.exitCode === 'number') sanitized.exitCode = source.exitCode
    if (typeof source.durationMs === 'number') sanitized.durationMs = source.durationMs

    for (const key of LARGE_DETAIL_TEXT_KEYS) {
      const value = source[key]
      if (typeof value === 'string') {
        const clipped = clip(value, TOOL_LOG_LIMITS.detailStringChars)
        ;(sanitized as Record<string, unknown>)[key] = clipped
        if (clipped.length < value.length) {
          truncatedFields += 1
          detailsTruncated = true
        }
      } else if (Array.isArray(value)) {
        const sliced = value.slice(0, TOOL_LOG_LIMITS.detailArrayItems)
        if (sliced.length < value.length) {
          truncatedFields += 1
          detailsTruncated = true
        }
        ;(sanitized as Record<string, unknown>)[key] = sliced
      }
    }

    for (const [key, value] of Object.entries(source)) {
      if (KNOWN_DETAIL_KEYS.has(key)) continue
      if (value !== undefined && value !== null) {
        ;(sanitized as Record<string, unknown>)[key] = value
      }
    }

    // 运行时截断证据原样保留（shared 据此判降级）；本层自己的裁剪只写 storageTruncated。
    if (typeof source.truncated === 'boolean') sanitized.truncated = source.truncated
    if (detailsTruncated) sanitized.storageTruncated = true
    if (Object.keys(sanitized).length > 0) result.details = sanitized
  }

  return { entry: result, truncatedFields }
}

/** 对单条工具日志做持久化瘦身，返回新对象（不修改原始对象）。 */
export const sanitizeToolLogEntryForPersistence = (entry: ToolLogEntry): ToolLogEntry =>
  sanitizeEntry(entry).entry
