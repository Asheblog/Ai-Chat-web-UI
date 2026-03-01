'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import type { ModelItem } from '@/store/models-store'
import { useSettingsStore } from '@/store/settings-store'
import type { BattleContent, BattleResult, BattleRunSummary, BattleToolCallEvent, BattleUploadImage, ToolEvent } from '@/types'
import {
  cancelBattleAttempt,
  cancelBattleRun,
  retryBattleAttempt,
  streamBattle,
  type BattleStreamPayload,
} from '../api'
import { buildModelKey, modelKeyFor, parseModelKey } from '../utils/model-key'

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
  extraPrompt: string
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
  reasoning?: string
  error?: string | null
  toolEvents?: ToolEvent[]
  judgeStatus?: BattleResult['judgeStatus']
  judgeError?: string | null
  judgePass?: boolean | null
  judgeScore?: number | null
  judgeReason?: string | null
}

export type LiveAttempt = {
  modelId: string
  modelLabel?: string | null
  connectionId?: number | null
  rawId?: string | null
  attemptIndex: number
  status: NodeStatus
  output?: string | null
  reasoning?: string | null
  durationMs?: number | null
  error?: string | null
  toolEvents?: BattleToolCallEvent[] | ToolEvent[] | null
}

export interface JudgeConfig {
  model: ModelItem | null
  threshold: number
  runsPerModel: number
  passK: number
  maxConcurrency: number
}

export type BattleDraftImage = {
  dataUrl: string
  mime: string
  size: number
}

