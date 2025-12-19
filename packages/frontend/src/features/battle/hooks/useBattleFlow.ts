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
    const newNodeStates = new Map<string, NodeState[]>()
    for (const modelConfig of selectedModels) {
      const attempts: NodeState[] = []
      for (let i = 1; i <= judgeConfig.runsPerModel; i++) {
        attempts.push({
          modelKey: modelConfig.key,
          modelLabel: modelConfig.model.name,
          status: 'pending',
          attemptIndex: i,
        })
      }
      newNodeStates.set(modelConfig.key, attempts)
    }
    setNodeStates(newNodeStates)
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
          const payload = event.payload as { modelKey?: string; attemptIndex?: number } | undefined
          if (payload?.modelKey && payload?.attemptIndex) {
            updateNodeState(payload.modelKey, payload.attemptIndex, { status: 'running' })
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
        }

        if (event.type === 'error') {
          setError(event.error || '乱斗执行失败')
          setIsRunning(false)
          return { success: false, error: event.error }
        }

        if (event.type === 'complete') {
          setIsRunning(false)
          setStep('result')
        }
      }

      return { success: true }
    } catch (err: any) {
      const message = err?.message || '乱斗执行失败'
      setError(message)
      setIsRunning(false)
      return { success: false, error: message }
    }
  }, [validateAndBuildPayload, initializeNodeStates, updateNodeState])

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
    setError(null)
    setNodeStates(new Map())
  }, [])

  // Load existing run
  const loadRun = useCallback((detail: {
    prompt: string
    expectedAnswer: string
    judgeThreshold: number
    runsPerModel: number
    passK: number
    summary: BattleRunSummary['summary'] | null
    results: BattleResult[]
    id: number
  }) => {
    setPrompt(detail.prompt)
    setExpectedAnswer(detail.expectedAnswer)
    setJudgeConfig((prev) => ({
      ...prev,
      threshold: detail.judgeThreshold,
      runsPerModel: detail.runsPerModel,
      passK: detail.passK,
    }))
    setSummary(detail.summary)
    setResults(detail.results)
    setCurrentRunId(detail.id)
    setStep('result')
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
  }
}

export type UseBattleFlowReturn = ReturnType<typeof useBattleFlow>
