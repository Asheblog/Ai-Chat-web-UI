/**
 * Anthropic effort 的模型门控（官方依据，观测于 2026-11-16）：
 * https://platform.claude.com/docs/en/build-with-claude/effort
 *
 * - 支持 model 列表来自页面 featureMetadata.supportedModels；不在列表里的模型不下发 effort。
 * - 等级可用面来自 "Effort levels" 表：max/xhigh 逐模型列出，其余模型只支持 low/medium/high。
 * - 页面示例请求带 `anthropic-version: 2026-10-21`，但正文没有声明 effort 受版本头门控；
 *   api/versioning 页面在本环境被区域限制拦截，故这里不改连接默认的 anthropic-version，
 *   只按模型 + 等级门控。需要时仍可用连接的自定义 Headers 覆盖版本。
 */

export type AnthropicEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

const ALL_LEVELS: AnthropicEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']
const WITHOUT_XHIGH: AnthropicEffort[] = ['low', 'medium', 'high', 'max']
const BASE_LEVELS: AnthropicEffort[] = ['low', 'medium', 'high']

/** 官方 supportedModels ∩ 各等级可用面。键为去掉日期快照的规范模型名。 */
const EFFORT_MODELS: Record<string, AnthropicEffort[]> = {
  'claude-fable-5-2': ALL_LEVELS,
  'claude-mythos-5-2': ALL_LEVELS,
  'claude-fable-5-1': ALL_LEVELS,
  'claude-mythos-5-1': ALL_LEVELS,
  'claude-fable-5': ALL_LEVELS,
  'claude-mythos-5': ALL_LEVELS,
  'claude-mythos-preview': WITHOUT_XHIGH,
  'claude-opus-5-5': ALL_LEVELS,
  'claude-opus-5': ALL_LEVELS,
  'claude-sonnet-5-5': ALL_LEVELS,
  'claude-sonnet-5': ALL_LEVELS,
  'claude-haiku-5-5': ALL_LEVELS,
  'claude-opus-4-8': ALL_LEVELS,
  'claude-opus-4-7': ALL_LEVELS,
  'claude-opus-4-6': WITHOUT_XHIGH,
  'claude-sonnet-4-6': WITHOUT_XHIGH,
  // 官方列表只列出这一个 4.5 快照，且它不在 max/xhigh 列表中。
  'claude-opus-4-5-20251101': BASE_LEVELS,
}

const canonicalize = (rawModelId: string | null | undefined): string => {
  const id = String(rawModelId ?? '').trim().toLowerCase()
  if (!id) return ''
  const at = id.indexOf('claude-')
  return at >= 0 ? id.slice(at) : id
}

const lookupLevels = (canonicalId: string): AnthropicEffort[] | null => {
  const direct = EFFORT_MODELS[canonicalId]
  if (direct) return direct
  // 同一家族的带日期快照（例如 claude-opus-5-5-20260101）沿用家族能力；
  // 未列入官方列表的历史快照（例如 claude-opus-4-5-20250929）不会命中，保持不支持。
  const dated = /^(.*)-(\d{8})$/.exec(canonicalId)
  if (dated) return EFFORT_MODELS[dated[1]] ?? null
  return null
}

export interface AnthropicEffortSupport {
  supported: boolean
  efforts: AnthropicEffort[]
}

export const resolveAnthropicEffortSupport = (
  rawModelId: string | null | undefined,
): AnthropicEffortSupport => {
  const levels = lookupLevels(canonicalize(rawModelId))
  return levels ? { supported: true, efforts: [...levels] } : { supported: false, efforts: [] }
}

/**
 * 把请求强度收敛为该模型可下发的值；null 表示不下发（模型不支持、等级不可用或本就不该发送）。
 */
export const resolveAnthropicEffort = (
  rawModelId: string | null | undefined,
  requested: string | null | undefined,
): AnthropicEffort | null => {
  const value = String(requested ?? '').trim().toLowerCase()
  if (!value || value === 'unset' || value === 'none') return null
  const mapped = value === 'minimal' ? 'low' : value
  const { efforts } = resolveAnthropicEffortSupport(rawModelId)
  return (efforts as string[]).includes(mapped) ? (mapped as AnthropicEffort) : null
}