export interface BattleFlowState {
  step: BattleStep
  selectedModels: ModelConfigState[]
  judgeConfig: JudgeConfig
  prompt: string
  expectedAnswer: string
  promptImages: BattleDraftImage[]
  expectedAnswerImages: BattleDraftImage[]
  promptImageUrls: string[]
  expectedAnswerImageUrls: string[]
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

const isVisionCapable = (model: ModelItem | null | undefined) => {
  return model?.capabilities?.vision === true
}

const hasBattleContent = (text: string, images: BattleDraftImage[]) => {
  return text.trim().length > 0 || images.length > 0
}

const toBattleUploadImages = (images: BattleDraftImage[]): BattleUploadImage[] => {
  return images
    .map((item) => {
      const data = typeof item.dataUrl === 'string' ? item.dataUrl.split(',')[1] || '' : ''
      const mime = typeof item.mime === 'string' ? item.mime.trim() : ''
      return { data, mime }
    })
    .filter((item) => item.data.length > 0 && item.mime.length > 0)
}

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

const isPlaceholderModel = (model: ModelItem) =>
  model.provider === 'unknown' || model.channelName === 'unknown' || model.connectionId === 0

export type BattleNodeModel = {
  modelId: string
  connectionId?: number | null
  rawId?: string | null
  label?: string | null
}

type ReasoningDefaults = {
  reasoningEnabled: boolean
  reasoningEffort: 'low' | 'medium' | 'high'
  ollamaThink: boolean
}

type BattleRunConfigModel = {
  modelId: string
  connectionId?: number | null
  rawId?: string | null
  skills?: {
    enabled: string[]
    overrides?: Record<string, Record<string, unknown>>
  }
  extraPrompt?: string | null
  customHeaders?: Array<{ name: string; value: string }>
  customBody?: Record<string, any> | null
  reasoningEnabled?: boolean | null
  reasoningEffort?: 'low' | 'medium' | 'high' | null
  ollamaThink?: boolean | null
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

const buildConfigState = (model: ModelItem, defaults?: ReasoningDefaults): ModelConfigState => ({
  key: modelKeyFor(model),
  model,
  webSearchEnabled: false,
  pythonEnabled: false,
  reasoningEnabled: defaults?.reasoningEnabled ?? false,
  reasoningEffort: defaults?.reasoningEffort ?? 'medium',
  ollamaThink: defaults?.ollamaThink ?? false,
  extraPrompt: '',
  customBody: '',
  customHeaders: [],
  customBodyError: null,
  advancedOpen: false,
})

const buildConfigStateFromConfig = (
  model: ModelItem,
  defaults: ReasoningDefaults,
  config?: BattleRunConfigModel,
): ModelConfigState => {
  const base = buildConfigState(model, defaults)
  const customHeaders = normalizeCustomHeaders(config?.customHeaders)
  const customBody = normalizeCustomBodyDraft(config?.customBody)
  const extraPrompt = typeof config?.extraPrompt === 'string' ? config.extraPrompt : ''
  const reasoningEnabled =
    typeof config?.reasoningEnabled === 'boolean' ? config.reasoningEnabled : base.reasoningEnabled
  const reasoningEffort = normalizeReasoningEffort(config?.reasoningEffort) || base.reasoningEffort
  const ollamaThink = typeof config?.ollamaThink === 'boolean' ? config.ollamaThink : base.ollamaThink
  const advancedOpen = customHeaders.length > 0 || customBody.trim().length > 0 || extraPrompt.trim().length > 0
  return {
    ...base,
    webSearchEnabled: Boolean(config?.skills?.enabled?.includes('web-search')),
    pythonEnabled: Boolean(config?.skills?.enabled?.includes('python-runner')),
    reasoningEnabled,
    reasoningEffort,
    ollamaThink,
    extraPrompt,
    customBody,
    customHeaders,
    advancedOpen,
  }
}

const normalizeReasoningEffort = (value: unknown): 'low' | 'medium' | 'high' | null => {
  if (value === 'low' || value === 'medium' || value === 'high') {
    return value
  }
  return null
}

const normalizeCustomHeaders = (headers?: Array<{ name?: string | null; value?: string | null }>) => {
  if (!Array.isArray(headers)) return []
  return headers
    .map((item) => ({
      name: String(item?.name || '').trim(),
      value: String(item?.value || '').trim(),
    }))
    .filter((item) => item.name.length > 0)
}

const normalizeCustomBodyDraft = (value: unknown) => {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return ''
    }
  }
  return ''
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

const normalizeBattleContent = (raw: unknown): BattleContent => {
  if (!raw || typeof raw !== 'object') {
    return { text: '', images: [] }
  }
  const payload = raw as { text?: unknown; images?: unknown }
  const text = typeof payload.text === 'string' ? payload.text : ''
  const images = Array.isArray(payload.images)
    ? payload.images
      .map((item) => String(item || '').trim())
      .filter((item) => item.length > 0)
    : []
  return { text, images }
}

const TOOL_CALL_PHASES = [
  'arguments_streaming',
  'pending_approval',
  'executing',
  'result',
  'error',
  'rejected',
  'aborted',
] as const

const TOOL_CALL_STATUSES = ['running', 'success', 'error', 'pending', 'rejected', 'aborted'] as const

const TOOL_CALL_SOURCES = ['builtin', 'plugin', 'mcp', 'workspace', 'system'] as const

const TOOL_CALL_STAGES = ['start', 'result', 'error'] as const

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null

const pickString = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed.length > 0) return trimmed
    }
  }
  return null
}

const asTimestamp = (value: unknown, fallback: number) => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return fallback
}

const normalizeToolCallSource = (value: unknown): ToolEvent['source'] => {
  if (typeof value === 'string' && TOOL_CALL_SOURCES.includes(value as (typeof TOOL_CALL_SOURCES)[number])) {
    return value as ToolEvent['source']
  }
  return undefined
}

const normalizeToolCallPhase = (
  phase: unknown,
  status: unknown,
  stage: unknown,
): ToolEvent['phase'] => {
  if (typeof phase === 'string' && TOOL_CALL_PHASES.includes(phase as (typeof TOOL_CALL_PHASES)[number])) {
    return phase as ToolEvent['phase']
  }
  if (status === 'pending') return 'pending_approval'
  if (status === 'success') return 'result'
  if (status === 'rejected') return 'rejected'
  if (status === 'aborted') return 'aborted'
  if (status === 'error') return 'error'
  if (status === 'running') return 'executing'
  if (stage === 'result') return 'result'
  if (stage === 'error') return 'error'
  if (stage === 'start') return 'executing'
  return undefined
}

