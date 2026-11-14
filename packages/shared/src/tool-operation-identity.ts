/**
 * 工具操作身份与结果推导（台账身份规则唯一实现）。
 * 主键只有 id；callId 只找父候选。匿名副本用兼容形态 `call:<callId>`，与真实 id 冲突时
 * 自动追加 `#n` —— 真实 id 是外部输入，唯一性不能建立在“某前缀没人用”的假设上。
 * 合并保留全部真实 ToolEvent 字段：逐字段取优先级最高的可用值（undefined/空串/空数组不覆盖），
 * 优先级 = 来源层 > 同层时间 > 完全同级稳定仲裁；终态不被迟到 start 降级；truncated 按值来源判定。
 */
import type { ToolCallStatus, ToolEventDetails, ToolEventStage } from './chat-stream-contract.js'
import type { ToolEvent } from './tool-events.js'
import { compareToolEvents, resolveEventStatus } from './tool-events.js'

export type ToolOperationOutcome = 'succeeded' | 'failed' | 'rejected' | 'aborted' | 'in_flight' | 'unknown'

export interface ToolOperationRecovery {
  fallbackUsed?: string
  attempts?: number
  retried?: boolean
}

export interface ToolOperationSourceLayer {
  events: readonly ToolEvent[]
  /** 来源可信度：越大越优先（projection < persisted < trace < events） */
  priority: number
}

export interface ToolOperationCandidate {
  event: ToolEvent
  priority: number
}

const TERMINAL_STATUSES: ReadonlySet<ToolCallStatus> = new Set<ToolCallStatus>([
  'success',
  'error',
  'rejected',
  'aborted',
])

/** 终态仲裁与时序相关的键，不按普通字段取值。 */
const ARBITRATION_KEYS = new Set(['details', 'stage', 'status', 'createdAt', 'updatedAt'])

const isTerminalStage = (stage: ToolEventStage) => stage === 'result' || stage === 'error'

const isUsableValue = (value: unknown): boolean => {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return value.length > 0
  return Array.isArray(value) ? value.length > 0 : true
}

const asRecord = (event: ToolEvent): Record<string, unknown> => event as unknown as Record<string, unknown>

const isTruncatedCopy = (event: ToolEvent): boolean => event.details?.truncated === true

/** 记录自带的回退证据；'none' 表示未回退，不算证据。 */
export const resolveToolOperationFallback = (
  details?: ToolEventDetails | Record<string, unknown> | null,
): string | undefined => {
  const raw = (details as Record<string, unknown> | null | undefined)?.fallbackUsed
  if (typeof raw !== 'string') return undefined
  const value = raw.trim()
  return !value || value.toLowerCase() === 'none' ? undefined : value
}

/** 记录自带的尝试次数证据（details.attempts 长度）；无数组即无证据。 */
export const resolveToolOperationAttempts = (
  details?: ToolEventDetails | Record<string, unknown> | null,
): number | undefined => {
  const raw = (details as Record<string, unknown> | null | undefined)?.attempts
  return Array.isArray(raw) ? raw.length : undefined
}

export const resolveToolOperationRecovery = (event: ToolEvent): ToolOperationRecovery => {
  const recovery: ToolOperationRecovery = {}
  const fallbackUsed = resolveToolOperationFallback(event.details)
  if (fallbackUsed) recovery.fallbackUsed = fallbackUsed
  const attempts = resolveToolOperationAttempts(event.details)
  if (attempts !== undefined) {
    recovery.attempts = attempts
    if (attempts > 1) recovery.retried = true
  }
  return recovery
}

/** 降级证据：回退目标 / 告警 / 结果被标截断。与 outcome 无关。 */
export const isToolOperationDegraded = (event: ToolEvent): boolean => {
  if (resolveToolOperationFallback(event.details)) return true
  const warning = event.details?.warning
  if (typeof warning === 'string' && warning.trim().length > 0) return true
  return isTruncatedCopy(event)
}

/**
 * 统一优先规则（intervention 只在 status 表达不了结果时补充）：
 * error+rejected → rejected（未获许可 ≠ 失败）；running/pending+aborted → aborted。
 * 目前 web_search 审批链路是唯一 producer，新 producer 按同一语义接入。
 */
