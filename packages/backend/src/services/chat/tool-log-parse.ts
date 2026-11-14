/**
 * 工具日志读取：v2 信封 / 旧数组解析，覆盖层透出。
 *
 * 不变量：
 * - 旧数组与未知形状一律 persisted/trace = unknown，绝不升级为 complete；
 *   仅当旧数据里确实存在 compacted marker（丢过记录）时才标 partial 并写能确证的条数。
 * - runResult 只透出实际存在的字段，不从 aborted / 空正文推断。
 * - 读取不伪造状态与成功记录；投影缺口如实计量到 projection.truncatedFields。
 */
import {
  buildToolLogCoverage,
  type ToolLogCoverage,
  type ToolLogCoverageLayer,
} from '@aichat/shared/tool-operations'
import { TOOL_LOG_ENVELOPE_VERSION } from './tool-log-persistence'
import type {
  ToolLogEntry,
  ToolLogRunResult,
  ToolRunStopReason,
} from './tool-log-model'
import {
  createLegacyIdAllocator,
  detectLegacyCompactedMarker,
  parseSingleEntry,
} from './tool-log-entry-parse'
import {
  buildProjectionLayer,
  countProjectionLosses,
  projectEntryForHistoryList,
} from './tool-log-projection'

export type ParseToolLogsMode = 'full' | 'history-list'

export interface ParseToolLogsOptions {
  mode?: ParseToolLogsMode
}

export interface ParsedToolLogsPayload {
  entries: ToolLogEntry[]
  coverage: ToolLogCoverage
  runResult?: ToolLogRunResult
}

interface MarkerGap {
  count: number
  droppedRecords: number
}

interface ParsedEntries {
  entries: ToolLogEntry[]
  projectionLosses: number
  markerGap: MarkerGap
}

const parseEntries = (rawEntries: unknown[], mode: ParseToolLogsMode): ParsedEntries => {
  const allocateLegacyId = createLegacyIdAllocator()
  const markerGap: MarkerGap = { count: 0, droppedRecords: 0 }
  let projectionLosses = 0
  const entries: ToolLogEntry[] = []

  for (const raw of rawEntries) {
    if (!raw || typeof raw !== 'object') continue
    const rawRecord = raw as Record<string, unknown>
    const entry = parseSingleEntry(rawRecord, allocateLegacyId)
    if (!entry) continue

    const marker = detectLegacyCompactedMarker(rawRecord, entry)
    if (marker.isMarker) {
      markerGap.count += 1
      if (typeof marker.droppedRecords === 'number') {
        markerGap.droppedRecords += marker.droppedRecords
      }
      continue
    }

    const delivered = mode === 'history-list' ? projectEntryForHistoryList(entry) : entry
    projectionLosses += countProjectionLosses(rawRecord, delivered)
    entries.push(delivered)
  }

  return { entries, projectionLosses, markerGap }
}

const readPersistedLayer = (coverage: unknown): ToolLogCoverageLayer => {
  if (!coverage || typeof coverage !== 'object') return { status: 'unknown' }
  const persisted = (coverage as Record<string, unknown>).persisted
  if (!persisted || typeof persisted !== 'object') return { status: 'unknown' }
  const layer = persisted as Record<string, unknown>
  if (layer.status !== 'complete' && layer.status !== 'partial' && layer.status !== 'unknown') {
    return { status: 'unknown' }
  }
  return buildToolLogCoverage({ persisted: layer as unknown as ToolLogCoverageLayer }).persisted
}

/**
 * 旧 compacted marker 证明历史上确有记录被丢弃：把它记进 persisted（partial），
 * 条数只在 marker 自己写明时才落，不猜。
 */
const applyMarkerGap = (layer: ToolLogCoverageLayer, gap: MarkerGap): ToolLogCoverageLayer => {
  if (gap.count === 0) return layer
  const next: ToolLogCoverageLayer = { ...layer, status: 'partial' }
  if (next.droppedRecords === undefined && gap.droppedRecords > 0) {
    next.droppedRecords = gap.droppedRecords
  }
  return next
}

