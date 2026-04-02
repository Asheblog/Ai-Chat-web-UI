'use client'

import { useCallback, useEffect } from 'react'
import { useToast } from '@/components/ui/use-toast'
import type { BattleRunDetail } from '@/types'
import { buildQuestionsFromRunDetail } from './single-model-runtime'
import { useSingleModelBattleShare } from './useSingleModelBattleShare'
import {
  ACTIVE_SINGLE_RUN_STORAGE_KEY,
  LAST_VIEWED_SINGLE_RUN_STORAGE_KEY,
  useSingleModelBattleHistory,
} from './useSingleModelBattleHistory'
import { useSingleModelBattleRun } from './useSingleModelBattleRun'

import { useSingleModelBattleDraft } from './useSingleModelBattleDraft'

const normalizeSingleRunStatus = (status?: string) => {
  if (status === 'pending') return 'pending' as const
  if (status === 'running') return 'running' as const
  if (status === 'completed') return 'completed' as const
  if (status === 'cancelled') return 'cancelled' as const
  if (status === 'error') return 'error' as const
  return 'idle' as const
}

const isSingleRunInProgress = (
  status: 'idle' | 'pending' | 'running' | 'completed' | 'error' | 'cancelled',
) => status === 'pending' || status === 'running'

export function useSingleModelBattleController() {
  const { toast } = useToast()
  const draft = useSingleModelBattleDraft()

  const historyState = useSingleModelBattleHistory()
  const runState = useSingleModelBattleRun({ refreshHistory: historyState.refreshHistory })
  const share = useSingleModelBattleShare(runState.runId)

  const clearExecutionState = useCallback((nextStatus: 'idle' | 'cancelled' = 'idle') => {
    runState.clearRunState(nextStatus)
    draft.setSelectedAttempt(null)
    share.resetShareState()
  }, [draft, runState, share])

  const applyHistoryRun = useCallback((detail: BattleRunDetail, asNewTask: boolean) => {
    const modelConfig = detail.config?.model || detail.results?.[0] || null
    const nextModelKey = draft.resolveModelSelectKey({
      modelId: modelConfig?.modelId || null,
      connectionId: modelConfig?.connectionId ?? null,
      rawId: modelConfig?.rawId ?? null,
    })
    const nextJudgeKey = draft.resolveModelSelectKey({
      modelId: detail.judgeModelId || null,
      connectionId: detail.judgeConnectionId ?? null,
      rawId: detail.judgeRawId ?? null,
    })

    draft.setModelKey(nextModelKey)
    draft.setJudgeKey(nextJudgeKey)
    draft.setJudgeThreshold(String(detail.judgeThreshold ?? 0.8))
    draft.setQuestions(buildQuestionsFromRunDetail(detail, (index) => `q-history-${detail.id}-${index + 1}-${Math.random().toString(36).slice(2, 8)}`))
    historyState.setHistoryExpanded(false)
    draft.setSourceRunId(detail.id)
    draft.setSelectedAttempt(null)
    share.resetShareState()

    const missingTargets: string[] = []
    if (!nextModelKey) missingTargets.push('参赛模型')
    if (!nextJudgeKey) missingTargets.push('裁判模型')
    if (missingTargets.length > 0) {
      toast({
        title: `历史记录中的${missingTargets.join('、')}已不在当前模型目录，请重新选择`,
        variant: 'destructive',
      })
    }

    if (asNewTask) {
      clearExecutionState('idle')
      return
    }

    runState.setRunId(detail.id)
    runState.setRunStatus(normalizeSingleRunStatus(detail.status))
  }, [clearExecutionState, draft, historyState, runState, toast])

  const handleLoadHistory = useCallback(async (targetRunId: number, asNewTask: boolean) => {
    historyState.setHistoryLoadingRunId(targetRunId)
    try {
      const detail = await historyState.fetchRunDetail(targetRunId)
      if (!detail) return
      applyHistoryRun(detail, asNewTask)
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(LAST_VIEWED_SINGLE_RUN_STORAGE_KEY, String(targetRunId))
      }
    } finally {
      historyState.setHistoryLoadingRunId(null)
    }
  }, [applyHistoryRun, historyState])

  useEffect(() => {
    if (historyState.restoredRef.current) return
    historyState.restoredRef.current = true
    if (typeof window === 'undefined') return
    const storedActive = window.sessionStorage.getItem(ACTIVE_SINGLE_RUN_STORAGE_KEY)
    const storedViewed = window.sessionStorage.getItem(LAST_VIEWED_SINGLE_RUN_STORAGE_KEY)
    const stored = storedActive || storedViewed
    if (!stored) return
    const parsedRunId = Number.parseInt(stored, 10)
    if (!Number.isFinite(parsedRunId)) {
      window.sessionStorage.removeItem(ACTIVE_SINGLE_RUN_STORAGE_KEY)
      window.sessionStorage.removeItem(LAST_VIEWED_SINGLE_RUN_STORAGE_KEY)
      return
    }
    void (async () => {
      const detail = await historyState.fetchRunDetail(parsedRunId, { silent: true })
      if (!detail) return
      applyHistoryRun(detail, false)
    })()
  }, [applyHistoryRun, historyState])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (runState.runId && isSingleRunInProgress(runState.runStatus)) {
      window.sessionStorage.setItem(ACTIVE_SINGLE_RUN_STORAGE_KEY, String(runState.runId))
      return
    }
    window.sessionStorage.removeItem(ACTIVE_SINGLE_RUN_STORAGE_KEY)
  }, [runState.runId, runState.runStatus])

  useEffect(() => {
    if (typeof window === 'undefined' || !runState.runId) return
    window.sessionStorage.setItem(LAST_VIEWED_SINGLE_RUN_STORAGE_KEY, String(runState.runId))
  }, [runState.runId])

  const validate = useCallback(() => {
    if (!draft.selectedModel) return '请选择参赛模型'
    if (!draft.selectedJudge) return '请选择裁判模型'
    if (draft.questions.length === 0) return '请至少配置一道题目'

    for (let i = 0; i < draft.questions.length; i += 1) {
      const question = draft.questions[i]
      if (!question.prompt.trim()) return `第 ${i + 1} 题缺少题目内容`
      if (!question.expectedAnswer.trim()) return `第 ${i + 1} 题缺少期望答案`
      if (question.passK > question.runsPerQuestion) return `第 ${i + 1} 题 passK 不能大于 runs`
    }
    return null
  }, [draft.questions, draft.selectedJudge, draft.selectedModel])

  const handleStart = useCallback(async () => {
    const validationError = validate()
    if (validationError) {
      toast({ title: validationError, variant: 'destructive' })
      return
    }
    await runState.handleStart({
      selectedModel: draft.selectedModel!,
      selectedJudge: draft.selectedJudge!,
      judgeThreshold: draft.judgeThreshold,
      maxConcurrency: draft.maxConcurrency,
      questions: draft.questions,
      onBeforeStart: () => {
        draft.setSelectedAttempt(null)
        share.resetShareState()
      },
    })
  }, [draft, runState, share, toast])

  const handleCancel = useCallback(async () => {
    await runState.handleCancel()
  }, [runState])

  const handleNewTask = useCallback(() => {
    clearExecutionState('idle')
    historyState.setHistoryExpanded(false)
  }, [clearExecutionState, historyState])

  useEffect(() => {
    if (!draft.selectedAttempt) return
    const targetQuestion = draft.questions[draft.selectedAttempt.questionIndex - 1]
    if (!targetQuestion || draft.selectedAttempt.attemptIndex > targetQuestion.runsPerQuestion) {
      draft.setSelectedAttempt(null)
    }
  }, [draft])

  return {
    modelKey: draft.modelKey,
    setModelKey: draft.setModelKey,
    judgeKey: draft.judgeKey,
    setJudgeKey: draft.setJudgeKey,
    judgeThreshold: draft.judgeThreshold,
    setJudgeThreshold: draft.setJudgeThreshold,
    maxConcurrency: draft.maxConcurrency,
    setMaxConcurrency: draft.setMaxConcurrency,
    questions: draft.questions,
    setQuestions: draft.setQuestions,
    updateQuestion: draft.updateQuestion,
    addQuestion: draft.addQuestion,
    removeQuestion: draft.removeQuestion,
    isRunning: runState.isRunning,
    isStreaming: runState.isStreaming,
    runId: runState.runId,
    runStatus: runState.runStatus,
    results: runState.results,
    liveAttempts: runState.liveAttempts,
    summary: runState.summary,
    error: runState.error,
    history: historyState.history,
    historyLoading: historyState.historyLoading,
    historyLoadingRunId: historyState.historyLoadingRunId,
    historyExpanded: historyState.historyExpanded,
    setHistoryExpanded: historyState.setHistoryExpanded,
    sourceRunId: draft.sourceRunId,
    selectedAttempt: draft.selectedAttempt,
    setSelectedAttempt: draft.setSelectedAttempt,
    shareLink: share.shareLink,
    sharing: share.sharing,
    copiedShareLink: share.copiedShareLink,
    selectedModel: draft.selectedModel,
    selectedJudge: draft.selectedJudge,
    selectedModelLabel: draft.selectedModelLabel,
    selectedJudgeLabel: draft.selectedJudgeLabel,
    buildAttemptKey: runState.buildAttemptKey,
    handleLoadHistory,
    refreshHistory: historyState.refreshHistory,
    handleStart,
    handleCancel,
    handleNewTask,
    handleShare: share.handleShare,
    handleCopyShareLink: share.handleCopyShareLink,
  }
}