const normalizeToolCallStatus = (
  status: unknown,
  phase: ToolEvent['phase'],
  stage: unknown,
): ToolEvent['status'] => {
  if (typeof status === 'string' && TOOL_CALL_STATUSES.includes(status as (typeof TOOL_CALL_STATUSES)[number])) {
    return status as ToolEvent['status']
  }
  if (phase === 'pending_approval') return 'pending'
  if (phase === 'result') return 'success'
  if (phase === 'rejected') return 'rejected'
  if (phase === 'aborted') return 'aborted'
  if (phase === 'error') return 'error'
  if (stage === 'result') return 'success'
  if (stage === 'error') return 'error'
  return 'running'
}

const normalizeToolCallStage = (
  stage: unknown,
  phase: ToolEvent['phase'],
): ToolEvent['stage'] => {
  if (typeof stage === 'string' && TOOL_CALL_STAGES.includes(stage as (typeof TOOL_CALL_STAGES)[number])) {
    return stage as ToolEvent['stage']
  }
  if (phase === 'result') return 'result'
  if (phase === 'error' || phase === 'rejected' || phase === 'aborted') return 'error'
  return 'start'
}

export const normalizeBattleToolEvent = (raw: unknown): ToolEvent | null => {
  const event = asRecord(raw)
  if (!event) return null

  const details = asRecord(event.details) || undefined
  const now = Date.now()
  const createdAt = asTimestamp(event.createdAt, now)
  const updatedAt = asTimestamp(event.updatedAt, createdAt)
  const phase = normalizeToolCallPhase(event.phase, event.status, event.stage)
  const status = normalizeToolCallStatus(event.status, phase, event.stage)
  const stage = normalizeToolCallStage(event.stage, phase)
  const id = pickString(event.id, event.callId) || `tool-${createdAt}`
  const callId = pickString(event.callId, event.id) || undefined
  const identifier = pickString(event.identifier, event.tool, event.apiName) || undefined
  const apiName = pickString(event.apiName, event.identifier, event.tool) || identifier
  const tool = pickString(event.tool, identifier, apiName) || 'tool'
  const source = normalizeToolCallSource(event.source)
  const query = pickString(event.query) || undefined
  const argumentsText = pickString(event.argumentsText, details?.argumentsText, details?.input, details?.code) || undefined
  const argumentsPatch = pickString(event.argumentsPatch, details?.argumentsPatch) || undefined
  const resultText = pickString(event.resultText, details?.resultText, details?.stdout, details?.excerpt) || undefined
  const error = pickString(event.error) || undefined
  const summary = pickString(event.summary) || undefined

  const normalized: ToolEvent = {
    id,
    sessionId: 0,
    messageId: 0,
    tool,
    stage,
    status,
    createdAt,
    updatedAt,
    ...(callId ? { callId } : {}),
    ...(source ? { source } : {}),
    ...(identifier ? { identifier } : {}),
    ...(apiName ? { apiName } : {}),
    ...(phase ? { phase } : {}),
    ...(query ? { query } : {}),
    ...(Array.isArray(event.hits) ? { hits: event.hits as ToolEvent['hits'] } : {}),
    ...(argumentsText ? { argumentsText } : {}),
    ...(argumentsPatch ? { argumentsPatch } : {}),
    ...(resultText ? { resultText } : {}),
    ...(typeof event.resultJson !== 'undefined' ? { resultJson: event.resultJson } : {}),
    ...(error ? { error } : {}),
    ...(summary ? { summary } : {}),
    ...(details ? { details: details as ToolEvent['details'] } : {}),
    ...(asRecord(event.intervention) ? { intervention: event.intervention as ToolEvent['intervention'] } : {}),
    ...(typeof event.thoughtSignature === 'string' || event.thoughtSignature === null
      ? { thoughtSignature: event.thoughtSignature as ToolEvent['thoughtSignature'] }
      : {}),
  }

  return normalized
}

