import type { BattleResult } from '@/types'
import {
  cancelBattleAttempt,
  retryBattleAttempt,
} from '../api'
import { buildModelKey, parseModelKey } from '../utils/model-key'
import type { NodeState } from './types'

export const buildAttemptPayload = (modelKey: string, attemptIndex: number) => {
  const parsed = parseModelKey(modelKey)
  if (!parsed) return null
  return {
    attemptIndex,
    questionIndex: 1,
    modelId: parsed.type === 'global' ? parsed.modelId : undefined,
    connectionId: parsed.type === 'connection' ? parsed.connectionId : undefined,
    rawId: parsed.type === 'connection' ? parsed.rawId : undefined,
  }
}

export const createCancelAttempt = (deps: {
  currentRunId: number | null
  updateNodeState: (modelKey: string, attemptIndex: number, updates: Partial<NodeState>) => void
}) => {
  const { currentRunId, updateNodeState } = deps
  return async (params: { modelKey: string; attemptIndex: number }) => {
    if (!currentRunId) {
      return { success: false, error: '未找到进行中的乱斗' }
    }
    const payload = buildAttemptPayload(params.modelKey, params.attemptIndex)
    if (!payload) {
      return { success: false, error: '模型标识无效' }
    }
    const response = await cancelBattleAttempt(currentRunId, payload)
    if (!response?.success) {
      return { success: false, error: response?.error || '取消失败' }
    }
    updateNodeState(params.modelKey, params.attemptIndex, {
      status: 'error',
      error: '已取消',
      durationMs: null,
    })
    return { success: true }
  }
}

export const createRetryAttempt = (deps: {
  currentRunId: number | null
  updateNodeState: (modelKey: string, attemptIndex: number, updates: Partial<NodeState>) => void
  setResults: (updater: (prev: BattleResult[]) => BattleResult[]) => void
}) => {
  const { currentRunId, updateNodeState, setResults } = deps
  return async (params: { modelKey: string; attemptIndex: number }) => {
    if (!currentRunId) {
      return { success: false, error: '未找到进行中的乱斗' }
    }
    const payload = buildAttemptPayload(params.modelKey, params.attemptIndex)
    if (!payload) {
      return { success: false, error: '模型标识无效' }
    }
    const response = await retryBattleAttempt(currentRunId, payload)
    if (!response?.success) {
      return { success: false, error: response?.error || '重试失败' }
    }
    setResults((prev) => prev.filter((item) => {
      const key = buildModelKey({
        modelId: item.modelId,
        connectionId: item.connectionId,
        rawId: item.rawId,
      })
      return !(key === params.modelKey && item.attemptIndex === params.attemptIndex)
    }))
    updateNodeState(params.modelKey, params.attemptIndex, {
      status: 'pending',
      output: '',
      reasoning: '',
      durationMs: null,
      error: null,
      toolEvents: [],
      judgeStatus: 'unknown',
      judgeError: null,
      judgePass: null,
      judgeScore: null,
      judgeReason: null,
    })
    return { success: true }
  }
}