export const resolveToolOperationOutcome = (event: ToolEvent): ToolOperationOutcome => {
  const status = resolveEventStatus(event)
  const interventionStatus = event.intervention?.status
  if (status === 'success') return 'succeeded'
  if (status === 'error') return interventionStatus === 'rejected' ? 'rejected' : 'failed'
  if (status === 'rejected') return 'rejected'
  if (status === 'aborted') return 'aborted'
  if (status === 'pending' || status === 'running') {
    return interventionStatus === 'aborted' ? 'aborted' : 'in_flight'
  }
  return 'unknown'
}

/** 匿名副本的兼容 id 形态；唯一性由 assignAnonymousIds 保证。 */
export const resolveToolOperationId = (event: ToolEvent, position = 0): string => {
  const id = typeof event.id === 'string' ? event.id.trim() : ''
  if (id) return id
  const callId = typeof event.callId === 'string' ? event.callId.trim() : ''
  return callId ? `call:${callId}` : `event:${position}`
}

const eventTime = (event: ToolEvent): number =>
  typeof event.updatedAt === 'number' && Number.isFinite(event.updatedAt) ? event.updatedAt : event.createdAt

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(source).sort()) sorted[key] = canonicalize(source[key])
    return sorted
  }
  return value
}

const stableEventKey = (event: ToolEvent): string => {
  try {
    return JSON.stringify(canonicalize(event)) ?? ''
  } catch {
    return ''
  }
}

/** 来源层 > 同层时间 > 完全同级的稳定仲裁（仅确定性，不作跨层取值依据）。 */
const compareCandidates = (a: ToolOperationCandidate, b: ToolOperationCandidate): number => {
  if (a.priority !== b.priority) return b.priority - a.priority
  const aTime = eventTime(a.event)
  const bTime = eventTime(b.event)
  if (aTime !== bTime) return bTime - aTime
  if (a.event.createdAt !== b.event.createdAt) return b.event.createdAt - a.event.createdAt
  const aKey = stableEventKey(a.event)
  const bKey = stableEventKey(b.event)
  return aKey < bKey ? -1 : aKey > bKey ? 1 : 0
}

interface MergedGroup {
  explicitId?: string
  anonymousBase?: string
  event: ToolEvent
  duplicateCount: number
  truncated: boolean
}

const mergeGroup = (candidates: ToolOperationCandidate[]): MergedGroup => {
  const ordered = [...candidates].sort(compareCandidates)
  const base = { ...ordered[0].event } as Record<string, unknown>
  const providers: ToolOperationCandidate[] = []

  const fieldNames = new Set<string>()
  for (const candidate of ordered) for (const key of Object.keys(candidate.event)) fieldNames.add(key)
  for (const key of fieldNames) {
    if (ARBITRATION_KEYS.has(key)) continue
    const provider = ordered.find((candidate) => isUsableValue(asRecord(candidate.event)[key]))
    if (!provider) delete base[key]
    else {
      base[key] = asRecord(provider.event)[key]
      providers.push(provider)
    }
  }

  // details 低 → 高覆盖：高优先副本的键胜出，低优先只补缺失键；truncated 单独按来源判定
  const detailValues: Record<string, unknown> = {}
  const detailProviders = new Map<string, ToolOperationCandidate>()
  for (const candidate of [...ordered].reverse()) {
    const details = candidate.event.details
    if (!details || typeof details !== 'object') continue
    for (const [key, value] of Object.entries(details)) {
      if (key === 'truncated') continue
      detailValues[key] = value
      detailProviders.set(key, candidate)
    }
  }
  const truncated = [...providers, ...detailProviders.values()].some((provider) => isTruncatedCopy(provider.event))
  if (truncated) detailValues.truncated = true
  if (Object.keys(detailValues).length > 0) base.details = detailValues
  else delete base.details

  const statusProvider =
    ordered.find((candidate) => TERMINAL_STATUSES.has(resolveEventStatus(candidate.event))) ?? ordered[0]
  const status = resolveEventStatus(statusProvider.event)
  const stageProvider =
    ordered.find((candidate) => resolveEventStatus(candidate.event) === status && isTerminalStage(candidate.event.stage)) ??
    ordered[0]
  let stage: ToolEventStage = stageProvider.event.stage
  if (status === 'success' && stage === 'start') stage = 'result'
  if ((status === 'error' || status === 'rejected' || status === 'aborted') && stage === 'start') stage = 'error'

  base.status = status
  base.stage = stage
  base.createdAt = Math.min(...ordered.map((candidate) => candidate.event.createdAt))
  base.updatedAt = Math.max(...ordered.map((candidate) => eventTime(candidate.event)))

  const head = ordered[0].event
  const callId = typeof head.callId === 'string' ? head.callId.trim() : ''
  return {
    explicitId: typeof head.id === 'string' && head.id.trim() ? head.id.trim() : undefined,
    anonymousBase: callId ? `call:${callId}` : undefined,
    event: base as unknown as ToolEvent,
    duplicateCount: ordered.length - 1,
    truncated,
  }
}