const readRunResult = (value: unknown): ToolLogRunResult | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const result: ToolLogRunResult = {}
  if (record.stopReason === 'stop_tools' || record.stopReason === 'budget_exhausted') {
    result.stopReason = record.stopReason
  }
  if (typeof record.finalAnswerGenerated === 'boolean') {
    result.finalAnswerGenerated = record.finalAnswerGenerated
  }
  return Object.keys(result).length > 0 ? result : undefined
}

const emptyPayload = (): ParsedToolLogsPayload => ({
  entries: [],
  coverage: buildToolLogCoverage(),
})

export const parseToolLogsPayloadJson = (
  raw?: string | null,
  options?: ParseToolLogsOptions,
): ParsedToolLogsPayload => {
  if (!raw || typeof raw !== 'string') return emptyPayload()
  const mode: ParseToolLogsMode = options?.mode === 'history-list' ? 'history-list' : 'full'

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return emptyPayload()
  }

  if (Array.isArray(parsed)) {
    const { entries, projectionLosses, markerGap } = parseEntries(parsed, mode)
    const persisted = applyMarkerGap({ status: 'unknown' }, markerGap)
    return {
      entries,
      coverage: buildToolLogCoverage({
        trace: 'unknown',
        persisted,
        projection: buildProjectionLayer(projectionLosses),
      }),
    }
  }

  if (parsed && typeof parsed === 'object') {
    const envelope = parsed as Record<string, unknown>
    if (envelope.v === TOOL_LOG_ENVELOPE_VERSION && Array.isArray(envelope.entries)) {
      const { entries, projectionLosses, markerGap } = parseEntries(envelope.entries, mode)
      const runResult = readRunResult(envelope.runResult)
      return {
        entries,
        coverage: buildToolLogCoverage({
          trace: 'unknown',
          persisted: applyMarkerGap(readPersistedLayer(envelope.coverage), markerGap),
          projection: buildProjectionLayer(projectionLosses),
        }),
        ...(runResult ? { runResult } : {}),
      }
    }
  }

  return emptyPayload()
}

export const parseToolLogsJson = (
  raw?: string | null,
  options?: ParseToolLogsOptions,
): ToolLogEntry[] => parseToolLogsPayloadJson(raw, options).entries

export interface ToolLogTerminalOutcome {
  stopReason?: ToolRunStopReason
  finalAnswerGenerated?: boolean
}

/**
 * 运行结果转扁平的终止字段：只透出实际存在的字段，缺失保持缺失（不猜 false）。
 */
export const resolveToolLogTerminalOutcome = (
  runResult?: ToolLogRunResult,
): ToolLogTerminalOutcome => {
  if (!runResult) return {}
  const outcome: ToolLogTerminalOutcome = {}
  if (runResult.stopReason) outcome.stopReason = runResult.stopReason
  if (typeof runResult.finalAnswerGenerated === 'boolean') {
    outcome.finalAnswerGenerated = runResult.finalAnswerGenerated
  }
  return outcome
}

/**
 * 判断这条消息是否需要向客户端透出覆盖信息。
 * 无内容且无缺口时不暴露（避免没有工具调用的消息背上 unknown 徽章）；
 * 有空缺口（丢记录/裁字段/partial）时必须暴露，否则缺口被吞掉。
 */
export const resolveMessageToolLogCoverage = (
  parsed: ParsedToolLogsPayload,
): ToolLogCoverage | undefined => {
  if (parsed.entries.length > 0) return parsed.coverage
  const persisted = parsed.coverage.persisted
  const hasKnownLoss =
    persisted.status === 'partial' ||
    (persisted.droppedRecords ?? 0) > 0 ||
    (persisted.truncatedFields ?? 0) > 0
  return hasKnownLoss ? parsed.coverage : undefined
}