const buildToolEventKey = (event: ToolEvent) => {
  const callId = pickString(event.callId)
  if (callId) return `call:${callId}`
  const id = pickString(event.id)
  if (id) return `id:${id}`
  return `fallback:${event.createdAt}`
}

const mergeToolEvent = (previous: ToolEvent, incoming: ToolEvent): ToolEvent => ({
  ...previous,
  ...incoming,
  id: incoming.id || previous.id,
  callId: incoming.callId || previous.callId,
  tool: incoming.tool || incoming.identifier || previous.tool,
  identifier: incoming.identifier || previous.identifier,
  apiName: incoming.apiName || previous.apiName,
  createdAt: Math.min(previous.createdAt, incoming.createdAt),
  updatedAt: Math.max(previous.updatedAt ?? previous.createdAt, incoming.updatedAt ?? incoming.createdAt),
  details:
    previous.details || incoming.details
      ? { ...(previous.details || {}), ...(incoming.details || {}) }
      : undefined,
})

const compareToolEvent = (a: ToolEvent, b: ToolEvent) => {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
  const aUpdated = a.updatedAt ?? a.createdAt
  const bUpdated = b.updatedAt ?? b.createdAt
  if (aUpdated !== bUpdated) return aUpdated - bUpdated
  return buildToolEventKey(a).localeCompare(buildToolEventKey(b))
}

export const normalizeBattleToolEventList = (events: unknown): ToolEvent[] => {
  if (!Array.isArray(events) || events.length === 0) return []
  const merged = new Map<string, ToolEvent>()
  let fallbackIndex = 0
  for (const item of events) {
    const normalized = normalizeBattleToolEvent(item)
    if (!normalized) continue
    const key = buildToolEventKey(normalized) || `fallback:${fallbackIndex++}`
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, normalized)
    } else {
      merged.set(key, mergeToolEvent(existing, normalized))
    }
  }
  return Array.from(merged.values()).sort(compareToolEvent)
}

export const appendBattleToolEvent = (timeline: ToolEvent[] | undefined, incoming: ToolEvent): ToolEvent[] => {
  const current = Array.isArray(timeline) ? timeline : []
  const key = buildToolEventKey(incoming)
  const index = current.findIndex((item) => buildToolEventKey(item) === key)
  if (index < 0) {
    return [...current, incoming].sort(compareToolEvent)
  }
  const next = [...current]
  next[index] = mergeToolEvent(next[index], incoming)
  next.sort(compareToolEvent)
  return next
}

