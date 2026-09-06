'use client'

import { useMemo } from 'react'
import { useSettingsStore } from '@/store/settings-store'
import { normalizeReasoningEffort } from './model-config'
import type { ReasoningDefaults } from './types'
import { useBattleFlowActions } from './useBattleFlowActions'
import { useBattleFlowState } from './useBattleFlowState'

export function useBattleFlow() {
  const state = useBattleFlowState()
  const { systemSettings } = useSettingsStore((state) => ({
    systemSettings: state.systemSettings,
  }))

  const reasoningDefaults = useMemo<ReasoningDefaults>(() => {
    const enabled = Boolean(systemSettings?.reasoningEnabled ?? true)
    const effort = normalizeReasoningEffort(systemSettings?.openaiReasoningEffort) || 'medium'
    return {
      reasoningEnabled: enabled,
      reasoningEffort: effort,
    }
  }, [systemSettings?.reasoningEnabled, systemSettings?.openaiReasoningEffort])

  const actions = useBattleFlowActions(state, reasoningDefaults)

  return {
    // State
    step: state.step,
    selectedModels: state.selectedModels,
    judgeConfig: state.judgeConfig,
    prompt: state.prompt,
    expectedAnswer: state.expectedAnswer,
    promptImages: state.promptImages,
    expectedAnswerImages: state.expectedAnswerImages,
    promptImageUrls: state.promptImageUrls,
    expectedAnswerImageUrls: state.expectedAnswerImageUrls,
    nodeStates: state.nodeStates,
    results: state.results,
    summary: state.summary,
    currentRunId: state.currentRunId,
    isRunning: state.isRunning,
    isStreaming: state.isStreaming,
    runStatus: state.runStatus,
    error: state.error,
    groupedResults: actions.groupedResults,
    statsMap: actions.statsMap,

    // Computed
    canProceedToPrompt: actions.canProceedToPrompt,
    canStartBattle: actions.canStartBattle,

    // Actions
    setPrompt: state.setPrompt,
    setExpectedAnswer: state.setExpectedAnswer,
    setPromptImages: state.setPromptImages,
    setExpectedAnswerImages: state.setExpectedAnswerImages,
    setJudgeConfig: state.setJudgeConfig,
    addModel: actions.addModel,
    removeModel: actions.removeModel,
    updateModelConfig: actions.updateModelConfig,
    goToStep: actions.goToStep,
    startBattle: actions.startBattle,
    cancelBattle: actions.cancelBattle,
    cancelAttempt: actions.cancelAttempt,
    retryAttempt: actions.retryAttempt,
    resetBattle: actions.resetBattle,
    loadRun: actions.loadRun,
    reconcileSelectedModels: actions.reconcileSelectedModels,
  }
}

export type UseBattleFlowReturn = ReturnType<typeof useBattleFlow>

// 兼容再导出：拆分后的 helper 仍可从原入口导入
export type {
  BattleStep,
  NodeStatus,
  ModelConfigState,
  NodeState,
  LiveAttempt,
  JudgeConfig,
  BattleDraftImage,
  BattleFlowState,
  BattleNodeModel,
} from './types'
export {
  normalizeThreshold,
  normalizeInteger,
  parseCustomBody,
  sanitizeHeaders,
} from './validation'
export {
  normalizeBattleToolEvent,
  normalizeBattleToolEventList,
  appendBattleToolEvent,
} from './tool-events'
export { buildNodeStatesFromRun } from './node-states'
