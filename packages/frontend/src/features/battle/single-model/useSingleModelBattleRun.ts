'use client'

import { useCallback, useRef, useState } from 'react'
import { useToast } from '@/components/ui/use-toast'
import { cancelBattleRun, streamBattle } from '@/features/battle/api'
import type { BattleResult, BattleRunSummary } from '@/types'
import type { LiveAttempt, QuestionDraft, SingleModelRunStatus } from './types'
import { parseExecutionStepIdentity } from './single-model-runtime'

const normalizeInt = (value: string, min: number, max: number, fallback: number) => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const asNonEmptyString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null

const asPositiveInt = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value)
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return null
}

type StartParams = {
  selectedModel: { id: string; connectionId?: number | null; rawId?: string | null }
  selectedJudge: { id: string; connectionId?: number | null; rawId?: string | null }
  judgeThreshold: string
  maxConcurrency: string
  questions: QuestionDraft[]
  onBeforeStart?: () => void
}

export function useSingleModelBattleRun({ refreshHistory }: { refreshHistory: () => void | Promise<void> }) {
  const { toast } = useToast()
  const [isRunning, setIsRunning] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [runId, setRunId] = useState<number | null>(null)
  const [runStatus, setRunStatus] = useState<SingleModelRunStatus>('idle')
  const [results, setResults] = useState<BattleResult[]>([])
  const [liveAttempts, setLiveAttempts] = useState<Map<string, LiveAttempt>>(new Map())
  const [summary, setSummary] = useState<BattleRunSummary['summary'] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const buildAttemptKey = useCallback((questionIndex: number, attemptIndex: number) => `${questionIndex}#${attemptIndex}`, [])

  const clearRunState = useCallback((nextStatus: SingleModelRunStatus = 'idle') => {
    setIsRunning(false)
    setIsStreaming(false)
    setRunId(null)
    setRunStatus(nextStatus)
    setResults([])
    setLiveAttempts(new Map())
    setSummary(null)
    setError(null)
  }, [])

  const handleStart = useCallback(async ({
    selectedModel,
    selectedJudge,
    judgeThreshold,
    maxConcurrency,
    questions,
    onBeforeStart,
  }: StartParams) => {
    const thresholdValue = Number.parseFloat(judgeThreshold)
    const concurrencyValue = normalizeInt(maxConcurrency, 1, 6, 3)
    if (!Number.isFinite(thresholdValue) || thresholdValue < 0 || thresholdValue > 1) {
      toast({ title: '裁判阈值需在 0-1 之间', variant: 'destructive' })
      return
    }

    const controller = new AbortController()
    if (abortRef.current) abortRef.current.abort()
    abortRef.current = controller

    onBeforeStart?.()
    setIsRunning(true)
    setIsStreaming(true)
    setRunStatus('running')
    setRunId(null)
    setSummary(null)
    setResults([])
    setLiveAttempts(new Map())
    setError(null)

    try {
      const payload = {
        mode: 'single_model_multi_question' as const,
        judge: {
          modelId: selectedJudge.id,
          ...(selectedJudge.connectionId != null ? { connectionId: selectedJudge.connectionId } : {}),
          ...(selectedJudge.rawId ? { rawId: selectedJudge.rawId } : {}),
        },
        judgeThreshold: thresholdValue,
        model: {
          modelId: selectedModel.id,
          ...(selectedModel.connectionId != null ? { connectionId: selectedModel.connectionId } : {}),
          ...(selectedModel.rawId ? { rawId: selectedModel.rawId } : {}),
        },
        questions: questions.map((item) => ({
          ...(item.questionId.trim() ? { questionId: item.questionId.trim() } : {}),
          ...(item.title.trim() ? { title: item.title.trim() } : {}),
          prompt: { text: item.prompt.trim() },
          expectedAnswer: { text: item.expectedAnswer.trim() },
          runsPerQuestion: item.runsPerQuestion,
          passK: item.passK,
        })),
        maxConcurrency: concurrencyValue,
      }

      for await (const event of streamBattle(payload, { signal: controller.signal })) {
        if (event.type === 'run_start') {
          const payload = asObject(event.payload)
          const id = asPositiveInt(payload?.sourceId) ?? asPositiveInt(payload?.id)
          if (Number.isFinite(id)) setRunId(id)
        }

        if (event.type === 'step_start') {
          const identity = parseExecutionStepIdentity(event.stepId)
          if (!identity) continue
          const key = buildAttemptKey(identity.questionIndex, identity.attemptIndex)
          setLiveAttempts((prev) => {
            const next = new Map(prev)
            next.set(key, { status: 'running', output: next.get(key)?.output || '', reasoning: next.get(key)?.reasoning || '', error: null })
            return next
          })
        }

        if (event.type === 'step_delta') {
          const identity = parseExecutionStepIdentity(event.stepId)
          const payload = asObject(event.payload)
          if (!identity || !payload) continue
          const key = buildAttemptKey(identity.questionIndex, identity.attemptIndex)
          const channel = asNonEmptyString(payload.channel)
          const delta = asNonEmptyString(payload.delta) || ''
          const reasoning = channel === 'reasoning' ? delta : ''
          const content = channel === 'reasoning' ? '' : delta
          if (!delta && !reasoning) continue
          setLiveAttempts((prev) => {
            const next = new Map(prev)
            const current = next.get(key) || { status: 'running', output: '', reasoning: '' }
            next.set(key, {
              status: current.status,
              output: `${current.output}${content}`,
              reasoning: `${current.reasoning}${reasoning}`,
              error: current.error ?? null,
            })
            return next
          })
        }

        if (event.type === 'step_complete') {
          const payload = asObject(event.payload)
          if (!payload) continue
          const identity = parseExecutionStepIdentity(event.stepId)
          const resultObject = asObject(payload.result)
          if (!resultObject) {
            if (identity) {
              const key = buildAttemptKey(identity.questionIndex, identity.attemptIndex)
              const message = asNonEmptyString(payload.error) || '执行失败'
              setLiveAttempts((prev) => {
                const next = new Map(prev)
                const current = next.get(key) || { status: 'running', output: '', reasoning: '' }
                next.set(key, { ...current, status: 'error', error: message })
                return next
              })
            }
            continue
          }

          const result = resultObject as unknown as BattleResult
          const questionIndex = asPositiveInt(result.questionIndex) ?? identity?.questionIndex ?? 1
          const attemptIndex = asPositiveInt(result.attemptIndex) ?? identity?.attemptIndex
          if (!attemptIndex) continue
          const key = buildAttemptKey(questionIndex, attemptIndex)
          setResults((prev) => {
            const next = prev.filter((item) => !(item.questionIndex === questionIndex && item.attemptIndex === attemptIndex))
            next.push({ ...result, questionIndex })
            return next
          })
          setLiveAttempts((prev) => {
            const next = new Map(prev)
            next.set(key, {
              status: result.error ? 'error' : (result.judgeStatus === 'running' ? 'judging' : (result.judgeStatus === 'success' && result.judgePass === true) ? 'success' : 'error'),
              output: result.output || next.get(key)?.output || '',
              reasoning: result.reasoning || next.get(key)?.reasoning || '',
              error: result.error ?? null,
            })
            return next
          })
        }

        if (event.type === 'run_complete') {
          const payload = asObject(event.payload)
          const nextSummary = (payload?.summary || null) as BattleRunSummary['summary'] | null
          if (nextSummary) setSummary(nextSummary)
          setRunStatus('completed')
          void refreshHistory()
        }

        if (event.type === 'run_error') {
          const payload = asObject(event.payload)
          const message = asNonEmptyString(payload?.message) || '执行失败'
          if (event.status !== 'cancelled') setError(message)
          setRunStatus(event.status === 'cancelled' ? 'cancelled' : 'error')
          setIsRunning(false)
          void refreshHistory()
        }

        if (event.type === 'complete') {
          setIsRunning(false)
          setRunStatus((prev) => (prev === 'error' || prev === 'cancelled' ? prev : 'completed'))
        }
      }
    } catch (err: any) {
      if (controller.signal.aborted) {
        setRunStatus('cancelled')
      } else {
        setError(err?.message || '执行失败')
        setRunStatus('error')
      }
      setIsRunning(false)
    } finally {
      setIsStreaming(false)
      if (abortRef.current === controller) abortRef.current = null
      void refreshHistory()
    }
  }, [buildAttemptKey, refreshHistory, toast])

  const handleCancel = useCallback(async () => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    if (runId) {
      try {
        await cancelBattleRun(runId)
      } catch {
        // ignore
      }
    }
    setIsRunning(false)
    setIsStreaming(false)
    setRunStatus('cancelled')
    void refreshHistory()
  }, [refreshHistory, runId])

  return {
    isRunning,
    isStreaming,
    runId,
    runStatus,
    results,
    liveAttempts,
    summary,
    error,
    setRunId,
    setRunStatus,
    setIsRunning,
    clearRunState,
    buildAttemptKey,
    handleStart,
    handleCancel,
  }
}
