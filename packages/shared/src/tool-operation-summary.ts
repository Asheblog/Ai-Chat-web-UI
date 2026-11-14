/**
 * ToolOperationSummary —— 台账计数口径。
 *
 * 每个数字直接数出来，不用相减推算：
 * - parentCalls：无父声明的顶层调用数（= index.roots 长度）
 * - subtasks：通过唯一 parentCallId 连接到父记录的子记录数
 * - orphans / ambiguous：父候选缺失 / 父候选不唯一且未连接的记录数
 * - failedOperations：outcome=failed 的唯一记录数
 * - affectedParentCalls：自身或后代存在 failed/rejected/aborted 的根调用数（每个根至多 1 次）
 * - stages / statuses：阶段与生命周期更新分别计数，不与业务结果混用
 * - attempts：只统计有 attempts 证据的记录；无证据为 null，不写 0
 * - coverage：来源覆盖，与执行结果分开
 */
import type { ToolLogCoverage } from './tool-operation-coverage.js'
import type { ToolOperationIndex } from './tool-operation-index.js'

export interface ToolOperationStageCounts {
  start: number
  result: number
  error: number
}

export interface ToolOperationStatusCounts {
  running: number
  success: number
  error: number
  pending: number
  rejected: number
  aborted: number
}

export type ToolOperationAttemptsEvidence = 'complete' | 'partial' | 'unknown'

export interface ToolOperationSummary {
  /** 唯一记录数（同 id 重复事件已合并） */
  totalOperations: number
  /** 父调用数：无父声明的顶层调用 */
  parentCalls: number
  /** 子任务数：唯一连接成功的子记录 */
  subtasks: number
  /** 父候选缺失的记录数 */
  orphans: number
  /** 父候选不唯一、未连接的记录数 */
  ambiguous: number
  succeeded: number
  failedOperations: number
  rejected: number
  aborted: number
  inFlight: number
  unknownOutcome: number
  degraded: number
  /** 受影响的父调用数：按根去重，每个根至多 1 次 */
  affectedParentCalls: number
  stages: ToolOperationStageCounts
  statuses: ToolOperationStatusCounts
  /** 有证据的尝试次数合计；无证据为 null */
  attempts: number | null
  /** attempts 的证据完整度 */
  attemptsEvidence: ToolOperationAttemptsEvidence
  /** 被合并掉的重复副本数 */
  duplicateCount: number
  coverage: ToolLogCoverage
  /** 台账中文摘要（不含未确证数字） */
  summaryText: string
}

const AFFECTING_OUTCOMES = new Set(['failed', 'rejected', 'aborted'])

const hasAffectingDescendant = (
  id: string,
  index: ToolOperationIndex,
  byId: Map<string, ToolOperationIndex['records'][number]>,
  visited: Set<string>,
): boolean => {
  if (visited.has(id)) return false
  visited.add(id)
  const record = byId.get(id)
  if (!record) return false
  if (AFFECTING_OUTCOMES.has(record.outcome)) return true
  return (index.children[id] ?? []).some((childId) =>
    hasAffectingDescendant(childId, index, byId, visited),
  )
}

export const buildToolOperationSummary = (index: ToolOperationIndex): ToolOperationSummary => {
  const records = index.records ?? []
  const byId = new Map(records.map((record) => [record.id, record]))

  const stages: ToolOperationStageCounts = { start: 0, result: 0, error: 0 }
  const statuses: ToolOperationStatusCounts = {
    running: 0,
    success: 0,
    error: 0,
    pending: 0,
    rejected: 0,
    aborted: 0,
  }

  let succeeded = 0
  let failedOperations = 0
  let rejected = 0
  let aborted = 0
  let inFlight = 0
  let unknownOutcome = 0
  let degraded = 0
  let attemptsTotal = 0
  let attemptsRecords = 0

  for (const record of records) {
    if (record.outcome === 'succeeded') succeeded += 1
    else if (record.outcome === 'failed') failedOperations += 1
    else if (record.outcome === 'rejected') rejected += 1
    else if (record.outcome === 'aborted') aborted += 1
    else if (record.outcome === 'in_flight') inFlight += 1
    else unknownOutcome += 1

    if (record.degraded) degraded += 1
    stages[record.stage] += 1
    statuses[record.status] += 1

    if (record.recovery.attempts !== undefined) {
      attemptsTotal += record.recovery.attempts
      attemptsRecords += 1
    }
  }

  const affectedParentCalls = index.roots.filter((rootId) =>
    hasAffectingDescendant(rootId, index, byId, new Set<string>()),
  ).length

  const attemptsEvidence: ToolOperationAttemptsEvidence =
    attemptsRecords === 0
      ? 'unknown'
      : attemptsRecords === records.length
        ? 'complete'
        : 'partial'

  const summary: ToolOperationSummary = {
    totalOperations: records.length,
    parentCalls: index.roots.length,
    subtasks: records.filter((record) => record.relation === 'child').length,
    orphans: index.orphans.length,
    ambiguous: index.ambiguous.length,
    succeeded,
    failedOperations,
    rejected,
    aborted,
    inFlight,
    unknownOutcome,
    degraded,
    affectedParentCalls,
    stages,
    statuses,
    attempts: attemptsRecords === 0 ? null : attemptsTotal,
    attemptsEvidence,
    duplicateCount: index.duplicateCount,
    coverage: index.coverage,
    summaryText: '',
  }
  summary.summaryText = buildSummaryText(summary)
  return summary
}

const buildSummaryText = (summary: ToolOperationSummary): string => {
  const parts: string[] = []
  if (summary.parentCalls > 0) parts.push(`父调用 ${summary.parentCalls} 次`)
  if (summary.subtasks > 0) parts.push(`子任务 ${summary.subtasks} 次`)
  if (summary.failedOperations > 0) parts.push(`失败 ${summary.failedOperations} 次`)
  if (summary.rejected > 0) parts.push(`未获许可 ${summary.rejected} 次`)
  if (summary.aborted > 0) parts.push(`中止 ${summary.aborted} 次`)
  if (summary.degraded > 0) parts.push(`降级 ${summary.degraded} 次`)
  if (summary.orphans > 0) parts.push(`归属未知 ${summary.orphans} 次`)
  if (summary.ambiguous > 0) parts.push(`父调用歧义 ${summary.ambiguous} 次`)
  if (summary.affectedParentCalls > 0) parts.push(`影响 ${summary.affectedParentCalls} 个父调用`)
  if (summary.inFlight > 0) parts.push(`进行中 ${summary.inFlight} 次`)
  return parts.join(' · ')
}
