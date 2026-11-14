/**
 * ToolOperationIndex —— 工具调用台账的父子关系投影。
 *
 * - 一条记录 = 一个唯一 id（同 id 重复事件先合并，不重复计数）。
 * - parentCallId 只按父记录的 callId 唯一匹配：无候选 = orphan，多候选且无法用
 *   “无 parent 声明的真实父候选”唯一裁决 = ambiguous；两者都不归入任何 children。
 * - callId 永远不参与记录合并；operationId 只是 id 的派生别名。
 */
import type { ToolCallPhase, ToolCallSource, ToolCallStatus, ToolEventStage } from './chat-stream-contract.js'
import type { ToolEvent } from './tool-events.js'
import { resolveEventStatus } from './tool-events.js'
import {
  isToolOperationDegraded,
  mergeToolOperationCandidates,
  resolveToolOperationId,
  resolveToolOperationOutcome,
  resolveToolOperationRecovery,
  type ToolOperationOutcome,
  type ToolOperationRecovery,
  type ToolOperationSourceLayer,
} from './tool-operation-identity.js'
import {
  buildToolLogCoverage,
  type ToolLogCoverage,
  type ToolLogCoverageInput,
} from './tool-operation-coverage.js'

export type ToolOperationRelation = 'root' | 'child' | 'orphan' | 'ambiguous'

export interface ToolOperationRecord {
  /** 唯一主键：记录 id（操作 identity 只有这一个来源） */
  id: string
  /** id 的派生别名，恒等于 id；禁止用 callId 充当 identity */
  operationId: string
  callId?: string
  /** 记录声明的父 callId（来自 details.parentCallId） */
  parentCallId?: string
  /** 唯一匹配到的父记录 id；root/orphan/ambiguous 为 null */
  parentId: string | null
  relation: ToolOperationRelation
  tool: string
  identifier?: string
  apiName?: string
  source?: ToolCallSource
  stage: ToolEventStage
  phase?: ToolCallPhase
  status: ToolCallStatus
  outcome: ToolOperationOutcome
  /** 降级证据（fallbackUsed / warning / truncated），与 outcome 无关 */
  degraded: boolean
  /** 记录本身被标记截断 */
  truncated: boolean
  recovery: ToolOperationRecovery
  childIds: string[]
  /** 被合并掉的同 id 重复副本数 */
  duplicateCount: number
  /** 合并后的事件，供渲染读取参数/结果/命中 */
  event: ToolEvent
}

export interface ToolOperationIndex {
  records: ToolOperationRecord[]
  /** 无父声明的顶层记录 id（时间线顺序） */
  roots: string[]
  /** 每条记录 id → 其唯一连接到的子记录 id（时间线顺序，无子记录为空数组） */
  children: Record<string, string[]>
  /** 声明了 parentCallId 但无任何父候选 */
  orphans: string[]
  /** 声明了 parentCallId 但候选不唯一，未被连接到任何父记录 */
  ambiguous: string[]
  /** ambiguous 的 parentCallId → 命中的候选父记录 id（时间线顺序） */
  ambiguousParents: Record<string, string[]>
  /** 被合并掉的重复副本总数 */
  duplicateCount: number
  coverage: ToolLogCoverage
}

export interface ToolOperationIndexInput {
  /** 单层事件（等价于 trace） */
  events?: readonly ToolEvent[]
  /** 实时流事件 */
  trace?: readonly ToolEvent[]
  /** 消息持久化工具日志 */
  persisted?: readonly ToolEvent[]
  /** 历史列表投影后的工具日志 */
  projection?: readonly ToolEvent[]
  coverage?: ToolLogCoverageInput
}

const readStringField = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined

/** 记录声明的父 callId：details.parentCallId 优先，兼容扁平字段。 */
export const resolveToolOperationParentCallId = (event: ToolEvent): string | undefined => {
  const details = event.details as Record<string, unknown> | undefined
  const flat = event as unknown as Record<string, unknown>
  return readStringField(details?.parentCallId) ?? readStringField(flat.parentCallId)
}

/** 来源层优先级：只表示可信度，不表示时间先后。 */
const LAYER_PRIORITY = {
  projection: 1,
  persisted: 2,
  trace: 3,
  events: 4,
} as const

const normalizeIndexInput = (
  input: readonly ToolEvent[] | ToolOperationIndexInput,
): { layers: ToolOperationSourceLayer[]; coverage?: ToolLogCoverageInput } => {
  if (Array.isArray(input)) return { layers: [{ events: [...input], priority: LAYER_PRIORITY.events }] }
  const source = (input ?? {}) as ToolOperationIndexInput
  // 层优先级显式声明：数值越大越可信。同 id 副本按此选字段，越晚越完整的假设不成立时也不受影响。
  return {
    layers: [
      { events: source.projection ?? [], priority: LAYER_PRIORITY.projection },
      { events: source.persisted ?? [], priority: LAYER_PRIORITY.persisted },
      { events: source.trace ?? [], priority: LAYER_PRIORITY.trace },
      { events: source.events ?? [], priority: LAYER_PRIORITY.events },
    ],
    coverage: source.coverage,
  }
}

