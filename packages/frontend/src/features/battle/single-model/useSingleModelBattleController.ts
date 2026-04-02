'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useToast } from '@/components/ui/use-toast'
import { cancelBattleRun, createBattleShare, getBattleRun, listBattleRuns, streamBattle } from '@/features/battle/api'
import type { BattleResult, BattleRunDetail, BattleRunSummary } from '@/types'
import { useModelsStore, type ModelItem } from '@/store/models-store'
import { modelKeyFor } from '@/store/model-preference-store'
import type { LiveAttempt, QuestionDraft, SelectedAttempt } from './types'
import { buildQuestionsFromRunDetail, clampPassSettings, parseExecutionStepIdentity } from './single-model-runtime'

const ACTIVE_SINGLE_RUN_STORAGE_KEY = 'battle:single-model:active-run-id'
const LAST_VIEWED_SINGLE_RUN_STORAGE_KEY = 'battle:single-model:last-viewed-run-id'

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

const normalizeInt = (value: string, min: number, max: number, fallback: number) => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

const normalizeSingleRunStatus = (status?: string) => {
  if (status === 'pending') return 'pending' as const
  if (status === 'running') return 'running' as const
  if (status === 'completed') return 'completed' as const
  if (status === 'cancelled') return 'cancelled' as const
  if (status === 'error') return 'error' as const
  return 'idle' as const
}

const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const asNonEmptyString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null

const asPositiveInt = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }
  return null
}

const isSingleRunInProgress = (
  status: 'idle' | 'pending' | 'running' | 'completed' | 'error' | 'cancelled',
) => status === 'pending' || status === 'running'