/** 匿名 id 分配：先占用全部真实 id，再逐个消歧，任何外部 id 都不会被撞。 */
const assignAnonymousIds = (groups: MergedGroup[], ordered: MergedGroup[]): Map<MergedGroup, string> => {
  const used = new Set<string>()
  for (const group of groups) if (group.explicitId) used.add(group.explicitId)
  const ids = new Map<MergedGroup, string>()
  for (const group of ordered) {
    if (group.explicitId) {
      ids.set(group, group.explicitId)
      continue
    }
    const base = group.anonymousBase ?? 'event:unknown'
    let candidate = base
    let suffix = 2
    while (used.has(candidate)) {
      candidate = `${base}#${suffix}`
      suffix += 1
    }
    used.add(candidate)
    ids.set(group, candidate)
  }
  return ids
}

export interface MergedToolOperationEvents {
  events: ToolEvent[]
  ids: string[]
  duplicateCounts: number[]
  /** 与 events 对齐：最终展示值是否来自自标截断的副本 */
  truncatedFlags: boolean[]
  duplicatesMerged: number
}

/** 按来源层合并同 id 副本：层优先、层内按时间、终态不可降级、真实字段全保全。 */
export const mergeToolOperationCandidates = (
  layers: readonly ToolOperationSourceLayer[],
): MergedToolOperationEvents => {
  type Group = { explicitId?: string; anonymousBase?: string; candidates: ToolOperationCandidate[] }
  const groups = new Map<string, Group>()
  let position = 0

  for (const layer of layers) {
    const events = Array.isArray(layer.events) ? layer.events : []
    const priority = Number.isFinite(layer.priority) ? layer.priority : 0
    for (const event of events) {
      const currentPosition = position
      position += 1
      if (!event || typeof event !== 'object') continue
      const id = typeof event.id === 'string' ? event.id.trim() : ''
      const callId = typeof event.callId === 'string' ? event.callId.trim() : ''
      const key = id ? `id:${id}` : callId ? `anon:${callId}` : `anon-event:${currentPosition}`
      const group = groups.get(key) ?? {
        explicitId: id || undefined,
        anonymousBase: !id && callId ? `call:${callId}` : undefined,
        candidates: [],
      }
      group.candidates.push({ event, priority })
      groups.set(key, group)
    }
  }

  const mergedGroups = Array.from(groups.values()).map((group) => mergeGroup(group.candidates))
  const ordered = [...mergedGroups].sort(
    (a, b) =>
      compareToolEvents(a.event, b.event) || stableEventKey(a.event).localeCompare(stableEventKey(b.event)),
  )
  const ids = assignAnonymousIds(mergedGroups, ordered)

  return {
    events: ordered.map((group) => group.event),
    ids: ordered.map((group) => ids.get(group) ?? resolveToolOperationId(group.event)),
    duplicateCounts: ordered.map((group) => group.duplicateCount),
    truncatedFlags: ordered.map((group) => group.truncated),
    duplicatesMerged: ordered.reduce((total, group) => total + group.duplicateCount, 0),
  }
}

/** 单层（无来源层证据）入口，等价于所有副本 priority 相同。 */
export const mergeToolOperationDuplicates = (
  events: readonly ToolEvent[],
): MergedToolOperationEvents => mergeToolOperationCandidates([{ events: events ?? [], priority: 0 }])
