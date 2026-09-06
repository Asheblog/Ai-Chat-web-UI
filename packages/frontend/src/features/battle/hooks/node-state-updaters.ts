import type { ToolEvent } from '@/types'
import { appendBattleToolEvent } from './tool-events'
import type { NodeState } from './types'

export const updateNodeStateInMap = (
  prev: Map<string, NodeState[]>,
  modelKey: string,
  attemptIndex: number,
  updates: Partial<NodeState>,
) => {
  const newMap = new Map(prev)
  const attempts = newMap.get(modelKey)
  if (attempts) {
    const newAttempts = attempts.map((attempt) =>
      attempt.attemptIndex === attemptIndex ? { ...attempt, ...updates } : attempt
    )
    newMap.set(modelKey, newAttempts)
  }
  return newMap
}

export const appendNodeOutputInMap = (
  prev: Map<string, NodeState[]>,
  modelKey: string,
  attemptIndex: number,
  delta?: string,
  reasoning?: string,
) => {
  if (!delta && !reasoning) return prev
  const next = new Map(prev)
  const attempts = next.get(modelKey) || []
  let updated = false
  const newAttempts = attempts.map((attempt) => {
    if (attempt.attemptIndex !== attemptIndex) return attempt
    updated = true
    return {
      ...attempt,
      status: attempt.status === 'pending' ? 'running' : attempt.status,
      output: `${attempt.output || ''}${delta || ''}`,
      reasoning: `${attempt.reasoning || ''}${reasoning || ''}`,
    }
  })
  if (!updated) {
    const modelLabel = attempts[0]?.modelLabel || modelKey
    newAttempts.push({
      modelKey,
      modelLabel,
      status: 'running',
      attemptIndex,
      output: delta || '',
      reasoning: reasoning || '',
    })
  }
  newAttempts.sort((a, b) => a.attemptIndex - b.attemptIndex)
  next.set(modelKey, newAttempts)
  return next
}

export const appendNodeToolEventInMap = (
  prev: Map<string, NodeState[]>,
  modelKey: string,
  attemptIndex: number,
  event: ToolEvent,
) => {
  const next = new Map(prev)
  const attempts = next.get(modelKey) || []
  let updated = false
  const newAttempts = attempts.map((attempt) => {
    if (attempt.attemptIndex !== attemptIndex) return attempt
    updated = true
    return {
      ...attempt,
      status: attempt.status === 'pending' ? 'running' : attempt.status,
      toolEvents: appendBattleToolEvent(attempt.toolEvents, event),
    }
  })
  if (!updated) {
    const modelLabel = attempts[0]?.modelLabel || modelKey
    newAttempts.push({
      modelKey,
      modelLabel,
      status: 'running',
      attemptIndex,
      toolEvents: [event],
    })
  }
  newAttempts.sort((a, b) => a.attemptIndex - b.attemptIndex)
  next.set(modelKey, newAttempts)
  return next
}
