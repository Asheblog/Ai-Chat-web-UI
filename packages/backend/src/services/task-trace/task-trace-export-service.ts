import type { TraceFileStatus } from './task-trace-file-service'

export interface TraceOmissionCounts {
  noise: number
  normal: number
  critical: number
}

export interface TraceOverflowFlags {
  noise: boolean
  normal: boolean
  critical: boolean
}

/**
 * 导出完整性：让「文件缺失 / 部分损坏 / 有事件未写入」在文件正文里说清楚，
 * 而不是靠 HTTP 200 让调用方以为拿到的是完整记录。
 */
export interface TraceExportIntegrity {
  fileStatus: TraceFileStatus
  corruptLines: number
  /** 读取上限导致本次导出不完整（正常导出不会发生，保留以暴露异常）。 */
  exportTruncated?: boolean
  omitted?: TraceOmissionCounts | null
  overflow?: TraceOverflowFlags | null
  /** 文件不可用时的中文原因，由 API 传入。 */
  missingReason?: string | null
  /** 实际读取的事件文件路径（导出必须能定位来源）。 */
  sourcePath?: string | null
  /** 路径解析方式：stored / legacy-remap，便于判断是否走了旧目录映射。 */
  resolvedVia?: string | null
}

export interface TraceExportInput {
  id: number
  status: string | null
  actor: string | null
  sessionId: number | null
  messageId: number | null
  clientMessageId: string | null
  traceLevel: string | null
  startedAt: Date | string | null
  endedAt: Date | string | null
  durationMs: number | null
  metadata: Record<string, any> | null
  events: Array<{ seq?: number | null; timestamp?: string | null; eventType?: string | null; [key: string]: any }>
  eventCount?: number | null
  integrity?: TraceExportIntegrity | null
}

export interface LatexExportInput {
  id: number
  taskTraceId: number
  status: string | null
  matchedBlocks: number | null
  unmatchedBlocks: number | null
  createdAt: Date | string | null
  updatedAt: Date | string | null
  metadata: Record<string, any> | null
  events: Array<Record<string, any>>
  integrity?: TraceExportIntegrity | null
}

const formatDate = (value: Date | string | null | undefined) => {
  if (!value) return '-'
  try {
    const d = value instanceof Date ? value : new Date(value)
    return d.toISOString()
  } catch {
    return String(value)
  }
}

const UNAVAILABLE_FILE_STATUSES: TraceFileStatus[] = ['missing', 'unreadable', 'corrupt']

const collectWarnings = (
  integrity: TraceExportIntegrity | null | undefined,
  eventCount: number,
): { headerLines: string[]; warnings: string[] } => {
  const headerLines: string[] = []
  const warnings: string[] = []
  if (!integrity) return { headerLines, warnings }

  headerLines.push(`File status: ${integrity.fileStatus}`)
  if (integrity.sourcePath) {
    headerLines.push(`Event file: ${integrity.sourcePath}`)
  }
  if (integrity.resolvedVia && integrity.resolvedVia !== 'stored') {
    headerLines.push(`Event file resolved via: ${integrity.resolvedVia}`)
  }

  const omitted = integrity.omitted
  const omittedTotal = omitted ? omitted.noise + omitted.normal + omitted.critical : 0
  if (omittedTotal > 0) {
    headerLines.push(`Omitted events: noise=${omitted!.noise}, normal=${omitted!.normal}, critical=${omitted!.critical}`)
    warnings.push(
      `噪声或超限事件未写入事件文件：noise=${omitted!.noise}, normal=${omitted!.normal}, critical=${omitted!.critical}。` +
        '这些事件因分层预算被丢弃，数据库 eventCount 只统计已写入条数。',
    )
  }
  if (integrity.corruptLines > 0) {
    headerLines.push(`Unparsed lines: ${integrity.corruptLines}`)
    warnings.push(`有 ${integrity.corruptLines} 行无法解析，已跳过；本文件不是完整事件序列。`)
  }
  if (integrity.exportTruncated) {
    warnings.push(`本次导出只读取了前 ${eventCount} 条事件，其余事件未包含在文件中。`)
  }
  if (UNAVAILABLE_FILE_STATUSES.includes(integrity.fileStatus)) {
    const reason = integrity.missingReason ?? '追踪事件文件不可用'
    warnings.push(`${reason}：本次导出仅包含数据库元数据，没有事件正文。`)
  }
  return { headerLines, warnings }
}

export const buildTraceExport = (input: TraceExportInput): string => {
  const lines: string[] = []
  lines.push(`Trace #${input.id}`)
  lines.push(`Status: ${input.status ?? '-'}`)
  lines.push(`Actor: ${input.actor ?? '-'}`)
  lines.push(`Session: ${input.sessionId ?? '-'}`)
  lines.push(`Message: ${input.messageId ?? '-'}`)
  lines.push(`Client ID: ${input.clientMessageId ?? '-'}`)
  lines.push(`Level: ${input.traceLevel ?? '-'}`)
  lines.push(`Started: ${formatDate(input.startedAt)}`)
  lines.push(`Ended: ${formatDate(input.endedAt)}`)
  if (typeof input.durationMs === 'number') {
    lines.push(`Duration(ms): ${input.durationMs}`)
  }
  if (typeof input.eventCount === 'number') {
    lines.push(`Event count (persisted): ${input.eventCount}`)
  }
  const { headerLines, warnings } = collectWarnings(input.integrity, input.events.length)
  lines.push(...headerLines)
  if (warnings.length > 0) {
    lines.push('Warnings:')
    for (const warning of warnings) lines.push(`- ${warning}`)
  }
  lines.push('--- Metadata ---')
  lines.push(JSON.stringify(input.metadata ?? {}, null, 2))
  lines.push('--- Events ---')
  for (const evt of input.events) {
    const seq = typeof evt.seq === 'number' ? evt.seq : null
    const ts = evt.timestamp ? formatDate(evt.timestamp) : ''
    const type = evt.eventType || evt.type || 'event'
    lines.push(`[${seq != null ? seq.toString().padStart(4, '0') : '----'}] ${ts} ${type}`)
    const { seq: _seq, eventType: _et, type: _t, timestamp: _ts, ...rest } = evt
    lines.push(JSON.stringify(rest, null, 2))
  }
  return lines.join('\n')
}

export const buildLatexExport = (input: LatexExportInput): string => {
  const lines: string[] = []
  lines.push(`Latex Trace #${input.id} (Task Trace #${input.taskTraceId})`)
  lines.push(`Status: ${input.status ?? '-'}`)
  lines.push(`Matched Blocks: ${input.matchedBlocks ?? '-'}`)
  lines.push(`Unmatched Blocks: ${input.unmatchedBlocks ?? '-'}`)
  lines.push(`Created At: ${formatDate(input.createdAt)}`)
  lines.push(`Updated At: ${formatDate(input.updatedAt)}`)
  const { headerLines, warnings } = collectWarnings(input.integrity, input.events.length)
  lines.push(...headerLines)
  if (warnings.length > 0) {
    lines.push('Warnings:')
    for (const warning of warnings) lines.push(`- ${warning}`)
  }
  lines.push('--- Metadata ---')
  lines.push(JSON.stringify(input.metadata ?? {}, null, 2))
  lines.push('--- Segments ---')
  for (const ev of input.events) {
    lines.push(JSON.stringify(ev))
  }
  return lines.join('\n')
}
