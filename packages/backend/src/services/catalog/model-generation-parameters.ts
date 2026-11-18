import type { ProviderType } from '../../utils/providers'
import { resolveAnthropicEffort, resolveAnthropicEffortSupport } from '../../utils/anthropic-effort'

/**
 * 按协议与思考方言裁剪模型生成参数。
 *
 * 依据（docs/research/settings-audit-2026-11-16/provider-evidence.md）：
 * - OpenAI 家族：`reasoning_effort` 枚举 none/minimal/low/medium/high/xhigh/max；哪些取值对单个模型有效
 *   由官方 reasoning guide 决定（本仓库无逐模型矩阵，因此不猜模型级差异，只按协议枚举裁剪）。
 * - Anthropic：现行控制手段是 `output_config.effort`（low/medium/high/xhigh/max），没有 minimal/none。
 * - Gemini：`thinking_level` = minimal/low/medium/high/xhigh（无 max）。
 * - DeepSeek 兼容方言：只认 low/high/max，其余取值由厂商静默映射（minimal→low、medium→high、xhigh→high）。
 *
 * 默认 Auto：没有请求/会话/系统显式强度时不下发任何强度字段；不支持的取值一律丢弃，绝不下发。
 */

export type EffortValue = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

const OPENAI_EFFORTS: EffortValue[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const DEEPSEEK_EFFORTS: EffortValue[] = ['low', 'high', 'max']
const GOOGLE_EFFORTS: EffortValue[] = ['minimal', 'low', 'medium', 'high', 'xhigh']

const DEEPSEEK_ALIASES: Record<string, EffortValue | null> = {
  minimal: 'low',
  medium: 'high',
  xhigh: 'high',
  none: 'none',
}
const GOOGLE_ALIASES: Record<string, EffortValue | null> = {
  max: 'xhigh',
  none: null,
}

export interface EffortContext {
  provider: ProviderType
  thinkingDialect?: string | null
  /** 供应商原始模型 ID（不含连接前缀）：Anthropic 的 effort 支持面按模型区分。 */
  rawModelId?: string | null
}

const isDeepSeekDialect = (dialect?: string | null) => dialect === 'deepseek_compat'

/** 该连接可下发的强度取值（用于设置页与模型选择器裁剪）。 */
export const resolveSupportedEfforts = ({
  provider,
  thinkingDialect,
  rawModelId,
}: EffortContext): EffortValue[] => {
  if (provider === 'anthropic') {
    return resolveAnthropicEffortSupport(rawModelId).efforts as EffortValue[]
  }
  if (provider === 'google_genai') return [...GOOGLE_EFFORTS]
  return isDeepSeekDialect(thinkingDialect) ? [...DEEPSEEK_EFFORTS] : [...OPENAI_EFFORTS]
}

/**
 * 把用户/会话/系统给出的强度收敛为一个可下发值。
 * 返回 null 表示"不下发"（Auto 或该协议没有等价语义）。
 */
export const resolveEffortForModel = (
  context: EffortContext,
  requested: string | null | undefined,
): EffortValue | null => {
  const raw = (requested ?? '').toString().trim().toLowerCase()
  if (context.provider === 'anthropic') {
    // Anthropic 的等级与模型强相关：由官方支持矩阵决定，别名（minimal→low）也在那里收敛。
    return resolveAnthropicEffort(context.rawModelId, raw) as EffortValue | null
  }
  if (!raw || raw === 'unset') return null
  const supported = resolveSupportedEfforts(context)
  if ((supported as string[]).includes(raw)) return raw as EffortValue

  const aliases = context.provider === 'google_genai'
    ? GOOGLE_ALIASES
    : isDeepSeekDialect(context.thinkingDialect)
      ? DEEPSEEK_ALIASES
      : {}
  if (Object.prototype.hasOwnProperty.call(aliases, raw)) {
    const mapped = aliases[raw]
    if (mapped && (supported as string[]).includes(mapped)) return mapped
    return null
  }
  return null
}

/** Keep selectable levels separate from the values forwarded by the chat adapter. */
export const describeModelEffort = (context: EffortContext) => {
  const efforts = resolveSupportedEfforts(context)
  const appliedEfforts: Partial<Record<EffortValue, EffortValue>> = {}
  // The current Gemini chat adapter does not serialize a thinking level.
  if (context.provider !== 'google_genai') {
    for (const value of OPENAI_EFFORTS) {
      const applied = resolveEffortForModel(context, value)
      if (applied) appliedEfforts[value] = applied
    }
  }
  return { efforts, appliedEfforts }
}

/**
 * 思考模式下不发送采样温度：DeepSeek 文档明确 thinking 模式忽略 temperature（不报错也不生效）。
 * 其余协议没有可引用的"思考模式禁止 temperature"证据，保持发送。
 */
export const shouldSendTemperature = (
  context: EffortContext & { reasoningEnabled: boolean },
): boolean => {
  if (isDeepSeekDialect(context.thinkingDialect) && context.reasoningEnabled) return false
  return true
}
