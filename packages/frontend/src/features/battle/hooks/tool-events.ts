import {
  compareToolEvents as compareToolEvent,
  mergeToolEvents as mergeToolEvent,
} from '@aichat/shared/tool-events'
import {
  normalizeLegacyStage as normalizeToolCallStage,
  normalizeToolCallPhase,
  normalizeToolCallSource,
  normalizeToolCallStatus,
} from '@aichat/shared/chat-stream-parser'
import type { ToolEvent } from '@/types'

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null

const pickString = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed.length > 0) return trimmed
    }
  }
  return null
}

const asTimestamp = (value: unknown, fallback: number) => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return fallback
}

export const normalizeBattleToolEvent = (raw: unknown): ToolEvent | null => {
  const event = asRecord(raw)
  if (!event) return null

  const details = asRecord(event.details) || undefined
  const now = Date.now()
  const createdAt = asTimestamp(event.createdAt, now)
  const updatedAt = asTimestamp(event.updatedAt, createdAt)
  const phase = normalizeToolCallPhase(event.phase, event.status, event.stage)
  const status = normalizeToolCallStatus(event.status, phase, event.stage) ?? 'running'
  const stage = normalizeToolCallStage(event.stage, phase)
  const id = pickString(event.id, event.callId) || `tool-${createdAt}`
  const callId = pickString(event.callId, event.id) || undefined
  const identifier = pickString(event.identifier, event.tool, event.apiName) || undefined
  const apiName = pickString(event.apiName, event.identifier, event.tool) || identifier
  const tool = pickString(event.tool, identifier, apiName) || 'tool'
  const source = normalizeToolCallSource(event.source)
  const query = pickString(event.query) || undefined
  const argumentsText = pickString(event.argumentsText, details?.argumentsText, details?.input, details?.code) || undefined
  const argumentsPatch = pickString(event.argumentsPatch, details?.argumentsPatch) || undefined
  const resultText = pickString(event.resultText, details?.resultText, details?.stdout, details?.excerpt) || undefined
  const error = pickString(event.error) || undefined
  const summary = pickString(event.summary) || undefined

  const normalized: ToolEvent = {
    id,
    sessionId: 0,
    messageId: 0,
    tool,
    stage,
    status,
    createdAt,
    updatedAt,
    ...(callId ? { callId } : {}),
    ...(source ? { source } : {}),
    ...(identifier ? { identifier } : {}),
    ...(apiName ? { apiName } : {}),
    ...(phase ? { phase } : {}),
    ...(query ? { query } : {}),
    ...(Array.isArray(event.hits) ? { hits: event.hits as ToolEvent['hits'] } : {}),
    ...(argumentsText ? { argumentsText } : {}),
    ...(argumentsPatch ? { argumentsPatch } : {}),
    ...(resultText ? { resultText } : {}),
    ...(typeof event.resultJson !== 'undefined' ? { resultJson: event.resultJson } : {}),
    ...(error ? { error } : {}),
    ...(summary ? { summary } : {}),
    ...(details ? { details: details as ToolEvent['details'] } : {}),
    ...(asRecord(event.intervention) ? { intervention: event.intervention as ToolEvent['intervention'] } : {}),
    ...(typeof event.thoughtSignature === 'string' || event.thoughtSignature === null
      ? { thoughtSignature: event.thoughtSignature as ToolEvent['thoughtSignature'] }
      : {}),
  }

  return normalized
}

const buildToolEventKey = (event: ToolEvent) => {
  const callId = pickString(event.callId)
  if (callId) return `call:${callId}`
  const id = pickString(event.id)
  if (id) return `id:${id}`
  return `fallback:${event.createdAt}`
}

export const normalizeBattleToolEventList = (events: unknown): ToolEvent[] => {
  if (!Array.isArray(events) || events.length === 0) return []
  const merged = new Map<string, ToolEvent>()
  let fallbackIndex = 0
  for (const item of events) {
    const normalized = normalizeBattleToolEvent(item)
    if (!normalized) continue
    const key = buildToolEventKey(normalized) || `fallback:${fallbackIndex++}`
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, normalized)
    } else {
      merged.set(key, mergeToolEvent(existing, normalized))
    }
  }
  return Array.from(merged.values()).sort(compareToolEvent)
}

export const appendBattleToolEvent = (timeline: ToolEvent[] | undefined, incoming: ToolEvent): ToolEvent[] => {
  const current = Array.isArray(timeline) ? timeline : []
  const key = buildToolEventKey(incoming)
  const index = current.findIndex((item) => buildToolEventKey(item) === key)
  if (index < 0) {
    return [...current, incoming].sort(compareToolEvent)
  }
  const next = [...current]
  next[index] = mergeToolEvent(next[index], incoming)
  next.sort(compareToolEvent)
  return next
}
