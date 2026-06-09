import type { ToolEvent } from '@/types'

export const resolveReasoningOffsetStart = (event: ToolEvent) => {
  const details = event.details
  if (!details || typeof details !== 'object') return null
  const candidate =
    typeof details.reasoningOffsetStart === 'number'
      ? details.reasoningOffsetStart
      : typeof details.reasoningOffset === 'number'
        ? details.reasoningOffset
        : null
  return candidate != null && Number.isFinite(candidate) && candidate >= 0 ? Math.floor(candidate) : null
}

export const compareToolEvents = (a: ToolEvent, b: ToolEvent) => {
  const aOffset = resolveReasoningOffsetStart(a)
  const bOffset = resolveReasoningOffsetStart(b)
  if (aOffset != null && bOffset != null && aOffset !== bOffset) {
    return aOffset - bOffset
  }
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
  const aUpdatedAt = typeof a.updatedAt === 'number' ? a.updatedAt : a.createdAt
  const bUpdatedAt = typeof b.updatedAt === 'number' ? b.updatedAt : b.createdAt
  if (aUpdatedAt !== bUpdatedAt) return aUpdatedAt - bUpdatedAt
  return a.id.localeCompare(b.id)
}

export const resolveEventStatus = (event: ToolEvent): ToolEvent['status'] => {
  if (
    event.status === 'running' ||
    event.status === 'success' ||
    event.status === 'error' ||
    event.status === 'pending' ||
    event.status === 'rejected' ||
    event.status === 'aborted'
  ) {
    return event.status
  }
  if (event.phase === 'pending_approval') return 'pending'
  if (event.phase === 'result') return 'success'
  if (event.phase === 'error') return 'error'
  if (event.phase === 'rejected') return 'rejected'
  if (event.phase === 'aborted') return 'aborted'
  if (event.stage === 'result') return 'success'
  if (event.stage === 'error') return 'error'
  return 'running'
}

export const mergeToolEvents = (previous: ToolEvent, incoming: ToolEvent): ToolEvent => {
  const mergedDetails =
    previous.details || incoming.details
      ? { ...(previous.details ?? {}), ...(incoming.details ?? {}) }
      : undefined
  const nextCreatedAt = Number.isFinite(incoming.createdAt)
    ? Math.min(previous.createdAt, incoming.createdAt)
    : previous.createdAt
  const nextUpdatedAt = Math.max(
    typeof previous.updatedAt === 'number' ? previous.updatedAt : previous.createdAt,
    typeof incoming.updatedAt === 'number' ? incoming.updatedAt : incoming.createdAt,
  )
  const merged: ToolEvent = {
    ...previous,
    ...incoming,
    id: incoming.id || previous.id,
    callId: incoming.callId || previous.callId,
    tool: incoming.tool || incoming.identifier || previous.tool,
    identifier: incoming.identifier || previous.identifier,
    apiName: incoming.apiName || previous.apiName,
    createdAt: nextCreatedAt,
    updatedAt: nextUpdatedAt,
    details: mergedDetails,
  }
  const status = resolveEventStatus(merged)
  merged.status = status
  if (
    merged.stage !== 'start' &&
    merged.stage !== 'result' &&
    merged.stage !== 'error'
  ) {
    merged.stage = status === 'success' ? 'result' : status === 'running' || status === 'pending' ? 'start' : 'error'
  }
  return merged
}

export const buildEventKey = (event: ToolEvent, fallbackIndex: number) => {
  if (typeof event.callId === 'string' && event.callId.trim().length > 0) return `call:${event.callId}`
  if (typeof event.id === 'string' && event.id.trim().length > 0) return `id:${event.id}`
  return `fallback:${fallbackIndex}`
}
