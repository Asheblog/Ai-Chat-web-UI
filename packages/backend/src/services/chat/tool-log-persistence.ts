/**
 * 工具日志持久化：分层压缩与 v2 信封序列化。
 *
 * 不变量：
 * - 返回 string | null，字节数不超过 maxBytes（极小预算连空信封都放不下时返回 null）。
 * - 压缩只裁内容，不吞身份：id / callId / status / phase / source / 时间 / parentCallId 恒定保留。
 * - 丢记录写 droppedRecords，裁字段写 truncatedFields；两者分别计量，绝不伪造成功记录或 compacted marker。
 */
import { buildToolLogCoverage, type ToolLogCoverage } from '@aichat/shared/tool-operations'
import {
  TOOL_LOG_EXTREME_DETAIL_KEYS,
  TOOL_LOG_PRESERVED_DETAIL_KEYS,
  type ToolLogEntry,
  type ToolLogRunResult,
} from './tool-log-model'
import {
  copyIdentity,
  countLostFields,
  pickDetails,
  sanitizeEntry,
  type SerializedEntry,
} from './tool-log-sanitize'

export { sanitizeToolLogEntryForPersistence } from './tool-log-sanitize'

export const TOOL_LOG_ENVELOPE_VERSION = 2

const DEFAULT_TOOL_LOGS_MAX_BYTES = 512 * 1024

export interface ToolLogPersistenceOptions {
  maxBytes?: number
  runResult?: ToolLogRunResult
}

interface EnvelopeBuild {
  json: string
  bytes: number
}

const compressToSummary = (item: SerializedEntry): SerializedEntry => {
  const source = item.entry
  const entry: ToolLogEntry = {
    id: source.id,
    tool: source.tool,
    stage: source.stage,
    createdAt: source.createdAt,
  }
  copyIdentity(entry, source)
  if (source.query) entry.query = source.query
  if (source.summary) entry.summary = source.summary
  if (source.error) entry.error = source.error
  const details = pickDetails(source.details, TOOL_LOG_PRESERVED_DETAIL_KEYS)
  if (details) entry.details = { ...details, storageTruncated: true }
  return { entry, truncatedFields: item.truncatedFields + countLostFields(source, entry) }
}

const compressToExtreme = (item: SerializedEntry): SerializedEntry => {
  const source = item.entry
  const entry: ToolLogEntry = {
    id: source.id,
    tool: source.tool,
    stage: source.stage,
    createdAt: source.createdAt,
  }
  copyIdentity(entry, source)
  const details = pickDetails(source.details, TOOL_LOG_EXTREME_DETAIL_KEYS)
  if (details) entry.details = { ...details, storageTruncated: true }
  return { entry, truncatedFields: item.truncatedFields + countLostFields(source, entry) }
}

const normalizeRunResult = (input?: ToolLogRunResult): ToolLogRunResult | undefined => {
  if (!input) return undefined
  const result: ToolLogRunResult = {}
  if (input.stopReason === 'stop_tools' || input.stopReason === 'budget_exhausted') {
    result.stopReason = input.stopReason
  }
  if (typeof input.finalAnswerGenerated === 'boolean') {
    result.finalAnswerGenerated = input.finalAnswerGenerated
  }
  return Object.keys(result).length > 0 ? result : undefined
}

const resolveAsOf = (logs: ToolLogEntry[]): number => {
  let asOf = 0
  for (const log of logs) {
    for (const value of [log.createdAt, log.updatedAt, log.endedAt]) {
      if (typeof value === 'number' && Number.isFinite(value) && value > asOf) asOf = value
    }
  }
  return asOf
}

const buildCoverage = (
  total: number,
  items: SerializedEntry[],
  asOf: number,
): ToolLogCoverage => {
  const droppedRecords = Math.max(0, total - items.length)
  const truncatedFields = items.reduce((sum, item) => sum + item.truncatedFields, 0)
  const status = droppedRecords > 0 || truncatedFields > 0 ? 'partial' : 'complete'
  return buildToolLogCoverage({
    trace: 'unknown',
    persisted: {
      status,
      asOf,
      ...(droppedRecords > 0 ? { droppedRecords } : {}),
      ...(truncatedFields > 0 ? { truncatedFields } : {}),
    },
    projection: 'unknown',
  })
}

