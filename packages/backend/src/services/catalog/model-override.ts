import { parseCapabilityEnvelope, serializeCapabilityEnvelope } from '../../utils/capabilities'

/**
 * 模型覆写的字段归属：能力 / 生成参数 / 访问策略各自独立。
 *
 * 旧实现用一个 `manualOverride` 布尔承载全部覆写，任一保存都会冻结能力自动刷新，
 * 且"重置"按行删除会连带清掉访问策略与温度。这里改为按字段判定与清除：
 * - 能力覆写：capabilitiesJson 的 envelope.source === 'manual'（兼容旧裸 flags 行）
 * - 参数覆写：metaJson 里的 custom_context_window / custom_max_output_tokens / temperature
 * - 访问覆写：metaJson.access_policy
 *
 * 检测得到的 context_window / max_output_tokens 与手写值分键存放，刷新只改检测键。
 */

export type ModelOverrideField = 'capabilities' | 'parameters' | 'access'

export interface ModelOverrideRow {
  capabilitiesJson?: string | null
  metaJson?: string | null
  manualOverride?: boolean | null
}

export interface ModelOverrideState {
  capabilities: boolean
  parameters: boolean
  access: boolean
  any: boolean
}

export const MANUAL_CONTEXT_WINDOW_KEY = 'custom_context_window'
export const MANUAL_MAX_OUTPUT_TOKENS_KEY = 'custom_max_output_tokens'
export const MANUAL_TEMPERATURE_KEY = 'temperature'
export const ACCESS_POLICY_KEY = 'access_policy'

const parseRecord = (raw: string | null | undefined): Record<string, any> => {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

const positiveInt = (value: unknown): number | null => {
  const numeric = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  return Math.floor(numeric)
}

export const parseModelMeta = (raw: string | null | undefined): Record<string, any> => parseRecord(raw)

const hasManualCapabilities = (row: ModelOverrideRow): boolean => {
  const envelope = parseCapabilityEnvelope(row.capabilitiesJson)
  if (!envelope) return false
  if (envelope.source === 'manual') return true
  // 旧行把裸 flags 直接写进 capabilitiesJson 且置 manualOverride；只在该组合下视为人工覆写。
  if (envelope.source) return false
  return Boolean(row.manualOverride)
}

export const readModelOverrideState = (row: ModelOverrideRow): ModelOverrideState => {
  const meta = parseRecord(row.metaJson)
  const capabilities = hasManualCapabilities(row)
  const parameters =
    meta[MANUAL_CONTEXT_WINDOW_KEY] != null ||
    meta[MANUAL_MAX_OUTPUT_TOKENS_KEY] != null ||
    meta[MANUAL_TEMPERATURE_KEY] != null
  const access = meta[ACCESS_POLICY_KEY] != null
  return { capabilities, parameters, access, any: capabilities || parameters || access }
}

export const readModelContextWindow = (meta: Record<string, any> | null | undefined): number | null => {
  if (!meta) return null
  return positiveInt(meta[MANUAL_CONTEXT_WINDOW_KEY]) ?? positiveInt(meta.context_window)
}

export const readModelMaxOutputTokens = (meta: Record<string, any> | null | undefined): number | null => {
  if (!meta) return null
  return (
    positiveInt(meta[MANUAL_MAX_OUTPUT_TOKENS_KEY]) ??
    positiveInt(meta.max_output_tokens) ??
    positiveInt(meta.max_completion_tokens) ??
    positiveInt(meta.completion_limit)
  )
}

export const readModelTemperature = (meta: Record<string, any> | null | undefined): number | null => {
  if (!meta) return null
  const raw = meta[MANUAL_TEMPERATURE_KEY]
  if (raw == null || raw === '') return null
  const numeric = typeof raw === 'number' ? raw : Number.parseFloat(String(raw))
  if (!Number.isFinite(numeric) || numeric < 0) return null
  return numeric
}

/**
 * 写入人工参数覆写：undefined 表示本次不涉及该字段，null 表示清除该字段的手写值。
 * 只写 custom_* 与 temperature，不改刷新写入的检测键。
 */
export const setModelParameterOverride = (
  meta: Record<string, any>,
  input: { maxOutputTokens?: number | null; contextWindow?: number | null; temperature?: number | null },
): Record<string, any> => {
  const next = { ...meta }
  if (Object.prototype.hasOwnProperty.call(input, 'maxOutputTokens')) {
    if (input.maxOutputTokens == null) delete next[MANUAL_MAX_OUTPUT_TOKENS_KEY]
    else next[MANUAL_MAX_OUTPUT_TOKENS_KEY] = Math.floor(input.maxOutputTokens)
  }
  if (Object.prototype.hasOwnProperty.call(input, 'contextWindow')) {
    if (input.contextWindow == null) delete next[MANUAL_CONTEXT_WINDOW_KEY]
    else next[MANUAL_CONTEXT_WINDOW_KEY] = Math.floor(input.contextWindow)
  }
  if (Object.prototype.hasOwnProperty.call(input, 'temperature')) {
    if (input.temperature == null) delete next[MANUAL_TEMPERATURE_KEY]
    else next[MANUAL_TEMPERATURE_KEY] = input.temperature
  }
  return next
}

/** 旧行把人工设置的上下文窗口直接写进 context_window；刷新前一次性提升到 manual 键。 */
export const promoteLegacyContextOverride = (
  meta: Record<string, any>,
  manualOverride: boolean | null | undefined,
): Record<string, any> => {
  if (!manualOverride) return meta
  if (meta[MANUAL_CONTEXT_WINDOW_KEY] != null) return meta
  const legacy = positiveInt(meta.context_window)
  if (legacy == null) return meta
  return { ...meta, [MANUAL_CONTEXT_WINDOW_KEY]: legacy }
}

export interface ClearedModelOverrides {
  capabilitiesJson: string
  metaJson: string
  state: ModelOverrideState
}

export const clearModelOverrides = (
  row: ModelOverrideRow,
  fields: ModelOverrideField[],
): ClearedModelOverrides => {
  const requested = new Set(fields)
  const clearAll = requested.has('capabilities') && requested.has('parameters') && requested.has('access')
  const meta = parseRecord(row.metaJson)

  if (requested.has('parameters') || clearAll) {
    delete meta[MANUAL_CONTEXT_WINDOW_KEY]
    delete meta[MANUAL_MAX_OUTPUT_TOKENS_KEY]
    delete meta[MANUAL_TEMPERATURE_KEY]
  }
  if (requested.has('access') || clearAll) {
    delete meta[ACCESS_POLICY_KEY]
  }

  const capabilitiesJson =
    requested.has('capabilities') || clearAll
      ? serializeCapabilityEnvelope(null)
      : row.capabilitiesJson || '{}'

  const state = readModelOverrideState({
    capabilitiesJson,
    metaJson: JSON.stringify(meta),
    manualOverride: row.manualOverride,
  })

  return { capabilitiesJson, metaJson: JSON.stringify(meta), state }
}

export const ALL_OVERRIDE_FIELDS: ModelOverrideField[] = ['capabilities', 'parameters', 'access']

export const isOverrideField = (value: unknown): value is ModelOverrideField =>
  value === 'capabilities' || value === 'parameters' || value === 'access'
