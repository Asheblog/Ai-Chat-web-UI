/**
 * Battle 领域纯函数归一化器。
 *
 * 从 battle-service.ts（原 ~4031 行）中提取的纯函数辅助层：
 * 配置载荷归一化、标题/标签构造、ToolEvent 归一化与合并排序。
 * 全部为无副作用函数，便于独立测试与复用。
 */
import type {
  BattleMode,
  BattleContentInput,
  BattleRunStatus,
  BattleToolCallEvent,
} from '@aichat/shared/battle-contract'
import type {
  BattleModelSkills,
  BattleRunConfigModel,
  BattleRunQuestionConfig,
} from './battle-types'
import { safeParseJson } from './battle-serialization'
import { normalizeToolCallEventPayload } from '../../modules/chat/tool-call-event'

export const toISOStringSafe = (value: Date | string | null | undefined) => {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

export const sanitizeHeaders = (headers?: Array<{ name: string; value: string }>) => {
  if (!Array.isArray(headers)) return []
  return headers
    .map((item) => ({ name: (item?.name || '').trim() }))
    .filter((item) => item.name.length > 0)
}

export const summarizeCustomBody = (body?: Record<string, any>) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { keys: [] as string[] }
  }
  const keys = Object.keys(body).slice(0, 20)
  return { keys }
}

export const normalizeCustomHeadersForConfig = (headers?: Array<{ name: string; value: string }>) => {
  if (!Array.isArray(headers)) return []
  return headers
    .map((item) => ({
      name: (item?.name || '').trim(),
      value: (item?.value || '').trim(),
    }))
    .filter((item) => item.name.length > 0)
    .slice(0, 10)
}

export const normalizeCustomBodyForConfig = (body?: Record<string, any> | null) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return null
  }
  const keys = Object.keys(body)
  if (keys.length === 1 && keys[0] === 'keys' && Array.isArray((body as any).keys)) {
    return null
  }
  return body
}

export const normalizeConfigSkills = (raw: unknown): BattleModelSkills | undefined => {
  if (!raw || typeof raw !== 'object') return undefined
  const data = raw as Record<string, any>

  const builtinFromPayload = Array.isArray(data.builtin)
    ? data.builtin
        .map((item) => (typeof item === 'string' ? item.trim().toLowerCase() : ''))
        .filter((item) => item.length > 0)
    : []

  const enabled = Array.isArray(data.enabled)
    ? data.enabled
        .map((item): { skillId: number; versionId: number; overrides?: Record<string, unknown> } | null => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return null
          const skillId = Number(item.skillId)
          const versionId = Number(item.versionId)
          if (!Number.isInteger(skillId) || skillId <= 0) return null
          if (!Number.isInteger(versionId) || versionId <= 0) return null
          const overrides =
            item.overrides && typeof item.overrides === 'object' && !Array.isArray(item.overrides)
              ? (item.overrides as Record<string, unknown>)
              : undefined
          return { skillId, versionId, ...(overrides ? { overrides } : {}) }
        })
        .filter((item): item is { skillId: number; versionId: number; overrides?: Record<string, unknown> } => Boolean(item))
    : []

  const overrides =
    data.overrides && typeof data.overrides === 'object' && !Array.isArray(data.overrides)
      ? (data.overrides as Record<string, Record<string, unknown>>)
      : undefined

  const builtin = Array.from(new Set(builtinFromPayload))
  const enabledMap = new Map<string, { skillId: number; versionId: number; overrides?: Record<string, unknown> }>()
  for (const item of enabled) {
    enabledMap.set(`${item.skillId}:${item.versionId}`, item)
  }

  if (builtin.length === 0 && enabledMap.size === 0 && !overrides) return undefined
  return {
    ...(builtin.length > 0 ? { builtin } : {}),
    ...(enabledMap.size > 0 ? { enabled: Array.from(enabledMap.values()) } : {}),
    ...(overrides ? { overrides } : {}),
  }
}

export const normalizeReasoningEffort = (value: unknown): 'low' | 'medium' | 'high' | 'max' | 'xhigh' | null => {
  if (value === 'low' || value === 'medium' || value === 'high' || value === 'max' || value === 'xhigh') {
    return value
  }
  return null
}