const buildEnvelope = (
  total: number,
  items: SerializedEntry[],
  asOf: number,
  runResult?: ToolLogRunResult,
): EnvelopeBuild => {
  const payload: Record<string, unknown> = {
    v: TOOL_LOG_ENVELOPE_VERSION,
    entries: items.map((item) => item.entry),
    coverage: buildCoverage(total, items, asOf),
  }
  if (runResult) payload.runResult = runResult
  const json = JSON.stringify(payload)
  return { json, bytes: Buffer.byteLength(json, 'utf-8') }
}

/**
 * 工具日志持久化序列化入口（v2 信封）。
 * options 兼容旧的 number 形式（maxBytes）。压缩阶梯：
 * 1. 全部条目瘦身            2. 保留首 2 尾 5，中间压成摘要
 * 3. 全部压成摘要            4. 全部压成极简
 * 5. 二分保留最新 K 条极简   6. 只剩空 entries 信封（如实记录 droppedRecords）
 */
export const serializeToolLogsForPersistence = (
  logs: ToolLogEntry[],
  options?: number | ToolLogPersistenceOptions,
): string | null => {
  if (!Array.isArray(logs)) return null

  const resolved: ToolLogPersistenceOptions =
    typeof options === 'number' ? { maxBytes: options } : options ?? {}
  const limit = resolved.maxBytes ?? DEFAULT_TOOL_LOGS_MAX_BYTES
  const runResult = normalizeRunResult(resolved.runResult)

  // 没有任何工具记录时，仍要能落运行结果：stop 在首个工具之前、预算耗尽的收尾轮都属这种情况。
  // 没有 runResult 时保持旧契约返回 null（不凭空造信封）。
  if (logs.length === 0) {
    if (!runResult) return null
    const emptyEnvelope = JSON.stringify({
      v: TOOL_LOG_ENVELOPE_VERSION,
      entries: [],
      coverage: buildToolLogCoverage({
        trace: 'unknown',
        persisted: { status: 'complete' },
        projection: 'unknown',
      }),
      runResult,
    })
    return Buffer.byteLength(emptyEnvelope, 'utf-8') <= limit ? emptyEnvelope : null
  }
  const asOf = resolveAsOf(logs)
  const total = logs.length

  const sanitized = logs.map(sanitizeEntry)
  const build = (items: SerializedEntry[]) => buildEnvelope(total, items, asOf, runResult)

  const full = build(sanitized)
  if (full.bytes <= limit) return full.json

  if (total > 7) {
    const KEEP_FIRST = 2
    const KEEP_LAST = 5
    const mixed = sanitized.map((item, index) =>
      index < KEEP_FIRST || index >= total - KEEP_LAST ? item : compressToSummary(item),
    )
    const mixedBuild = build(mixed)
    if (mixedBuild.bytes <= limit) return mixedBuild.json
  }

  const allSummary = sanitized.map(compressToSummary)
  const summaryBuild = build(allSummary)
  if (summaryBuild.bytes <= limit) return summaryBuild.json

  const allExtreme = allSummary.map(compressToExtreme)
  const extremeBuild = build(allExtreme)
  if (extremeBuild.bytes <= limit) return extremeBuild.json

  let lo = 1
  let hi = allExtreme.length
  let best: string | null = null
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2)
    const candidate = build(allExtreme.slice(allExtreme.length - mid))
    if (candidate.bytes <= limit) {
      best = candidate.json
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  if (best) return best

  // 连一条极简记录都放不下：只写空信封，如实记录丢了多少条，不伪造 compacted 成功记录。
  const emptyBuild = build([])
  return emptyBuild.bytes <= limit ? emptyBuild.json : null
}