export const buildNodeStatesFromRun = (
  models: BattleNodeModel[],
  runsPerModel: number,
  results: BattleResult[],
  catalog?: ModelItem[],
  liveAttempts?: LiveAttempt[],
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

  if (Array.isArray(liveAttempts)) {
    for (const live of liveAttempts) {
      const key = buildModelKey({
        modelId: live.modelId,
        connectionId: live.connectionId,
        rawId: live.rawId,
      })
      const label = live.modelLabel || resolveNodeLabel({
        modelId: live.modelId,
        connectionId: live.connectionId ?? null,
        rawId: live.rawId ?? null,
      }, catalog)
      let attempts = map.get(key)
      const requiredAttempts = Math.max(normalizedRuns, live.attemptIndex)
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
      const index = live.attemptIndex - 1
      if (index >= 0 && index < attempts.length) {
        const liveToolEvents = normalizeBattleToolEventList(live.toolEvents)
        attempts[index] = {
          ...attempts[index],
          status: live.status,
          durationMs: live.durationMs ?? null,
          output: live.output ?? attempts[index].output,
          reasoning: live.reasoning ?? attempts[index].reasoning,
          error: live.error ?? null,
          ...(liveToolEvents.length > 0 ? { toolEvents: liveToolEvents } : {}),
        }
      }
      map.set(key, attempts)
    }
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
        status: result.error
          ? 'error'
          : (result.judgeStatus === 'running'
            ? 'judging'
            : (result.judgeStatus === 'success' && result.judgePass === true)
              ? 'success'
              : 'error'),
        durationMs: result.durationMs,
        output: result.output,
        reasoning: attempts[index].reasoning,
        error: result.error,
        toolEvents: attempts[index].toolEvents,
        judgeStatus: result.judgeStatus,
        judgeError: result.judgeError,
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
  const [promptImages, setPromptImages] = useState<BattleDraftImage[]>([])
  const [expectedAnswerImages, setExpectedAnswerImages] = useState<BattleDraftImage[]>([])
  const [promptImageUrls, setPromptImageUrls] = useState<string[]>([])
  const [expectedAnswerImageUrls, setExpectedAnswerImageUrls] = useState<string[]>([])
  const [nodeStates, setNodeStates] = useState<Map<string, NodeState[]>>(new Map())
  const [results, setResults] = useState<BattleResult[]>([])
  const [summary, setSummary] = useState<BattleRunSummary['summary'] | null>(null)
  const [currentRunId, setCurrentRunId] = useState<number | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [runStatus, setRunStatus] = useState<BattleRunSummary['status'] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { systemSettings } = useSettingsStore((state) => ({
    systemSettings: state.systemSettings,
  }))

  const abortControllerRef = useRef<AbortController | null>(null)
  const cancelRequestedRef = useRef(false)

  const reasoningDefaults = useMemo<ReasoningDefaults>(() => {
    const enabled = Boolean(systemSettings?.reasoningEnabled ?? true)
    const effort = normalizeReasoningEffort(systemSettings?.openaiReasoningEffort) || 'medium'
    const ollamaThink = Boolean(systemSettings?.ollamaThink ?? false)
    return {
      reasoningEnabled: enabled,
      reasoningEffort: effort,
      ollamaThink,
    }
  }, [systemSettings?.reasoningEnabled, systemSettings?.openaiReasoningEffort, systemSettings?.ollamaThink])

  // Model selection handlers
  const addModel = useCallback((model: ModelItem) => {
    const key = modelKeyFor(model)
    setSelectedModels((prev) => {
      if (prev.length >= 8) return prev
      if (prev.some((item) => item.key === key)) return prev
      return [...prev, buildConfigState(model, reasoningDefaults)]
    })
  }, [reasoningDefaults])

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

  const appendNodeOutput = useCallback((
    modelKey: string,
    attemptIndex: number,
    delta?: string,
    reasoning?: string,
  ) => {
    if (!delta && !reasoning) return
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
          output: `${attempt.output || ''}${delta || ''}`,
          reasoning: `${attempt.reasoning || ''}${reasoning || ''}`,
        }
      })
      if (!updated) {
        const modelLabel = attempts[0]?.modelLabel || modelKey
        newAttempts.push({
          modelKey,
          modelLabel,
          status: 'running',
          attemptIndex,
          output: delta || '',
          reasoning: reasoning || '',
        })
      }
      newAttempts.sort((a, b) => a.attemptIndex - b.attemptIndex)
      next.set(modelKey, newAttempts)
      return next
    })
  }, [])

  const appendNodeToolEvent = useCallback((
    modelKey: string,
    attemptIndex: number,
    event: ToolEvent,
  ) => {
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
          toolEvents: appendBattleToolEvent(attempt.toolEvents, event),
        }
      })
      if (!updated) {
        const modelLabel = attempts[0]?.modelLabel || modelKey
        newAttempts.push({
          modelKey,
          modelLabel,
          status: 'running',
          attemptIndex,
          toolEvents: [event],
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
    const promptText = prompt.trim()
    const expectedAnswerText = expectedAnswer.trim()
    const promptHasImages = promptImages.length > 0
    const expectedAnswerHasImages = expectedAnswerImages.length > 0

    if (!hasBattleContent(prompt, promptImages)) {
      return { valid: false, error: '请输入问题或上传题目图片' }
    }
    if (!hasBattleContent(expectedAnswer, expectedAnswerImages)) {
      return { valid: false, error: '请输入期望答案或上传答案图片' }
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

    if (promptHasImages) {
      if (!isVisionCapable(judgeConfig.model)) {
        return { valid: false, error: '题目包含图片时，裁判模型必须支持 Vision' }
      }
      const unsupportedContestants = selectedModels
        .filter((item) => !isVisionCapable(item.model))
        .map((item) => item.model.name || item.model.id)
      if (unsupportedContestants.length > 0) {
        return {
          valid: false,
          error: `题目包含图片时，以下参赛模型不支持 Vision：${unsupportedContestants.join('、')}`,
        }
      }
    } else if (expectedAnswerHasImages && !isVisionCapable(judgeConfig.model)) {
      return { valid: false, error: '答案包含图片时，裁判模型必须支持 Vision' }
    }

    const modelPayloads: BattleStreamPayload['models'] = []
    let hasError = false
    const updatedConfigs: ModelConfigState[] = []

    for (const item of selectedModels) {
      const bodyResult = parseCustomBody(item.customBody)
      const headerResult = sanitizeHeaders(item.customHeaders)
      const extraPrompt = item.extraPrompt.trim()

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

      const enabledSkills: string[] = []
      if (item.webSearchEnabled) enabledSkills.push('web-search', 'url-reader')
      if (item.pythonEnabled) enabledSkills.push('python-runner')

      modelPayloads.push({
        modelId: item.model.id,
        connectionId: item.model.connectionId,
        rawId: item.model.rawId,
        skills: {
          enabled: Array.from(new Set(enabledSkills)),
        },
        ...(extraPrompt ? { extraPrompt } : {}),
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

    const promptPayload: BattleStreamPayload['prompt'] = {}
    if (promptText) {
      promptPayload.text = promptText
    }
    const promptUploadImages = toBattleUploadImages(promptImages)
    if (promptUploadImages.length > 0) {
      promptPayload.images = promptUploadImages
    }

    const expectedAnswerPayload: BattleStreamPayload['expectedAnswer'] = {}
    if (expectedAnswerText) {
      expectedAnswerPayload.text = expectedAnswerText
    }
    const expectedAnswerUploadImages = toBattleUploadImages(expectedAnswerImages)
    if (expectedAnswerUploadImages.length > 0) {
      expectedAnswerPayload.images = expectedAnswerUploadImages
    }

    const payload: BattleStreamPayload = {
      prompt: promptPayload,
      expectedAnswer: expectedAnswerPayload,
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
  }, [prompt, promptImages, expectedAnswer, expectedAnswerImages, judgeConfig, selectedModels])

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
    setPromptImageUrls(promptImages.map((item) => item.dataUrl))
    setExpectedAnswerImageUrls(expectedAnswerImages.map((item) => item.dataUrl))
    initializeNodeStates()
    setStep('execution')

    try {
      for await (const event of streamBattle(validation.payload, { signal: controller.signal })) {
        if (event.type === 'run_start') {
          const id = Number(event.payload?.id)
          const nextPrompt = normalizeBattleContent(event.payload?.prompt)
          const nextExpectedAnswer = normalizeBattleContent(event.payload?.expectedAnswer)
          if (nextPrompt.text || nextPrompt.images.length > 0) {
            setPrompt(nextPrompt.text)
            setPromptImageUrls(nextPrompt.images)
          }
          if (nextExpectedAnswer.text || nextExpectedAnswer.images.length > 0) {
            setExpectedAnswer(nextExpectedAnswer.text)
            setExpectedAnswerImageUrls(nextExpectedAnswer.images)
          }
          if (Number.isFinite(id)) {
            setCurrentRunId(id)
            if (cancelRequestedRef.current) {
              void cancelBattleRun(id)
            }
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
            reasoning?: string
          } | undefined
          const attemptIndex = payload?.attemptIndex
          const delta = typeof payload?.delta === 'string' ? payload.delta : ''
          const reasoning = typeof payload?.reasoning === 'string' ? payload.reasoning : ''
          const modelKey = payload?.modelKey
            || (payload?.modelId
              ? buildModelKey({
                modelId: payload.modelId,
                connectionId: payload.connectionId ?? null,
                rawId: payload.rawId ?? null,
              })
              : null)
          if (modelKey && attemptIndex && (delta || reasoning)) {
            appendNodeOutput(modelKey, attemptIndex, delta, reasoning)
          }
        }

        if (event.type === 'attempt_tool_call') {
          const payload = event.payload as {
            modelKey?: string
            modelId?: string
            connectionId?: number | null
            rawId?: string | null
            attemptIndex?: number
            event?: unknown
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
          const toolEvent = normalizeBattleToolEvent(payload?.event)
          if (modelKey && attemptIndex && toolEvent) {
            appendNodeToolEvent(modelKey, attemptIndex, toolEvent)
          }
        }

        if (event.type === 'attempt_complete') {
          const result = event.payload?.result as BattleResult | undefined
          if (result) {
            const modelKey = buildModelKey({
              modelId: result.modelId,
              connectionId: result.connectionId,
              rawId: result.rawId,
            })
            const matched = models.find((m) => {
              if (result.connectionId != null && result.rawId) {
                return m.connectionId === result.connectionId && m.rawId === result.rawId
              }
              return m.id === result.modelId
            })
            const enriched = { ...result, modelLabel: result.modelLabel || matched?.name || result.modelId }
            setResults((prev) => {
              const next = prev.filter((item) => {
                const key = buildModelKey({
                  modelId: item.modelId,
                  connectionId: item.connectionId,
                  rawId: item.rawId,
                })
                return !(key === modelKey && item.attemptIndex === result.attemptIndex)
              })
              next.push(enriched)
              return next
            })

            updateNodeState(modelKey, result.attemptIndex, {
              status: result.error
                ? 'error'
                : (result.judgeStatus === 'running'
                  ? 'judging'
                  : (result.judgeStatus === 'success' && result.judgePass === true)
                    ? 'success'
                    : 'error'),
              durationMs: result.durationMs,
              output: result.output,
              error: result.error,
              judgeStatus: result.judgeStatus,
              judgeError: result.judgeError,
              judgePass: result.judgePass,
              judgeScore: result.judgeScore,
              judgeReason: result.judgeReason,
            })
          }
        }

        if (event.type === 'skill_approval_request' || event.type === 'skill_approval_result') {
          if (typeof window !== 'undefined') {
            const payload =
              event.payload && typeof event.payload === 'object'
                ? (event.payload as Record<string, unknown>)
                : {}
            try {
              window.dispatchEvent(
                new CustomEvent('aichat:skill-approval', {
                  detail: {
                    type: event.type,
                    ...payload,
                  },
                }),
              )
            } catch {
              // ignore UI dispatch errors
            }
          }
        }

        if (event.type === 'run_complete') {
          const nextSummary = event.payload?.summary as BattleRunSummary['summary'] | undefined
          if (nextSummary) {
            setSummary(nextSummary)
          }
          setRunStatus('completed')
        }

        if (event.type === 'run_cancelled') {
          const nextSummary = event.payload?.summary as BattleRunSummary['summary'] | undefined
          if (nextSummary) {
            setSummary(nextSummary)
          }
          setIsRunning(false)
          setStep('result')
          setRunStatus('cancelled')
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
          setRunStatus((prev) => (prev === 'error' || prev === 'cancelled' ? prev : 'completed'))
        }
      }

      return { success: true }
    } catch (err: any) {
      if (controller.signal.aborted) {
        setIsRunning(false)
        setStep('result')
        setRunStatus('cancelled')
        return { success: false }
      }
      const message = err?.message || '乱斗执行失败'
      setError(message)
      setIsRunning(false)
      setRunStatus('error')
      return { success: false, error: message }
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
    cancelBattleRun,
    promptImages,
    expectedAnswerImages,
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
  }, [currentRunId, cancelBattleRun])

  const buildAttemptPayload = useCallback((modelKey: string, attemptIndex: number) => {
    const parsed = parseModelKey(modelKey)
    if (!parsed) return null
    return {
      attemptIndex,
      modelId: parsed.type === 'global' ? parsed.modelId : undefined,
      connectionId: parsed.type === 'connection' ? parsed.connectionId : undefined,
      rawId: parsed.type === 'connection' ? parsed.rawId : undefined,
    }
  }, [])

  const cancelAttempt = useCallback(async (params: { modelKey: string; attemptIndex: number }) => {
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
  }, [buildAttemptPayload, cancelBattleAttempt, currentRunId, updateNodeState])

  const retryAttempt = useCallback(async (params: { modelKey: string; attemptIndex: number }) => {
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
  }, [buildAttemptPayload, currentRunId, retryBattleAttempt, updateNodeState])

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
  }, [])

  // Load existing run
  const loadRun = useCallback((detail: {
    prompt: BattleContent
    expectedAnswer: BattleContent
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
      models: Array<{
        modelId: string
        connectionId: number | null
        rawId: string | null
        skills?: {
          enabled: string[]
          overrides?: Record<string, Record<string, unknown>>
        }
        customHeaders?: Array<{ name: string; value: string }>
        customBody?: Record<string, any> | null
        extraPrompt?: string | null
        reasoningEnabled?: boolean | null
        reasoningEffort?: 'low' | 'medium' | 'high' | null
        ollamaThink?: boolean | null
      }>
    }
    live?: {
      attempts: LiveAttempt[]
    }
  }, catalog?: ModelItem[]) => {
    const configModels: BattleRunConfigModel[] = Array.isArray(detail.config?.models)
      ? detail.config!.models.map((item) => ({
        modelId: item.modelId,
        connectionId: item.connectionId ?? null,
        rawId: item.rawId ?? null,
        skills: item.skills,
        extraPrompt: item.extraPrompt ?? null,
        customHeaders: item.customHeaders,
        customBody: item.customBody ?? null,
        reasoningEnabled: item.reasoningEnabled ?? null,
        reasoningEffort: item.reasoningEffort ?? null,
        ollamaThink: item.ollamaThink ?? null,
      }))
      : []
    const configMap = new Map<string, BattleRunConfigModel>()
    for (const item of configModels) {
      const key = buildModelKey({
        modelId: item.modelId,
        connectionId: item.connectionId ?? null,
        rawId: item.rawId ?? null,
      })
      configMap.set(key, item)
    }
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
    setPrompt(detail.prompt.text || '')
    setExpectedAnswer(detail.expectedAnswer.text || '')
    setPromptImages([])
    setExpectedAnswerImages([])
    setPromptImageUrls(Array.isArray(detail.prompt.images) ? detail.prompt.images : [])
    setExpectedAnswerImageUrls(Array.isArray(detail.expectedAnswer.images) ? detail.expectedAnswer.images : [])
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
        const key = buildModelKey({
          modelId: item.modelId,
          connectionId: item.connectionId ?? null,
          rawId: item.rawId ?? null,
        })
        const config = configMap.get(key)
        const state = buildConfigStateFromConfig(model, reasoningDefaults, config)
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
      configModels.length > 0
        ? configModels.map((item) => ({
          modelId: item.modelId,
          connectionId: item.connectionId ?? null,
          rawId: item.rawId ?? null,
        }))
        : fallbackModels,
      detail.runsPerModel,
      detail.results,
      catalog,
      detail.live?.attempts,
    ))
    setStep(detail.status === 'running' || detail.status === 'pending' ? 'execution' : 'result')
  }, [reasoningDefaults])

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
      const key = buildModelKey({
        modelId: result.modelId,
        connectionId: result.connectionId,
        rawId: result.rawId,
      })
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
      const key = buildModelKey({
        modelId: item.modelId,
        connectionId: item.connectionId,
        rawId: item.rawId,
      })
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
    promptImages,
    expectedAnswerImages,
    promptImageUrls,
    expectedAnswerImageUrls,
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
    setPromptImages,
    setExpectedAnswerImages,
    setJudgeConfig,
    addModel,
    removeModel,
    updateModelConfig,
    goToStep,
    startBattle,
    cancelBattle,
    cancelAttempt,
    retryAttempt,
    resetBattle,
    loadRun,
    reconcileSelectedModels,
  }
}

export type UseBattleFlowReturn = ReturnType<typeof useBattleFlow>
