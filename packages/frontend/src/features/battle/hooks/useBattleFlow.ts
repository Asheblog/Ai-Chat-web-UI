'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import type { ModelItem } from '@/store/models-store'
import type { BattleResult, BattleRunSummary } from '@/types'
import { streamBattle, type BattleStreamPayload } from '../api'

// ==================== Types ====================

export type BattleStep = 'config' | 'prompt' | 'execution' | 'result'
export type NodeStatus = 'pending' | 'running' | 'success' | 'error' | 'judging'

export interface ModelConfigState {
  key: string
  model: ModelItem
  webSearchEnabled: boolean
  pythonEnabled: boolean
  reasoningEnabled: boolean
  reasoningEffort: 'low' | 'medium' | 'high'
  ollamaThink: boolean
  customBody: string
  customHeaders: Array<{ name: string; value: string }>
  customBodyError?: string | null
  advancedOpen: boolean
}

export interface NodeState {
  modelKey: string
  modelLabel: string
  status: NodeStatus
  attemptIndex: number
  durationMs?: number | null
  output?: string
  error?: string | null
  judgePass?: boolean | null
  judgeScore?: number | null
  judgeReason?: string | null
}

export interface JudgeConfig {
  model: ModelItem | null
  threshold: number
  runsPerModel: number
  passK: number
  maxConcurrency: number
}

export interface BattleFlowState {
  step: BattleStep
  selectedModels: ModelConfigState[]
  judgeConfig: JudgeConfig
  prompt: string
  expectedAnswer: string
  nodeStates: Map<string, NodeState[]>
  results: BattleResult[]
  summary: BattleRunSummary['summary'] | null
  currentRunId: number | null
  isRunning: boolean
  isStreaming: boolean
  runStatus: BattleRunSummary['status'] | null
  error: string | null
}

// ==================== Constants ====================

const FORBIDDEN_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'host',
  'connection',
  'transfer-encoding',
  'content-length',
  'accept-encoding',
])

// ==================== Helpers ====================

export const normalizeThreshold = (value: string, fallback = 0.8): number => {
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(1, Math.max(0, parsed))
}

export const normalizeInteger = (value: string, fallback: number, min: number, max: number): number => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

export const parseCustomBody = (raw: string): { value: Record<string, any> | undefined; error: string | null } => {
  const trimmed = raw.trim()
  if (!trimmed) {
    return { value: undefined, error: null }
  }
  try {
    const parsed = JSON.parse(trimmed)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { value: undefined, error: '自定义请求体必须是 JSON 对象' }
    }
    return { value: parsed as Record<string, any>, error: null }
  } catch (error: any) {
    const message = error instanceof Error ? error.message : '自定义请求体解析失败'
    return { value: undefined, error: message }
  }
}

export const sanitizeHeaders = (
  headers: Array<{ name: string; value: string }>
): { ok: boolean; headers: Array<{ name: string; value: string }>; reason?: string } => {
  const sanitized: Array<{ name: string; value: string }> = []
  for (const item of headers) {
    const name = (item?.name || '').trim()
    const value = (item?.value || '').trim()
    if (!name && !value) continue
    if (!name) return { ok: false, reason: '请输入请求头名称', headers: [] }
    if (name.length > 64) return { ok: false, reason: '请求头名称需 ≤ 64 字符', headers: [] }
    if (value.length > 2048) return { ok: false, reason: '请求头值需 ≤ 2048 字符', headers: [] }
    const lower = name.toLowerCase()
    if (FORBIDDEN_HEADER_NAMES.has(lower) || lower.startsWith('proxy-') || lower.startsWith('sec-')) {
      return { ok: false, reason: '敏感或受保护的请求头无法覆盖，请更换名称', headers: [] }
    }
    const existingIdx = sanitized.findIndex((header) => header.name.toLowerCase() === lower)
    if (existingIdx >= 0) sanitized.splice(existingIdx, 1)
    if (!value) continue
    sanitized.push({ name, value })
  }
  return { ok: true, headers: sanitized }
}