export const normalizeConfigModels = (raw: unknown): BattleRunConfigModel[] => {
  const data = raw && typeof raw === 'object' ? (raw as Record<string, any>) : {}
  const rawModels = Array.isArray(data.models) ? data.models : []
  return rawModels
    .map((item): BattleRunConfigModel | null => {
      if (!item || typeof item !== 'object') return null
      const model = item as Record<string, any>
      const modelId = typeof model.modelId === 'string' ? model.modelId.trim() : ''
      if (!modelId) return null
      const skills = normalizeConfigSkills(model.skills ?? model.features)
      const customHeaders = normalizeCustomHeadersForConfig(
        Array.isArray(model.customHeaders)
          ? model.customHeaders
          : model.custom_headers,
      )
      const customBody = normalizeCustomBodyForConfig(
        (model.customBody ?? model.custom_body) as
          | Record<string, any>
          | null
          | undefined,
      )
      const extraPromptRaw = model.extraPrompt
      const extraPrompt = typeof extraPromptRaw === 'string' ? extraPromptRaw.trim() : ''
      const reasoningEnabled =
        typeof model.reasoningEnabled === 'boolean'
          ? model.reasoningEnabled
          : null
      const reasoningEffort = normalizeReasoningEffort(model.reasoningEffort)
      const ollamaThink =
        typeof model.ollamaThink === 'boolean'
          ? model.ollamaThink
          : null
      return {
        modelId,
        connectionId: isFiniteNumber(model.connectionId) ? model.connectionId : null,
        rawId: typeof model.rawId === 'string' && model.rawId.trim().length > 0 ? model.rawId.trim() : null,
        ...(skills ? { skills } : {}),
        ...(extraPrompt ? { extraPrompt } : {}),
        ...(customHeaders.length > 0 ? { customHeaders } : {}),
        ...(customBody ? { customBody } : {}),
        reasoningEnabled,
        reasoningEffort,
        ollamaThink,
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
}

export const normalizeConfigModel = (raw: unknown): BattleRunConfigModel | null => {
  if (!raw || typeof raw !== 'object') return null
  const model = raw as Record<string, any>
  const modelId = typeof model.modelId === 'string' ? model.modelId.trim() : ''
  if (!modelId) return null
  const skills = normalizeConfigSkills(model.skills ?? model.features)
  const customHeaders = normalizeCustomHeadersForConfig(
    Array.isArray(model.customHeaders) ? model.customHeaders : model.custom_headers,
  )
  const customBody = normalizeCustomBodyForConfig(
    (model.customBody ?? model.custom_body) as
      | Record<string, any>
      | null
      | undefined,
  )
  const extraPromptRaw = model.extraPrompt
  const extraPrompt = typeof extraPromptRaw === 'string' ? extraPromptRaw.trim() : ''
  const reasoningEnabled =
    typeof model.reasoningEnabled === 'boolean'
      ? model.reasoningEnabled
      : null
  const reasoningEffort = normalizeReasoningEffort(model.reasoningEffort)
  const ollamaThink =
    typeof model.ollamaThink === 'boolean'
      ? model.ollamaThink
      : null
  return {
    modelId,
    connectionId: isFiniteNumber(model.connectionId) ? model.connectionId : null,
    rawId: typeof model.rawId === 'string' && model.rawId.trim().length > 0 ? model.rawId.trim() : null,
    ...(skills ? { skills } : {}),
    ...(extraPrompt ? { extraPrompt } : {}),
    ...(customHeaders.length > 0 ? { customHeaders } : {}),
    ...(customBody ? { customBody } : {}),
    reasoningEnabled,
    reasoningEffort,
    ollamaThink,
  }
}

export const normalizeQuestionConfig = (raw: unknown): BattleRunQuestionConfig | null => {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, any>
  const questionIndex = isFiniteNumber(item.questionIndex) ? Math.max(1, Math.floor(item.questionIndex)) : null
  const prompt = item.prompt && typeof item.prompt === 'object'
    ? {
      text: normalizeBattleText((item.prompt as Record<string, unknown>).text),
      images: Array.isArray((item.prompt as Record<string, unknown>).images)
        ? ((item.prompt as Record<string, unknown>).images as unknown[]).map((entry) => String(entry || '').trim()).filter(Boolean)
        : [],
    }
    : { text: '', images: [] }
  const expectedAnswer = item.expectedAnswer && typeof item.expectedAnswer === 'object'
    ? {
      text: normalizeBattleText((item.expectedAnswer as Record<string, unknown>).text),
      images: Array.isArray((item.expectedAnswer as Record<string, unknown>).images)
        ? ((item.expectedAnswer as Record<string, unknown>).images as unknown[]).map((entry) => String(entry || '').trim()).filter(Boolean)
        : [],
    }
    : { text: '', images: [] }
  if (!questionIndex) return null
  return {
    questionIndex,
    questionId: typeof item.questionId === 'string' && item.questionId.trim() ? item.questionId.trim() : null,
    title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : null,
    prompt,
    expectedAnswer,
    runsPerQuestion: isFiniteNumber(item.runsPerQuestion) ? Math.max(1, Math.floor(item.runsPerQuestion)) : 1,
    passK: isFiniteNumber(item.passK) ? Math.max(1, Math.floor(item.passK)) : 1,
  }
}

export const normalizeConfigQuestions = (raw: unknown): BattleRunQuestionConfig[] => {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => normalizeQuestionConfig(item))
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => a.questionIndex - b.questionIndex)
}

export const parseRunConfigPayload = (raw: string | null | undefined) =>
  safeParseJson<Record<string, any>>(raw || '{}', {})

type LabelConnection = {
  id: number
  prefixId: string | null
}

export const buildRunTitle = (prompt: string, explicit?: string) => {
  const trimmed = (explicit || '').trim()
  if (trimmed) return trimmed
  const base = (prompt || '').trim()
  if (!base) return '模型大乱斗'
  return base.length > 30 ? `${base.slice(0, 30)}…` : base
}

export const composeModelLabel = (
  connection: Pick<LabelConnection, 'prefixId'> | null,
  rawId?: string | null,
  fallback?: string | null,
) => {
  const raw = (rawId || '').trim()
  const prefix = (connection?.prefixId || '').trim()
  if (raw && prefix) return `${prefix}.${raw}`
  if (raw) return raw
  return fallback || null
}

export const normalizeRunStatus = (value: string | null | undefined): BattleRunStatus => {
  if (value === 'pending' || value === 'running' || value === 'completed' || value === 'error' || value === 'cancelled') {
    return value
  }
  return 'error'
}

export const normalizeBattleMode = (value: unknown): BattleMode => {
  if (value === 'single_model_multi_question') return 'single_model_multi_question'
  return 'multi_model'
}

export const buildModelKey = (modelId: string, connectionId?: number | null, rawId?: string | null) => {
  if (typeof connectionId === 'number' && rawId) {
    return `${connectionId}:${rawId}`
  }
  return `global:${modelId}`
}

export const buildAttemptKey = (modelKey: string, questionIndex: number, attemptIndex: number) =>
  `${modelKey}#q${questionIndex}#${attemptIndex}`

export const parseImagePathsJson = (raw: string | null | undefined) => {
  const parsed = safeParseJson<unknown>(raw || '[]', [])
  if (!Array.isArray(parsed)) return []
  return parsed
    .map((item) => String(item || '').trim())
    .filter((item) => item.length > 0)
}

export const normalizeBattleText = (raw: unknown) => (typeof raw === 'string' ? raw.trim() : '')

export const isBattleContentEmpty = (content: BattleContentInput) => {
  const text = normalizeBattleText(content.text)
  const hasImages = Array.isArray(content.images) && content.images.length > 0
  return !text && !hasImages
}

const TOOL_EVENT_STATUS_VALUES = new Set([
  'running',
  'success',
  'error',
  'pending',
  'rejected',
  'aborted',
])

const TOOL_EVENT_PHASE_VALUES = new Set([
  'arguments_streaming',
  'pending_approval',
  'executing',
  'result',
  'error',
  'rejected',
  'aborted',
])

const TOOL_EVENT_SOURCE_VALUES = new Set(['builtin', 'plugin', 'mcp', 'workspace', 'system'])

const TOOL_EVENT_STAGE_VALUES = new Set(['start', 'result', 'error'])

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

export const pickString = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed.length > 0) return trimmed
    }
  }
  return null
}

