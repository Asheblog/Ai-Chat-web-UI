import type { ModelItem } from '@/store/models-store'
import type { BattleResult } from '@/types'
import { buildModelKey } from '../utils/model-key'
import { resolveNodeLabel } from './model-config'
import { normalizeBattleToolEventList } from './tool-events'
import type { BattleNodeModel, LiveAttempt, NodeState } from './types'

export const parseExecutionStepIdentity = (stepId: unknown): { modelKey: string; attemptIndex: number } | null => {
  if (typeof stepId !== 'string' || stepId.trim().length === 0) return null
  const matched = stepId.match(/^(.*):q\d+:a(\d+)$/)
  if (!matched) return null
  const modelKey = matched[1]?.trim()
  const attemptIndex = Number.parseInt(matched[2] || '', 10)
  if (!modelKey || !Number.isFinite(attemptIndex) || attemptIndex <= 0) return null
  return { modelKey, attemptIndex }
}

export const buildNodeStatesFromRun = (
  models: BattleNodeModel[],
  runsPerModel: number,
  results: BattleResult[],
  catalog?: ModelItem[],
  liveAttempts?: LiveAttempt[],
) => {
  const normalizedRuns = Number.isFinite(runsPerModel) && runsPerModel > 0 ? Math.floor(runsPerModel) : 1
  const map = new Map<string, NodeState[]>()

  for (const model of models) {
    const key = buildModelKey(model)
    const label = resolveNodeLabel(model, catalog)
    const attempts: NodeState[] = []
    for (let i = 1; i <= normalizedRuns; i += 1) {
      attempts.push({
        modelKey: key,
        modelLabel: label,
        status: 'pending',
        attemptIndex: i,
      })
    }
    map.set(key, attempts)
  }

  if (Array.isArray(liveAttempts)) {
    for (const live of liveAttempts) {
      const key = buildModelKey({
        modelId: live.modelId,
        connectionId: live.connectionId,
        rawId: live.rawId,
      })
      const label = live.modelLabel || resolveNodeLabel({
        modelId: live.modelId,
        connectionId: live.connectionId ?? null,
        rawId: live.rawId ?? null,
      }, catalog)
      let attempts = map.get(key)
      const requiredAttempts = Math.max(normalizedRuns, live.attemptIndex)
      if (!attempts) {
        attempts = []
      }
      for (let i = attempts.length + 1; i <= requiredAttempts; i += 1) {
        attempts.push({
          modelKey: key,
          modelLabel: label,
          status: 'pending',
          attemptIndex: i,
        })
      }
      const index = live.attemptIndex - 1
      if (index >= 0 && index < attempts.length) {
        const liveToolEvents = normalizeBattleToolEventList(live.toolEvents)
        attempts[index] = {
          ...attempts[index],
          status: live.status,
          durationMs: live.durationMs ?? null,
          output: live.output ?? attempts[index].output,
          reasoning: live.reasoning ?? attempts[index].reasoning,
          error: live.error ?? null,
          ...(liveToolEvents.length > 0 ? { toolEvents: liveToolEvents } : {}),
        }
      }
      map.set(key, attempts)
    }
  }

  for (const result of results) {
    const key = buildModelKey({
      modelId: result.modelId,
      connectionId: result.connectionId,
      rawId: result.rawId,
    })
    const label = result.modelLabel || resolveNodeLabel({
      modelId: result.modelId,
      connectionId: result.connectionId,
      rawId: result.rawId,
    }, catalog)
    let attempts = map.get(key)
    const requiredAttempts = Math.max(normalizedRuns, result.attemptIndex)
    if (!attempts) {
      attempts = []
    }
    for (let i = attempts.length + 1; i <= requiredAttempts; i += 1) {
      attempts.push({
        modelKey: key,
        modelLabel: label,
        status: 'pending',
        attemptIndex: i,
      })
    }
    const index = result.attemptIndex - 1
    if (index >= 0 && index < attempts.length) {
      attempts[index] = {
        ...attempts[index],
        status: result.error
          ? 'error'
          : (result.judgeStatus === 'running'
            ? 'judging'
            : (result.judgeStatus === 'success' && result.judgePass === true)
              ? 'success'
              : 'error'),
        durationMs: result.durationMs,
        output: result.output,
        reasoning: attempts[index].reasoning,
        error: result.error,
        toolEvents: attempts[index].toolEvents,
        judgeStatus: result.judgeStatus,
        judgeError: result.judgeError,
        judgePass: result.judgePass,
        judgeScore: result.judgeScore,
        judgeReason: result.judgeReason,
      }
    }
    map.set(key, attempts)
  }

  return map
}
