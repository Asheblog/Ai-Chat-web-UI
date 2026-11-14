/**
 * Trace97：只回放导出真实保留的 10 条明细。
 *
 * 口径（来自 .figma/process-workspace/trace97-summary.json，不是推算）：
 * - 454：整轮按 id 合并后的最终记录数（父调用 + 子任务），导出没有逐条 payload
 * - 378：观测窗口内的工具生命周期更新（189 start + 61 result + 128 error），不是唯一失败数
 * - 10：导出实际保留的明细条数
 * 因此本文件绝不补造 resultText / hits / attempts / 原始 JSON；父子关系只来自导出 id
 * 的前缀命名（`父callId:phase:n`），并在来源横幅里写明这一点。
 */
import trace97Json from '../trace97.json'
import type { ProcessWorkspaceEntryProps } from '@/features/chat/process-workspace/types'
import type { ToolCallStatus, ToolEventStage } from '@aichat/shared/chat-stream-contract'
import { PREVIEW_BASE_TIME, at, previewEvent, previewMeta } from './primitives'

interface Trace97Record {
  id: string
  tool: string
  stage: string
  status: string
  query: string
  summary: string
  error?: string
  createdAt: string
}

interface Trace97Export {
  label: string
  startedAt: string
  endedAt: string
  durationMs: number
  reportedFinalRecordCount: number
  lifecycleUpdateCount: number
  traceWindowEndedAt: string
  records: Trace97Record[]
}

const dataset = trace97Json as unknown as Trace97Export

export const TRACE97_DATASET = {
  finalRecordCount: dataset.reportedFinalRecordCount,
  lifecycleUpdateCount: dataset.lifecycleUpdateCount,
  retainedDetailCount: dataset.records.length,
  startedAt: Date.parse(dataset.startedAt),
  turnEndedAt: Date.parse(dataset.endedAt),
  traceWindowEndedAt: Date.parse(dataset.traceWindowEndedAt),
  durationMs: dataset.durationMs,
} as const

/** 导出里唯一一条写明回退的记录；导出没有 attempts 字段，所以不写尝试次数。 */
const FALLBACK_NOTE: Record<string, string> = {
  'call_dnfg5dox:read:1': 'search_snippet',
}

const parentCallIdOf = (id: string): string | undefined => {
  const separator = id.indexOf(':')
  return separator > 0 ? id.slice(0, separator) : undefined
}

const target = { sessionId: 184, messageId: 184 }

const events = dataset.records.map(record => {
  const parentCallId = parentCallIdOf(record.id)
  const fallbackUsed = FALLBACK_NOTE[record.id]
  return previewEvent(target, {
    id: record.id,
    tool: record.tool,
    stage: record.stage as ToolEventStage,
    status: record.status as ToolCallStatus,
    offset: Date.parse(record.createdAt) - PREVIEW_BASE_TIME,
    parentCallId,
    query: record.query,
    summary: record.summary,
    error: record.error,
    details: fallbackUsed ? { fallbackUsed } : undefined,
  })
})

const meta = previewMeta({
  stableKey: 'preview-trace97-184',
  sessionId: 184,
  id: 184,
  createdAt: dataset.startedAt,
  reasoningDurationSeconds: Math.round(dataset.durationMs / 1000),
  finalAnswerGenerated: true,
})

export const trace97Case: ProcessWorkspaceEntryProps = {
  meta,
  reasoningRaw: '',
  toolEvents: events,
  content: [
    '## Trace #97：只还原导出里确实存在的记录',
    '',
    `这一轮整轮耗时 ${Math.round(dataset.durationMs / 1000)} 秒，按 id 合并后是 454 条最终记录，其中父调用与子任务同名不同层，不能相加当成调用次数。`,
    '',
    '原导出只保留了 10 条明细，其余记录只有计数没有 payload，因此这里不展示原文、命中列表和尝试次数，也不计算成功率。',
    '',
    '窗口内的工具生命周期更新是 378 次（189 start + 61 result + 128 error），它统计的是更新而不是唯一失败调用，所以同样不并入上面的记录数。',
  ].join('\n'),
  coverage: {
    trace: {
      status: 'partial',
      startedAt: TRACE97_DATASET.startedAt,
      turnEndedAt: TRACE97_DATASET.traceWindowEndedAt,
    },
    persisted: { status: 'partial', asOf: TRACE97_DATASET.turnEndedAt },
    projection: { status: 'partial' },
  },
  runTerminal: { finalAnswerGenerated: true },
}

export const trace97Window = {
  start: TRACE97_DATASET.startedAt,
  end: TRACE97_DATASET.traceWindowEndedAt,
  turnEndedAt: TRACE97_DATASET.turnEndedAt,
  /** 便于页面直接展示，不参与任何计算 */
  at,
}
