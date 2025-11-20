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
  lines.push('--- Metadata ---')
  lines.push(JSON.stringify(input.metadata ?? {}, null, 2))
  lines.push('--- Segments ---')
  for (const ev of input.events) {
    lines.push(JSON.stringify(ev))
  }
  return lines.join('\n')
}