export function useSingleModelBattleController() {
  const { toast } = useToast()
  const { models } = useModelsStore()

  const [modelKey, setModelKey] = useState<string>('')
  const [judgeKey, setJudgeKey] = useState<string>('')
  const [judgeThreshold, setJudgeThreshold] = useState('0.8')
  const [maxConcurrency, setMaxConcurrency] = useState('3')
  const [questions, setQuestions] = useState<QuestionDraft[]>([createDefaultQuestion()])

  const [isRunning, setIsRunning] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [runId, setRunId] = useState<number | null>(null)
  const [runStatus, setRunStatus] = useState<'idle' | 'pending' | 'running' | 'completed' | 'error' | 'cancelled'>('idle')
  const [results, setResults] = useState<BattleResult[]>([])
  const [liveAttempts, setLiveAttempts] = useState<Map<string, LiveAttempt>>(new Map())
  const [summary, setSummary] = useState<BattleRunSummary['summary'] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<BattleRunSummary[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyLoadingRunId, setHistoryLoadingRunId] = useState<number | null>(null)
  const [historyExpanded, setHistoryExpanded] = useState(false)
  const [sourceRunId, setSourceRunId] = useState<number | null>(null)
  const [selectedAttempt, setSelectedAttempt] = useState<SelectedAttempt | null>(null)
  const [shareLink, setShareLink] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const [copiedShareLink, setCopiedShareLink] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const restoredRef = useRef(false)

  const selectedModel = useMemo(() => models.find((item) => modelSelectKey(item) === modelKey) || null, [models, modelKey])
  const selectedJudge = useMemo(() => models.find((item) => modelSelectKey(item) === judgeKey) || null, [models, judgeKey])
  const selectedModelLabel = useMemo(() => selectedModel?.name || selectedModel?.rawId || null, [selectedModel])
  const selectedJudgeLabel = useMemo(() => selectedJudge?.name || selectedJudge?.rawId || null, [selectedJudge])

  const buildAttemptKey = useCallback((questionIndex: number, attemptIndex: number) => `${questionIndex}#${attemptIndex}`, [])

  const clearExecutionState = useCallback((nextStatus: 'idle' | 'cancelled' = 'idle') => {
    setIsRunning(false)
    setIsStreaming(false)
    setRunId(null)
    setRunStatus(nextStatus)
    setResults([])
    setLiveAttempts(new Map())
    setSummary(null)
    setError(null)
    setSelectedAttempt(null)
    setShareLink(null)
    setCopiedShareLink(false)
  }, [])

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

  const applyRunSnapshot = useCallback((detail: BattleRunDetail) => {
    const orderedResults = [...(detail.results || [])].sort((a, b) => {
      if (a.questionIndex !== b.questionIndex) return a.questionIndex - b.questionIndex
      return a.attemptIndex - b.attemptIndex
    })
    const nextLiveAttempts = new Map<string, LiveAttempt>()
    for (const item of detail.live?.attempts || []) {
      const questionIndex = Number(item.questionIndex ?? 1)
      const attemptIndex = Number(item.attemptIndex)
      if (!Number.isFinite(questionIndex) || !Number.isFinite(attemptIndex)) continue
      nextLiveAttempts.set(buildAttemptKey(questionIndex, attemptIndex), {
        status: item.status,
        output: item.output || '',
        reasoning: item.reasoning || '',
        error: item.error ?? null,
      })
    }

    const nextStatus = normalizeSingleRunStatus(detail.status)
    setRunId(detail.id)
    setRunStatus(nextStatus)
    setResults(orderedResults)
    setLiveAttempts(nextLiveAttempts)
    setSummary(detail.summary || null)
    setError(null)
    setIsRunning(isSingleRunInProgress(nextStatus))
    setIsStreaming(false)
  }, [buildAttemptKey])

  const applyHistoryRun = useCallback((detail: BattleRunDetail, asNewTask: boolean) => {
    const modelConfig = detail.config?.model || detail.results?.[0] || null
    const nextModelKey = resolveModelSelectKey({
      modelId: modelConfig?.modelId || null,
      connectionId: modelConfig?.connectionId ?? null,
      rawId: modelConfig?.rawId ?? null,
    })
    const nextJudgeKey = resolveModelSelectKey({
      modelId: detail.judgeModelId || null,
      connectionId: detail.judgeConnectionId ?? null,
      rawId: detail.judgeRawId ?? null,
    })

    setModelKey(nextModelKey)
    setJudgeKey(nextJudgeKey)
    setJudgeThreshold(String(detail.judgeThreshold ?? 0.8))
    setQuestions(buildQuestionsFromRunDetail(detail, (index) => `q-history-${detail.id}-${index + 1}-${Math.random().toString(36).slice(2, 8)}`))
    setHistoryExpanded(false)
    setSourceRunId(detail.id)
    setSelectedAttempt(null)
    setShareLink(null)
    setCopiedShareLink(false)

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

    applyRunSnapshot(detail)
  }, [applyRunSnapshot, clearExecutionState, resolveModelSelectKey, toast])

  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const res = await listBattleRuns({ page: 1, limit: 30 })
      if (res?.success && res.data) {
        setHistory(res.data.runs.filter((item) => item.mode === 'single_model_multi_question'))
      }
    } catch (err: any) {
      toast({ title: err?.message || '加载历史记录失败', variant: 'destructive' })
    } finally {
      setHistoryLoading(false)
    }
  }, [toast])

  const fetchRunDetail = useCallback(async (targetRunId: number, options?: { silent?: boolean }) => {
    try {
      const res = await getBattleRun(targetRunId)
      if (!res?.success || !res.data) {
        if (!options?.silent) {
          toast({ title: res?.error || '加载记录失败', variant: 'destructive' })
        }
        return null
      }
      const detail = res.data as BattleRunDetail
      if (detail.mode !== 'single_model_multi_question') {
        if (!options?.silent) {
          toast({ title: '该记录不属于单模型多问题模式', variant: 'destructive' })
        }
        return null
      }
      return detail
    } catch (err: any) {
      if (!options?.silent) {
        toast({ title: err?.message || '加载记录失败', variant: 'destructive' })
      }
      return null
    }
  }, [toast])

  const handleLoadHistory = useCallback(async (targetRunId: number, asNewTask: boolean) => {
    setHistoryLoadingRunId(targetRunId)
    try {
      const detail = await fetchRunDetail(targetRunId)
      if (!detail) return
      applyHistoryRun(detail, asNewTask)
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(LAST_VIEWED_SINGLE_RUN_STORAGE_KEY, String(targetRunId))
      }
    } finally {
      setHistoryLoadingRunId(null)
    }
  }, [applyHistoryRun, fetchRunDetail])

  useEffect(() => {
    void refreshHistory()
  }, [refreshHistory])

  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
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
      const detail = await fetchRunDetail(parsedRunId, { silent: true })
      if (!detail) return
      applyHistoryRun(detail, false)
    })()
  }, [applyHistoryRun, fetchRunDetail])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (runId && isSingleRunInProgress(runStatus)) {
      window.sessionStorage.setItem(ACTIVE_SINGLE_RUN_STORAGE_KEY, String(runId))
      return
    }
    window.sessionStorage.removeItem(ACTIVE_SINGLE_RUN_STORAGE_KEY)
  }, [runId, runStatus])

  useEffect(() => {
    if (typeof window === 'undefined' || !runId) return
    window.sessionStorage.setItem(LAST_VIEWED_SINGLE_RUN_STORAGE_KEY, String(runId))
  }, [runId])

  useEffect(() => {
    if (!runId || isStreaming || !isSingleRunInProgress(runStatus)) return
    let stopped = false
    let inFlight = false
    const poll = async () => {
      if (stopped || inFlight) return
      inFlight = true
      try {
        const detail = await fetchRunDetail(runId, { silent: true })
        if (!detail || stopped) return
        applyRunSnapshot(detail)
        if (!isSingleRunInProgress(normalizeSingleRunStatus(detail.status))) {
          void refreshHistory()
        }
      } finally {
        inFlight = false
      }
    }
    void poll()
    const timer = window.setInterval(() => {
      void poll()
    }, 2000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [applyRunSnapshot, fetchRunDetail, isStreaming, refreshHistory, runId, runStatus])

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

  const validate = useCallback(() => {
    if (!selectedModel) return '请选择参赛模型'
    if (!selectedJudge) return '请选择裁判模型'
    if (questions.length === 0) return '请至少配置一道题目'

    for (let i = 0; i < questions.length; i += 1) {
      const question = questions[i]
      if (!question.prompt.trim()) return `第 ${i + 1} 题缺少题目内容`
      if (!question.expectedAnswer.trim()) return `第 ${i + 1} 题缺少期望答案`
      if (question.passK > question.runsPerQuestion) return `第 ${i + 1} 题 passK 不能大于 runs`
    }
    return null
  }, [questions, selectedJudge, selectedModel])

  const handleStart = useCallback(async () => {
    const validationError = validate()
    if (validationError) {
      toast({ title: validationError, variant: 'destructive' })
      return
    }

    const thresholdValue = Number.parseFloat(judgeThreshold)
    const concurrencyValue = normalizeInt(maxConcurrency, 1, 6, 3)
    if (!Number.isFinite(thresholdValue) || thresholdValue < 0 || thresholdValue > 1) {
      toast({ title: '裁判阈值需在 0-1 之间', variant: 'destructive' })
      return
    }

    const controller = new AbortController()
    if (abortRef.current) {
      abortRef.current.abort()
    }
    abortRef.current = controller

    setIsRunning(true)
    setIsStreaming(true)
    setRunStatus('running')
    setRunId(null)
    setSummary(null)
    setResults([])
    setLiveAttempts(new Map())
    setError(null)
    setSelectedAttempt(null)
    setShareLink(null)
    setCopiedShareLink(false)

    try {
      const payload = {
        mode: 'single_model_multi_question' as const,
        judge: {
          modelId: selectedJudge!.id,
          connectionId: selectedJudge!.connectionId,
          rawId: selectedJudge!.rawId,
        },
        judgeThreshold: thresholdValue,
        model: {
          modelId: selectedModel!.id,
          connectionId: selectedModel!.connectionId,
          rawId: selectedModel!.rawId,
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
          const { questionIndex, attemptIndex } = identity
          const key = buildAttemptKey(questionIndex, attemptIndex)
          setLiveAttempts((prev) => {
            const next = new Map(prev)
            next.set(key, {
              status: 'running',
              output: next.get(key)?.output || '',
              reasoning: next.get(key)?.reasoning || '',
              error: null,
            })
            return next
          })
        }

        if (event.type === 'step_delta') {
          const identity = parseExecutionStepIdentity(event.stepId)
          const payload = asObject(event.payload)
          if (!identity || !payload) continue
          const { questionIndex, attemptIndex } = identity
          const key = buildAttemptKey(questionIndex, attemptIndex)
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
                next.set(key, {
                  ...current,
                  status: 'error',
                  error: message,
                })
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
              status: result.error
                ? 'error'
                : (result.judgeStatus === 'running'
                  ? 'judging'
                  : (result.judgeStatus === 'success' && result.judgePass === true)
                    ? 'success'
                    : 'error'),
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
          if (event.status !== 'cancelled') {
            setError(message)
          }
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
        const message = err?.message || '执行失败'
        setError(message)
        setRunStatus('error')
      }
      setIsRunning(false)
    } finally {
      setIsStreaming(false)
      if (abortRef.current === controller) abortRef.current = null
      void refreshHistory()
    }
  }, [buildAttemptKey, judgeThreshold, maxConcurrency, questions, refreshHistory, selectedJudge, selectedModel, toast, validate])

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

  const handleNewTask = useCallback(() => {
    clearExecutionState('idle')
    setHistoryExpanded(false)
  }, [clearExecutionState])

  const handleShare = useCallback(async () => {
    if (!runId || sharing) return
    setSharing(true)
    try {
      const res = await createBattleShare(runId)
      if (!res?.success || !res.data) {
        toast({ title: res?.error || '生成分享链接失败', variant: 'destructive' })
        return
      }
      const token = res.data.token
      const base = typeof window !== 'undefined' ? window.location.origin : ''
      const link = `${base}/share/battle/${token}`
      setShareLink(link)
      setCopiedShareLink(false)
      toast({ title: '分享链接已生成' })
    } catch (err: any) {
      toast({ title: err?.message || '生成分享链接失败', variant: 'destructive' })
    } finally {
      setSharing(false)
    }
  }, [runId, sharing, toast])

  const handleCopyShareLink = useCallback(async () => {
    if (!shareLink) return
    try {
      await navigator.clipboard.writeText(shareLink)
      setCopiedShareLink(true)
      toast({ title: '分享链接已复制' })
      window.setTimeout(() => setCopiedShareLink(false), 1800)
    } catch {
      toast({ title: '复制分享链接失败', variant: 'destructive' })
    }
  }, [shareLink, toast])

  useEffect(() => {
    if (!selectedAttempt) return
    const targetQuestion = questions[selectedAttempt.questionIndex - 1]
    if (!targetQuestion || selectedAttempt.attemptIndex > targetQuestion.runsPerQuestion) {
      setSelectedAttempt(null)
    }
  }, [questions, selectedAttempt])

  return {
    models,
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
    isRunning,
    isStreaming,
    runId,
    runStatus,
    results,
    liveAttempts,
    summary,
    error,
    history,
    historyLoading,
    historyLoadingRunId,
    historyExpanded,
    setHistoryExpanded,
    sourceRunId,
    selectedAttempt,
    setSelectedAttempt,
    shareLink,
    sharing,
    copiedShareLink,
    selectedModel,
    selectedJudge,
    selectedModelLabel,
    selectedJudgeLabel,
    buildAttemptKey,
    handleLoadHistory,
    refreshHistory,
    handleStart,
    handleCancel,
    handleNewTask,
    handleShare,
    handleCopyShareLink,
  }
}
