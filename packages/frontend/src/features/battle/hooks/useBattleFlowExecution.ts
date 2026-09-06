'use client'

import { useCallback } from 'react'
import type { ModelItem } from '@/store/models-store'
import type { ToolEvent } from '@/types'
import { cancelBattleRun } from '../api'
import { createCancelAttempt, createRetryAttempt } from './attempt-actions'
import type { BattlePayloadValidation } from './payload'
import { runBattleStream } from './stream-runner'
import type { BattleDraftImage, NodeState } from './types'
import type { BattleFlowStateApi } from './useBattleFlowState'

export const useBattleFlowExecution = (
  state: BattleFlowStateApi,
  deps: {
    validateAndBuildPayload: (imageOverrides?: {
      promptImages?: BattleDraftImage[]
      expectedAnswerImages?: BattleDraftImage[]
    }) => BattlePayloadValidation
    initializeNodeStates: () => void
    updateNodeState: (modelKey: string, attemptIndex: number, updates: Partial<NodeState>) => void
    appendNodeOutput: (modelKey: string, attemptIndex: number, delta?: string, reasoning?: string) => void
    appendNodeToolEvent: (modelKey: string, attemptIndex: number, event: ToolEvent) => void
  },
) => {
  const {
    promptImages,
    setPrompt,
    setExpectedAnswer,
    expectedAnswerImages,
    setPromptImageUrls,
    setExpectedAnswerImageUrls,
    setSelectedModels,
    setCurrentRunId,
    setResults,
    setSummary,
    setRunStatus,
    setError,
    setIsRunning,
    setIsStreaming,
    setStep,
    setPromptImages,
    setExpectedAnswerImages,
    currentRunId,
    setNodeStates,
    abortControllerRef,
    cancelRequestedRef,
  } = state
  const {
    validateAndBuildPayload,
    initializeNodeStates,
    updateNodeState,
    appendNodeOutput,
    appendNodeToolEvent,
  } = deps

  // Execute battle
  const startBattle = useCallback(async (
    models: ModelItem[],
    imageOverrides?: { promptImages?: BattleDraftImage[]; expectedAnswerImages?: BattleDraftImage[] },
  ) => {
    const effectivePromptImages = Array.isArray(imageOverrides?.promptImages)
      ? imageOverrides.promptImages
      : promptImages
    const effectiveExpectedAnswerImages = Array.isArray(imageOverrides?.expectedAnswerImages)
      ? imageOverrides.expectedAnswerImages
      : expectedAnswerImages
    const validation = validateAndBuildPayload({
      promptImages: effectivePromptImages,
      expectedAnswerImages: effectiveExpectedAnswerImages,
    })

    if (validation.updatedConfigs) {
      setSelectedModels(validation.updatedConfigs)
    }

    if (!validation.valid || !validation.payload) {
      setError(validation.error || '验证失败')
      return { success: false, error: validation.error }
    }

    cancelRequestedRef.current = false
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    const controller = new AbortController()
    abortControllerRef.current = controller

    setIsRunning(true)
    setIsStreaming(true)
    setRunStatus('running')
    setResults([])
    setSummary(null)
    setCurrentRunId(null)
    setError(null)
    setPromptImages(effectivePromptImages)
    setExpectedAnswerImages(effectiveExpectedAnswerImages)
    setPromptImageUrls(effectivePromptImages.map((item) => item.dataUrl))
    setExpectedAnswerImageUrls(effectiveExpectedAnswerImages.map((item) => item.dataUrl))
    initializeNodeStates()
    setStep('execution')

    try {
      return await runBattleStream(validation.payload, controller.signal, {
        models,
        cancelRequestedRef,
        setPrompt,
        setExpectedAnswer,
        setPromptImageUrls,
        setExpectedAnswerImageUrls,
        setCurrentRunId,
        setResults,
        setSummary,
        setRunStatus,
        setError,
        setIsRunning,
        setStep,
        updateNodeState,
        appendNodeOutput,
        appendNodeToolEvent,
      })
    } finally {
      setIsStreaming(false)
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null
      }
    }
  }, [
    validateAndBuildPayload,
    initializeNodeStates,
    updateNodeState,
    appendNodeOutput,
    appendNodeToolEvent,
    promptImages,
    expectedAnswerImages,
    setSelectedModels,
    setError,
    cancelRequestedRef,
    abortControllerRef,
    setIsRunning,
    setIsStreaming,
    setRunStatus,
    setResults,
    setSummary,
    setCurrentRunId,
    setPromptImages,
    setExpectedAnswerImages,
    setPromptImageUrls,
    setExpectedAnswerImageUrls,
    setStep,
    setPrompt,
    setExpectedAnswer,
  ])

  // Cancel execution
  const cancelBattle = useCallback(async () => {
    cancelRequestedRef.current = true
    const runId = currentRunId
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    if (runId) {
      try {
        await cancelBattleRun(runId)
      } catch {
        // ignore cancel errors to avoid blocking UI
      }
    }
    setIsRunning(false)
    setIsStreaming(false)
    setStep('result')
    setRunStatus('cancelled')
  }, [currentRunId, cancelRequestedRef, abortControllerRef, setIsRunning, setIsStreaming, setStep, setRunStatus])

  const cancelAttempt = useCallback(async (params: { modelKey: string; attemptIndex: number }) => {
    return createCancelAttempt({ currentRunId, updateNodeState })(params)
  }, [currentRunId, updateNodeState])

  const retryAttempt = useCallback(async (params: { modelKey: string; attemptIndex: number }) => {
    return createRetryAttempt({ currentRunId, updateNodeState, setResults })(params)
  }, [currentRunId, updateNodeState, setResults])

  // Reset for new battle
  const resetBattle = useCallback(() => {
    cancelRequestedRef.current = false
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setStep('config')
    setResults([])
    setSummary(null)
    setCurrentRunId(null)
    setIsRunning(false)
    setIsStreaming(false)
    setRunStatus(null)
    setError(null)
    setPromptImages([])
    setExpectedAnswerImages([])
    setPromptImageUrls([])
    setExpectedAnswerImageUrls([])
    setNodeStates(new Map())
  }, [
    cancelRequestedRef,
    abortControllerRef,
    setStep,
    setResults,
    setSummary,
    setCurrentRunId,
    setIsRunning,
    setIsStreaming,
    setRunStatus,
    setError,
    setPromptImages,
    setExpectedAnswerImages,
    setPromptImageUrls,
    setExpectedAnswerImageUrls,
    setNodeStates,
  ])

  return {
    startBattle,
    cancelBattle,
    cancelAttempt,
    retryAttempt,
    resetBattle,
  }
}