export const modelKeyFor = (model: ModelItem): string => {
  if (model.connectionId && model.rawId) {
    return `${model.connectionId}:${model.rawId}`
  }
  return `global:${model.id}`
}

const isPlaceholderModel = (model: ModelItem) =>
  model.provider === 'unknown' || model.channelName === 'unknown' || model.connectionId === 0

type BattleNodeModel = {
  modelId: string
  connectionId?: number | null
  rawId?: string | null
  label?: string | null
}

const resolveModelFromCatalog = (
  catalog: ModelItem[] | undefined,
  ref: { modelId: string; connectionId?: number | null; rawId?: string | null },
) => {
  if (!catalog || catalog.length === 0) return null
  if (ref.connectionId != null && ref.rawId) {
    return catalog.find((item) => item.connectionId === ref.connectionId && item.rawId === ref.rawId) || null
  }
  return catalog.find((item) => item.id === ref.modelId) || null
}

const buildPlaceholderModel = (ref: { modelId: string; connectionId?: number | null; rawId?: string | null }): ModelItem => {
  const rawId = ref.rawId || ref.modelId
  return {
    id: ref.modelId,
    rawId,
    name: rawId,
    provider: 'unknown',
    channelName: 'unknown',
    connectionBaseUrl: '',
    connectionId: ref.connectionId ?? 0,
  }
}

const buildConfigState = (model: ModelItem): ModelConfigState => ({
  key: modelKeyFor(model),
  model,
  webSearchEnabled: false,
  pythonEnabled: false,
  reasoningEnabled: false,
  reasoningEffort: 'medium',
  ollamaThink: false,
  customBody: '',
  customHeaders: [],
  customBodyError: null,
  advancedOpen: false,
})

const buildModelKey = (model: { modelId: string; connectionId?: number | null; rawId?: string | null }): string => {
  if (model.connectionId != null && model.rawId) {
    return `${model.connectionId}:${model.rawId}`
  }
  return `global:${model.modelId}`
}

const resolveNodeLabel = (model: BattleNodeModel, catalog?: ModelItem[]) => {
  const explicit = (model.label || '').trim()
  if (explicit) return explicit
  const matched = catalog?.find((item) => {
    if (model.connectionId != null && model.rawId) {
      return item.connectionId === model.connectionId && item.rawId === model.rawId
    }
    return item.id === model.modelId
  })
  return matched?.name || model.rawId || model.modelId
}

const buildNodeStatesFromRun = (
  models: BattleNodeModel[],
  runsPerModel: number,
  results: BattleResult[],
  catalog?: ModelItem[],
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
        status: result.error ? 'error' : result.judgePass ? 'success' : 'error',
        durationMs: result.durationMs,
        output: result.output,
        error: result.error,
        judgePass: result.judgePass,
        judgeScore: result.judgeScore,
        judgeReason: result.judgeReason,
      }
    }
    map.set(key, attempts)
  }

  return map
}

// ==================== Hook ====================