export const toTimestamp = (value: unknown, fallback: number) => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return fallback
}

export const normalizeBattleToolCallEvent = (payload: Record<string, unknown>): BattleToolCallEvent | null => {
  const normalized = normalizeToolCallEventPayload(payload)
  const details = asRecord(normalized.details) || undefined
  const now = Date.now()
  const createdAt = toTimestamp(normalized.createdAt, now)
  const updatedAt = toTimestamp(normalized.updatedAt, createdAt)

  const callId = pickString(normalized.callId, normalized.id)
  const id = pickString(normalized.id, normalized.callId) || `tool-${createdAt}`
  if (!id) return null

  const status = TOOL_EVENT_STATUS_VALUES.has(String(normalized.status))
    ? (normalized.status as BattleToolCallEvent['status'])
    : 'running'
  const phase = TOOL_EVENT_PHASE_VALUES.has(String(normalized.phase))
    ? (normalized.phase as BattleToolCallEvent['phase'])
    : undefined
  const source = TOOL_EVENT_SOURCE_VALUES.has(String(normalized.source))
    ? (normalized.source as BattleToolCallEvent['source'])
    : undefined
  const stage = TOOL_EVENT_STAGE_VALUES.has(String(normalized.stage))
    ? (normalized.stage as BattleToolCallEvent['stage'])
    : undefined
  const identifier = pickString(normalized.identifier, normalized.tool) || undefined
  const apiName = pickString(normalized.apiName, normalized.identifier, normalized.tool) || undefined
  const tool = pickString(normalized.tool, normalized.identifier) || undefined
  const query = pickString(normalized.query) || undefined
  const argumentsText = pickString(normalized.argumentsText, details?.argumentsText, details?.input, details?.code) || undefined
  const argumentsPatch = pickString(normalized.argumentsPatch, details?.argumentsPatch) || undefined
  const resultText = pickString(normalized.resultText, details?.resultText, details?.stdout, details?.excerpt) || undefined
  const error = pickString(normalized.error) || undefined
  const summary = pickString(normalized.summary) || undefined

  const event: BattleToolCallEvent = {
    id,
    status,
    createdAt,
    updatedAt,
    ...(callId ? { callId } : {}),
    ...(source ? { source } : {}),
    ...(stage ? { stage } : {}),
    ...(phase ? { phase } : {}),
    ...(identifier ? { identifier } : {}),
    ...(apiName ? { apiName } : {}),
    ...(tool ? { tool } : {}),
    ...(query ? { query } : {}),
    ...(Array.isArray(normalized.hits) ? { hits: normalized.hits as BattleToolCallEvent['hits'] } : {}),
    ...(argumentsText ? { argumentsText } : {}),
    ...(argumentsPatch ? { argumentsPatch } : {}),
    ...(resultText ? { resultText } : {}),
    ...(typeof normalized.resultJson !== 'undefined' ? { resultJson: normalized.resultJson } : {}),
    ...(error ? { error } : {}),
    ...(summary ? { summary } : {}),
    ...(details ? { details: details as BattleToolCallEvent['details'] } : {}),
    ...(asRecord(normalized.intervention)
      ? { intervention: normalized.intervention as BattleToolCallEvent['intervention'] }
      : {}),
    ...(typeof normalized.thoughtSignature === 'string' || normalized.thoughtSignature === null
      ? { thoughtSignature: normalized.thoughtSignature as string | null }
      : {}),
  }

  return event
}

export const buildToolEventKey = (event: BattleToolCallEvent) => {
  const callId = pickString(event.callId)
  if (callId) return `call:${callId}`
  const id = pickString(event.id)
  if (id) return `id:${id}`
  return `fallback:${event.createdAt}`
}

export const mergeToolEvent = (
  previous: BattleToolCallEvent,
  incoming: BattleToolCallEvent,
): BattleToolCallEvent => ({
  ...previous,
  ...incoming,
  id: incoming.id || previous.id,
  callId: incoming.callId || previous.callId,
  createdAt: Math.min(previous.createdAt, incoming.createdAt),
  updatedAt: Math.max(previous.updatedAt ?? previous.createdAt, incoming.updatedAt ?? incoming.createdAt),
  details:
    previous.details || incoming.details
      ? { ...(previous.details || {}), ...(incoming.details || {}) }
      : undefined,
})

export const compareToolEvents = (a: BattleToolCallEvent, b: BattleToolCallEvent) => {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
  const aUpdated = a.updatedAt ?? a.createdAt
  const bUpdated = b.updatedAt ?? b.createdAt
  if (aUpdated !== bUpdated) return aUpdated - bUpdated
  return buildToolEventKey(a).localeCompare(buildToolEventKey(b))
}
