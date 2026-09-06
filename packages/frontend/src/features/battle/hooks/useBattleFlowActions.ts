'use client'

import { useCallback, useMemo } from 'react'
import type { ModelItem } from '@/store/models-store'
import type { ToolEvent } from '@/types'
import { modelKeyFor } from '../utils/model-key'
import { resolveLoadedBattleState } from './load-run'
import {
  buildConfigState,
  hasBattleContent,
  isPlaceholderModel,
  resolveModelFromCatalog,
} from './model-config'
import { buildNodeStatesFromRun } from './node-states'
import {
  appendNodeOutputInMap,
  appendNodeToolEventInMap,
  updateNodeStateInMap,
} from './node-state-updaters'
import { buildBattlePayload } from './payload'
import { buildBattleStatsMap, groupBattleResults } from './selectors'
import type {
  BattleDraftImage,
  BattleRunDetailInput,
  ModelConfigState,
  NodeState,
  ReasoningDefaults,
} from './types'
import { useBattleFlowExecution } from './useBattleFlowExecution'
import type { BattleFlowStateApi } from './useBattleFlowState'

export const useBattleFlowActions = (
  state: BattleFlowStateApi,
  reasoningDefaults: ReasoningDefaults,
) => {
  const {
    step,
    setStep,
    selectedModels,
    setSelectedModels,
    judgeConfig,
    setJudgeConfig,
    prompt,
    setPrompt,
    expectedAnswer,
    setExpectedAnswer,
    promptImages,
    setPromptImages,
    expectedAnswerImages,
    setExpectedAnswerImages,
    promptImageUrls,
    setPromptImageUrls,
    expectedAnswerImageUrls,
    setExpectedAnswerImageUrls,
    setNodeStates,
    results,
    setResults,
    summary,
    setSummary,
    setCurrentRunId,
    setIsRunning,
    setIsStreaming,
    setRunStatus,
    setError,
  } = state

  // Model selection handlers
  const addModel = useCallback((model: ModelItem) => {
    const key = modelKeyFor(model)
    setSelectedModels((prev) => {
      if (prev.length >= 8) return prev
      if (prev.some((item) => item.key === key)) return prev
      return [...prev, buildConfigState(model, reasoningDefaults)]
    })
  }, [reasoningDefaults, setSelectedModels])

  const removeModel = useCallback((key: string) => {
    setSelectedModels((prev) => prev.filter((item) => item.key !== key))
  }, [setSelectedModels])

  const updateModelConfig = useCallback(
    (key: string, updater: (item: ModelConfigState) => ModelConfigState) => {
      setSelectedModels((prev) => prev.map((item) => (item.key === key ? updater(item) : item)))
    },
    [setSelectedModels]
  )

  // Navigation
  const goToStep = useCallback((newStep: typeof step) => {
    setStep(newStep)
  }, [setStep])

  const canProceedToPrompt = useMemo(() => {
    return selectedModels.length > 0 && judgeConfig.model !== null
  }, [selectedModels.length, judgeConfig.model])

  const canStartBattle = useMemo(() => {
    return hasBattleContent(prompt, promptImages) && hasBattleContent(expectedAnswer, expectedAnswerImages)
  }, [prompt, promptImages, expectedAnswer, expectedAnswerImages])

  // Initialize node states for execution visualization
  const initializeNodeStates = useCallback(() => {
    const models = selectedModels.map((modelConfig) => ({
      modelId: modelConfig.model.id,
      connectionId: modelConfig.model.connectionId,
      rawId: modelConfig.model.rawId,
      label: modelConfig.model.name,
    }))
    setNodeStates(buildNodeStatesFromRun(models, judgeConfig.runsPerModel, []))
  }, [selectedModels, judgeConfig.runsPerModel, setNodeStates])

  // Update node state based on SSE events
  const updateNodeState = useCallback(
    (modelKey: string, attemptIndex: number, updates: Partial<NodeState>) => {
      setNodeStates((prev) => updateNodeStateInMap(prev, modelKey, attemptIndex, updates))
    },
    [setNodeStates]
  )

  const appendNodeOutput = useCallback((
    modelKey: string,
    attemptIndex: number,
    delta?: string,
    reasoning?: string,
  ) => {
    if (!delta && !reasoning) return
    setNodeStates((prev) => appendNodeOutputInMap(prev, modelKey, attemptIndex, delta, reasoning))
  }, [setNodeStates])

  const appendNodeToolEvent = useCallback((
    modelKey: string,
    attemptIndex: number,
    event: ToolEvent,
  ) => {
    setNodeStates((prev) => appendNodeToolEventInMap(prev, modelKey, attemptIndex, event))
  }, [setNodeStates])

  // Validate and build payload
  const validateAndBuildPayload = useCallback((imageOverrides?: {
    promptImages?: BattleDraftImage[]
    expectedAnswerImages?: BattleDraftImage[]
  }) => {
    return buildBattlePayload({
      prompt,
      promptImages,
      expectedAnswer,
      expectedAnswerImages,
      judgeConfig,
      selectedModels,
      imageOverrides,
    })
  }, [prompt, promptImages, expectedAnswer, expectedAnswerImages, judgeConfig, selectedModels])

  const execution = useBattleFlowExecution(state, {
    validateAndBuildPayload,
    initializeNodeStates,
    updateNodeState,
    appendNodeOutput,
    appendNodeToolEvent,
  })

  // Load existing run
  const loadRun = useCallback((detail: BattleRunDetailInput, catalog?: ModelItem[]) => {
    const patch = resolveLoadedBattleState(detail, catalog, reasoningDefaults)
    setPrompt(patch.prompt)
    setExpectedAnswer(patch.expectedAnswer)
    setPromptImages([])
    setExpectedAnswerImages([])
    setPromptImageUrls(patch.promptImageUrls)
    setExpectedAnswerImageUrls(patch.expectedAnswerImageUrls)
    setJudgeConfig((prev) => ({ ...prev, ...patch.judgeConfig }))
    if (patch.selectedModels) {
      setSelectedModels(patch.selectedModels)
    }
    setSummary(patch.summary)
    setResults(patch.results)
    setCurrentRunId(patch.currentRunId)
    setRunStatus(patch.runStatus)
    setIsRunning(patch.isRunning)
    setIsStreaming(false)
    setError(null)
    setNodeStates(patch.nodeStates)
    setStep(patch.step)
  }, [
    reasoningDefaults,
    setPrompt,
    setExpectedAnswer,
    setPromptImages,
    setExpectedAnswerImages,
    setPromptImageUrls,
    setExpectedAnswerImageUrls,
    setJudgeConfig,
    setSelectedModels,
    setSummary,
    setResults,
    setCurrentRunId,
    setRunStatus,
    setIsRunning,
    setIsStreaming,
    setError,
    setNodeStates,
    setStep,
  ])

  const reconcileSelectedModels = useCallback((catalog: ModelItem[]) => {
    setSelectedModels((prev) => {
      if (!prev.length || !catalog.length) return prev
      let changed = false
      const next = prev.map((item) => {
        if (!isPlaceholderModel(item.model)) return item
        const resolved = resolveModelFromCatalog(catalog, {
          modelId: item.model.id,
          connectionId: item.model.connectionId || undefined,
          rawId: item.model.rawId || undefined,
        })
        if (!resolved) return item
        changed = true
        return {
          ...item,
          key: modelKeyFor(resolved),
          model: resolved,
        }
      })
      return changed ? next : prev
    })
  }, [setSelectedModels])

  // Grouped results for display
  const groupedResults = useMemo(() => groupBattleResults(results), [results])

  // Stats map for results
  const statsMap = useMemo(() => buildBattleStatsMap(summary), [summary])

  return {
    canProceedToPrompt,
    canStartBattle,
    addModel,
    removeModel,
    updateModelConfig,
    goToStep,
    startBattle: execution.startBattle,
    cancelBattle: execution.cancelBattle,
    cancelAttempt: execution.cancelAttempt,
    retryAttempt: execution.retryAttempt,
    resetBattle: execution.resetBattle,
    loadRun,
    reconcileSelectedModels,
    groupedResults,
    statsMap,
  }
}