export function useBattleFlow() {
  const [step, setStep] = useState<BattleStep>('config')
  const [selectedModels, setSelectedModels] = useState<ModelConfigState[]>([])
  const [judgeConfig, setJudgeConfig] = useState<JudgeConfig>({
    model: null,
    threshold: 0.8,
    runsPerModel: 1,
    passK: 1,
    maxConcurrency: 3,
  })
  const [prompt, setPrompt] = useState('')
  const [expectedAnswer, setExpectedAnswer] = useState('')
  const [nodeStates, setNodeStates] = useState<Map<string, NodeState[]>>(new Map())
  const [results, setResults] = useState<BattleResult[]>([])
  const [summary, setSummary] = useState<BattleRunSummary['summary'] | null>(null)
  const [currentRunId, setCurrentRunId] = useState<number | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [runStatus, setRunStatus] = useState<BattleRunSummary['status'] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const abortControllerRef = useRef<AbortController | null>(null)

  // Model selection handlers
  const addModel = useCallback((model: ModelItem) => {
    const key = modelKeyFor(model)
    setSelectedModels((prev) => {
      if (prev.length >= 8) return prev
      if (prev.some((item) => item.key === key)) return prev
      return [
        ...prev,
        {
          key,
          model,
          webSearchEnabled: false,
          pythonEnabled: false,
          reasoningEnabled: false,
          reasoningEffort: 'medium',
          ollamaThink: false,
          customBody: '',
          customHeaders: [],
          customBodyError: null,
          advancedOpen: false,
        },
      ]
    })
  }, [])

  const removeModel = useCallback((key: string) => {
    setSelectedModels((prev) => prev.filter((item) => item.key !== key))
  }, [])

  const updateModelConfig = useCallback(
    (key: string, updater: (item: ModelConfigState) => ModelConfigState) => {
      setSelectedModels((prev) => prev.map((item) => (item.key === key ? updater(item) : item)))
    },
    []
  )

  // Navigation
  const goToStep = useCallback((newStep: BattleStep) => {
    setStep(newStep)
  }, [])

  const canProceedToPrompt = useMemo(() => {
    return selectedModels.length > 0 && judgeConfig.model !== null
  }, [selectedModels.length, judgeConfig.model])

  const canStartBattle = useMemo(() => {
    return prompt.trim().length > 0 && expectedAnswer.trim().length > 0
  }, [prompt, expectedAnswer])

  // Initialize node states for execution visualization
  const initializeNodeStates = useCallback(() => {
    const models = selectedModels.map((modelConfig) => ({
      modelId: modelConfig.model.id,
      connectionId: modelConfig.model.connectionId,
      rawId: modelConfig.model.rawId,
      label: modelConfig.model.name,
    }))
    setNodeStates(buildNodeStatesFromRun(models, judgeConfig.runsPerModel, []))
  }, [selectedModels, judgeConfig.runsPerModel])

  // Update node state based on SSE events
  const updateNodeState = useCallback(
    (modelKey: string, attemptIndex: number, updates: Partial<NodeState>) => {
      setNodeStates((prev) => {
        const newMap = new Map(prev)
        const attempts = newMap.get(modelKey)
        if (attempts) {
          const newAttempts = attempts.map((attempt) =>
            attempt.attemptIndex === attemptIndex ? { ...attempt, ...updates } : attempt
          )
          newMap.set(modelKey, newAttempts)
        }
        return newMap
      })
    },
    []
  )

  const appendNodeOutput = useCallback((modelKey: string, attemptIndex: number, delta: string) => {
    if (!delta) return
    setNodeStates((prev) => {
      const next = new Map(prev)
      const attempts = next.get(modelKey) || []
      let updated = false
      const newAttempts = attempts.map((attempt) => {
        if (attempt.attemptIndex !== attemptIndex) return attempt
        updated = true
        return {
          ...attempt,
          status: attempt.status === 'pending' ? 'running' : attempt.status,
          output: `${attempt.output || ''}${delta}`,
        }
      })
      if (!updated) {
        const modelLabel = attempts[0]?.modelLabel || modelKey
        newAttempts.push({
          modelKey,
          modelLabel,
          status: 'running',
          attemptIndex,
          output: delta,
        })
      }
      newAttempts.sort((a, b) => a.attemptIndex - b.attemptIndex)
      next.set(modelKey, newAttempts)
      return next
    })
  }, [])

  // Validate and build payload
  const validateAndBuildPayload = useCallback((): {
    valid: boolean;
    payload?: BattleStreamPayload;
    error?: string;
    updatedConfigs?: ModelConfigState[];
  } => {
    if (!prompt.trim()) {
      return { valid: false, error: '请输入问题' }
    }
    if (!expectedAnswer.trim()) {
      return { valid: false, error: '请输入期望答案' }
    }
    if (!judgeConfig.model) {
      return { valid: false, error: '请选择裁判模型' }
    }
    if (selectedModels.length === 0) {
      return { valid: false, error: '至少选择一个参赛模型' }
    }
    if (judgeConfig.passK > judgeConfig.runsPerModel) {
      return { valid: false, error: 'pass@k 不能大于运行次数' }
    }

    const modelPayloads: BattleStreamPayload['models'] = []
    let hasError = false
    const updatedConfigs: ModelConfigState[] = []

    for (const item of selectedModels) {
      const bodyResult = parseCustomBody(item.customBody)
      const headerResult = sanitizeHeaders(item.customHeaders)

      const config: ModelConfigState = {
        ...item,
        customBodyError: bodyResult.error,
      }
      updatedConfigs.push(config)

      if (bodyResult.error) {
        hasError = true
        continue
      }
      if (!headerResult.ok) {
        hasError = true
        continue
      }

      modelPayloads.push({
        modelId: item.model.id,
        connectionId: item.model.connectionId,
        rawId: item.model.rawId,
        features: {
          web_search: item.webSearchEnabled,
          python_tool: item.pythonEnabled,
        },
        custom_body: bodyResult.value,
        custom_headers: headerResult.headers,
        reasoningEnabled: item.reasoningEnabled,
        reasoningEffort: item.reasoningEffort,
        ollamaThink: item.ollamaThink,
      })
    }

    if (hasError) {
      return {
        valid: false,
        error: '请修正自定义请求配置',
        updatedConfigs
      }
    }

    const payload: BattleStreamPayload = {
      prompt: prompt.trim(),
      expectedAnswer: expectedAnswer.trim(),
      judge: {
        modelId: judgeConfig.model.id,
        connectionId: judgeConfig.model.connectionId,
        rawId: judgeConfig.model.rawId,
      },
      judgeThreshold: judgeConfig.threshold,
      runsPerModel: judgeConfig.runsPerModel,
      passK: judgeConfig.passK,
      maxConcurrency: judgeConfig.maxConcurrency,
      models: modelPayloads,
    }

    return { valid: true, payload, updatedConfigs }
  }, [prompt, expectedAnswer, judgeConfig, selectedModels])

  // Execute battle
  const startBattle = useCallback(async (models: ModelItem[]) => {
    const validation = validateAndBuildPayload()

    if (validation.updatedConfigs) {
      setSelectedModels(validation.updatedConfigs)
    }

    if (!validation.valid || !validation.payload) {
      setError(validation.error || '验证失败')
      return { success: false, error: validation.error }
    }

    setIsRunning(true)
    setIsStreaming(true)
    setRunStatus('running')
    setResults([])
    setSummary(null)
    setCurrentRunId(null)
    setError(null)
    initializeNodeStates()
    setStep('execution')

    try {
      for await (const event of streamBattle(validation.payload)) {
        if (event.type === 'run_start') {
          const id = Number(event.payload?.id)
          if (Number.isFinite(id)) {
            setCurrentRunId(id)
          }
        }

        if (event.type === 'attempt_start') {
          const payload = event.payload as {
            modelKey?: string
            modelId?: string
            connectionId?: number | null
            rawId?: string | null
            attemptIndex?: number
          } | undefined
          const attemptIndex = payload?.attemptIndex
          const modelKey = payload?.modelKey
            || (payload?.modelId
              ? buildModelKey({
                modelId: payload.modelId,
                connectionId: payload.connectionId ?? null,
                rawId: payload.rawId ?? null,
              })
              : null)
          if (modelKey && attemptIndex) {
            updateNodeState(modelKey, attemptIndex, { status: 'running' })
          }
        }

        if (event.type === 'attempt_delta') {
          const payload = event.payload as {
            modelKey?: string
            modelId?: string
            connectionId?: number | null
            rawId?: string | null
            attemptIndex?: number
            delta?: string
          } | undefined
          const attemptIndex = payload?.attemptIndex
          const delta = typeof payload?.delta === 'string' ? payload.delta : ''
          const modelKey = payload?.modelKey
            || (payload?.modelId
              ? buildModelKey({
                modelId: payload.modelId,
                connectionId: payload.connectionId ?? null,
                rawId: payload.rawId ?? null,
              })
              : null)
          if (modelKey && attemptIndex && delta) {
            appendNodeOutput(modelKey, attemptIndex, delta)
          }
        }

        if (event.type === 'attempt_complete') {
          const result = event.payload?.result as BattleResult | undefined
          if (result) {
            const modelKey = `${result.connectionId ?? 'global'}:${result.rawId ?? result.modelId}`
            const matched = models.find((m) => {
              if (result.connectionId != null && result.rawId) {
                return m.connectionId === result.connectionId && m.rawId === result.rawId
              }
              return m.id === result.modelId
            })
            const enriched = { ...result, modelLabel: result.modelLabel || matched?.name || result.modelId }
            setResults((prev) => [...prev, enriched])

            updateNodeState(modelKey, result.attemptIndex, {
              status: result.error ? 'error' : result.judgePass ? 'success' : 'error',
              durationMs: result.durationMs,
              output: result.output,
              error: result.error,
              judgePass: result.judgePass,
              judgeScore: result.judgeScore,
              judgeReason: result.judgeReason,
            })
          }
        }

        if (event.type === 'run_complete') {
          const nextSummary = event.payload?.summary as BattleRunSummary['summary'] | undefined
          if (nextSummary) {
            setSummary(nextSummary)
          }
          setRunStatus('completed')
        }

        if (event.type === 'error') {
          setError(event.error || '乱斗执行失败')
          setIsRunning(false)
          setRunStatus('error')
          return { success: false, error: event.error }
        }

        if (event.type === 'complete') {
          setIsRunning(false)
          setStep('result')
          setRunStatus((prev) => (prev === 'error' ? prev : 'completed'))
        }
      }

      return { success: true }
    } catch (err: any) {
      const message = err?.message || '乱斗执行失败'
      setError(message)
      setIsRunning(false)
      setRunStatus('error')
      return { success: false, error: message }
    } finally {
      setIsStreaming(false)
    }
  }, [validateAndBuildPayload, initializeNodeStates, updateNodeState, appendNodeOutput])

  // Cancel execution
  const cancelBattle = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setIsRunning(false)
    setStep('result')
  }, [])

  // Reset for new battle
  const resetBattle = useCallback(() => {
    setStep('config')
    setResults([])
    setSummary(null)
    setCurrentRunId(null)
    setIsRunning(false)
    setIsStreaming(false)
    setRunStatus(null)
    setError(null)
    setNodeStates(new Map())
  }, [])

  // Load existing run
  const loadRun = useCallback((detail: {
    prompt: string
    expectedAnswer: string
    judgeModelId: string
    judgeConnectionId?: number | null
    judgeRawId?: string | null
    judgeThreshold: number
    runsPerModel: number
    passK: number
    summary: BattleRunSummary['summary'] | null
    results: BattleResult[]
    id: number
    status: BattleRunSummary['status']
    config?: {
      models: Array<{ modelId: string; connectionId: number | null; rawId: string | null }>
    }
  }, catalog?: ModelItem[]) => {
    const configModels = Array.isArray(detail.config?.models)
      ? detail.config!.models.map((item) => ({
        modelId: item.modelId,
        connectionId: item.connectionId ?? null,
        rawId: item.rawId ?? null,
      }))
      : []
    const fallbackMap = new Map<string, BattleNodeModel>()
    for (const item of detail.results) {
      const key = `${item.modelId}:${item.connectionId ?? 'null'}:${item.rawId ?? 'null'}`
      if (fallbackMap.has(key)) continue
      fallbackMap.set(key, {
        modelId: item.modelId,
        connectionId: item.connectionId ?? null,
        rawId: item.rawId ?? null,
        label: item.modelLabel || null,
      })
    }
    const fallbackModels = Array.from(fallbackMap.values())
    setPrompt(detail.prompt)
    setExpectedAnswer(detail.expectedAnswer)
    const judgeRef = {
      modelId: detail.judgeModelId,
      connectionId: detail.judgeConnectionId ?? null,
      rawId: detail.judgeRawId ?? null,
    }
    const resolvedJudge = resolveModelFromCatalog(catalog, judgeRef) || buildPlaceholderModel(judgeRef)
    setJudgeConfig((prev) => ({
      ...prev,
      model: resolvedJudge || prev.model,
      threshold: detail.judgeThreshold,
      runsPerModel: detail.runsPerModel,
      passK: detail.passK,
    }))
    const selectionSources = configModels.length > 0 ? configModels : fallbackModels
    if (selectionSources.length > 0) {
      const deduped = new Map<string, ModelConfigState>()
      for (const item of selectionSources) {
        const model = resolveModelFromCatalog(catalog, item) || buildPlaceholderModel(item)
        const state = buildConfigState(model)
        if (!deduped.has(state.key)) {
          deduped.set(state.key, state)
        }
      }
      setSelectedModels(Array.from(deduped.values()))
    }
    setSummary(detail.summary)
    setResults(detail.results)
    setCurrentRunId(detail.id)
    setRunStatus(detail.status)
    setIsRunning(detail.status === 'running' || detail.status === 'pending')
    setIsStreaming(false)
    setError(null)
    setNodeStates(buildNodeStatesFromRun(
      configModels.length > 0 ? configModels : fallbackModels,
      detail.runsPerModel,
      detail.results,
      catalog,
    ))
    setStep(detail.status === 'running' || detail.status === 'pending' ? 'execution' : 'result')
  }, [])

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
  }, [])

  // Grouped results for display
  const groupedResults = useMemo(() => {
    const map = new Map<string, { key: string; label: string; attempts: BattleResult[] }>()
    for (const result of results) {
      const key = `${result.connectionId ?? 'global'}:${result.rawId ?? result.modelId}`
      const label = result.modelLabel || result.modelId
      const existing = map.get(key) || { key, label, attempts: [] }
      existing.attempts.push(result)
      map.set(key, existing)
    }
    const groups = Array.from(map.values())
    for (const group of groups) {
      group.attempts.sort((a, b) => a.attemptIndex - b.attemptIndex)
    }
    return groups
  }, [results])

  // Stats map for results
  const statsMap = useMemo(() => {
    const map = new Map<string, BattleRunSummary['summary']['modelStats'][number]>()
    if (!summary) return map
    const items = Array.isArray(summary.modelStats) ? summary.modelStats : []
    for (const item of items) {
      const key = `${item.connectionId ?? 'global'}:${item.rawId ?? item.modelId}`
      map.set(key, item)
    }
    return map
  }, [summary])

  return {
    // State
    step,
    selectedModels,
    judgeConfig,
    prompt,
    expectedAnswer,
    nodeStates,
    results,
    summary,
    currentRunId,
    isRunning,
    isStreaming,
    runStatus,
    error,
    groupedResults,
    statsMap,

    // Computed
    canProceedToPrompt,
    canStartBattle,

    // Actions
    setPrompt,
    setExpectedAnswer,
    setJudgeConfig,
    addModel,
    removeModel,
    updateModelConfig,
    goToStep,
    startBattle,
    cancelBattle,
    resetBattle,
    loadRun,
    reconcileSelectedModels,
  }
}

export type UseBattleFlowReturn = ReturnType<typeof useBattleFlow>