const buildRecord = (
  event: ToolEvent,
  id: string,
  duplicateCount: number,
  truncated: boolean,
): ToolOperationRecord => ({
  id,
  operationId: id,
  callId: readStringField(event.callId),
  parentId: null,
  relation: 'root',
  tool: readStringField(event.tool) ?? readStringField(event.identifier) ?? readStringField(event.apiName) ?? 'unknown',
  identifier: readStringField(event.identifier),
  apiName: readStringField(event.apiName),
  source: event.source,
  stage: event.stage,
  phase: event.phase,
  status: resolveEventStatus(event),
  outcome: resolveToolOperationOutcome(event),
  // 降级与截断都按合并后的值来源判定：低层截断标记不会在高层完整值获胜后残留
  degraded: isToolOperationDegraded(event) || truncated,
  truncated,
  recovery: resolveToolOperationRecovery(event),
  childIds: [],
  duplicateCount,
  event,
})

const collectCallIdCandidates = (records: ToolOperationRecord[]): Map<string, string[]> => {
  const candidates = new Map<string, string[]>()
  for (const record of records) {
    if (!record.callId) continue
    const list = candidates.get(record.callId)
    if (list) list.push(record.id)
    else candidates.set(record.callId, [record.id])
  }
  return candidates
}

/** 沿 parentId 链找出真正处在环上的记录（指向环但不在环上的记录不算）。 */
const findCyclicRecordIds = (parentOf: Map<string, string>): Set<string> => {
  const cyclic = new Set<string>()
  for (const startId of parentOf.keys()) {
    const guard = new Set<string>()
    let cursor = parentOf.get(startId)
    while (cursor && !guard.has(cursor)) {
      if (cursor === startId) {
        cyclic.add(startId)
        break
      }
      guard.add(cursor)
      cursor = parentOf.get(cursor)
    }
  }
  return cyclic
}

export const buildToolOperationIndex = (
  input: readonly ToolEvent[] | ToolOperationIndexInput,
): ToolOperationIndex => {
  const normalized = normalizeIndexInput(input)
  const merged = mergeToolOperationCandidates(normalized.layers)
  const records: ToolOperationRecord[] = merged.events.map((event, position) =>
    buildRecord(
      event,
      merged.ids[position] ?? resolveToolOperationId(event, position),
      merged.duplicateCounts[position] ?? 0,
      merged.truncatedFlags[position] === true,
    ),
  )

  const recordById = new Map(records.map((record) => [record.id, record]))
  const candidatesByCallId = collectCallIdCandidates(records)
  const parentOf = new Map<string, string>()
  const orphans: string[] = []
  const ambiguousParents: Record<string, string[]> = {}

  for (const record of records) {
    const parentCallId = resolveToolOperationParentCallId(record.event)
    if (!parentCallId) continue
    record.parentCallId = parentCallId
    record.relation = 'orphan'

    const pool = (candidatesByCallId.get(parentCallId) ?? []).filter((id) => id !== record.id)
    if (pool.length === 0) {
      orphans.push(record.id)
      continue
    }

    let chosen: string | undefined
    if (pool.length === 1) {
      chosen = pool[0]
    } else {
      const parentless = pool.filter((id) => {
        const candidate = recordById.get(id)
        return candidate ? !resolveToolOperationParentCallId(candidate.event) : false
      })
      if (parentless.length === 1) chosen = parentless[0]
    }

    if (chosen) {
      parentOf.set(record.id, chosen)
      continue
    }
    record.relation = 'ambiguous'
    // 记录歧义的候选父记录，UI 可直接展示“可能是 A 或 B”
    ambiguousParents[parentCallId] = pool
  }

  const cyclic = findCyclicRecordIds(parentOf)
  for (const id of cyclic) {
    parentOf.delete(id)
    const record = recordById.get(id)
    if (!record) continue
    record.relation = 'ambiguous'
    const parentCallId = record.parentCallId ?? ''
    ambiguousParents[parentCallId] = (candidatesByCallId.get(parentCallId) ?? []).filter(
      (candidateId) => candidateId !== id,
    )
  }

  const children: Record<string, string[]> = {}
  for (const record of records) children[record.id] = []
  for (const record of records) {
    const parentId = parentOf.get(record.id)
    if (!parentId) {
      record.parentId = null
      if (record.relation !== 'ambiguous' && record.relation !== 'orphan') record.relation = 'root'
      continue
    }
    record.parentId = parentId
    record.relation = 'child'
    children[parentId].push(record.id)
  }

  for (const record of records) {
    record.childIds = children[record.id]
  }

  const roots = records.filter((record) => record.relation === 'root').map((record) => record.id)
  const orderedAmbiguous = records
    .filter((record) => record.relation === 'ambiguous')
    .map((record) => record.id)

  return {
    records,
    roots,
    children,
    orphans,
    ambiguous: orderedAmbiguous,
    ambiguousParents,
    duplicateCount: merged.duplicatesMerged,
    coverage: buildToolLogCoverage(normalized.coverage),
  }
}
