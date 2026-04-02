'use client'

import { useCallback, useMemo, useState } from 'react'
import { useModelsStore, type ModelItem } from '@/store/models-store'
import { modelKeyFor } from '@/store/model-preference-store'
import type { QuestionDraft, SelectedAttempt } from './types'

const createDefaultQuestion = (): QuestionDraft => ({
  localId: `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  questionId: '',
  title: '',
  prompt: '',
  expectedAnswer: '',
  runsPerQuestion: 1,
  passK: 1,
})

const modelSelectKey = (model: Pick<ModelItem, 'id' | 'connectionId' | 'rawId'>) => modelKeyFor(model)

export function useSingleModelBattleDraft() {
  const { models } = useModelsStore()
  const [modelKey, setModelKey] = useState<string>('')
  const [judgeKey, setJudgeKey] = useState<string>('')
  const [judgeThreshold, setJudgeThreshold] = useState('0.8')
  const [maxConcurrency, setMaxConcurrency] = useState('3')
  const [questions, setQuestions] = useState<QuestionDraft[]>([createDefaultQuestion()])
  const [sourceRunId, setSourceRunId] = useState<number | null>(null)
  const [selectedAttempt, setSelectedAttempt] = useState<SelectedAttempt | null>(null)

  const selectedModel = useMemo(() => models.find((item) => modelSelectKey(item) === modelKey) || null, [models, modelKey])
  const selectedJudge = useMemo(() => models.find((item) => modelSelectKey(item) === judgeKey) || null, [models, judgeKey])
  const selectedModelLabel = useMemo(() => selectedModel?.name || selectedModel?.rawId || null, [selectedModel])
  const selectedJudgeLabel = useMemo(() => selectedJudge?.name || selectedJudge?.rawId || null, [selectedJudge])

  const resolveModelSelectKey = useCallback((params?: { modelId?: string | null; connectionId?: number | null; rawId?: string | null }) => {
    if (!params) return ''
    const rawId = (params.rawId || '').trim()
    if (params.connectionId != null && rawId) {
      const matched = models.find((item) => item.connectionId === params.connectionId && item.rawId === rawId)
      return matched ? modelSelectKey(matched) : ''
    }
    const modelId = (params.modelId || '').trim()
    if (!modelId) return ''
    const matched = models.find((item) => item.id === modelId)
    return matched ? modelSelectKey(matched) : ''
  }, [models])

  const updateQuestion = useCallback((localId: string, updater: (current: QuestionDraft) => QuestionDraft) => {
    setQuestions((prev) => prev.map((item) => (item.localId === localId ? updater(item) : item)))
  }, [])

  const removeQuestion = useCallback((localId: string) => {
    setQuestions((prev) => {
      if (prev.length <= 1) return prev
      return prev.filter((item) => item.localId !== localId)
    })
  }, [])

  const addQuestion = useCallback(() => {
    setQuestions((prev) => [...prev, createDefaultQuestion()])
  }, [])

  const resetDraftFromNewTask = useCallback(() => {
    setSelectedAttempt(null)
  }, [])

  return {
    modelKey,
    setModelKey,
    judgeKey,
    setJudgeKey,
    judgeThreshold,
    setJudgeThreshold,
    maxConcurrency,
    setMaxConcurrency,
    questions,
    setQuestions,
    updateQuestion,
    addQuestion,
    removeQuestion,
    sourceRunId,
    setSourceRunId,
    selectedAttempt,
    setSelectedAttempt,
    selectedModel,
    selectedJudge,
    selectedModelLabel,
    selectedJudgeLabel,
    resolveModelSelectKey,
    resetDraftFromNewTask,
  }
}
