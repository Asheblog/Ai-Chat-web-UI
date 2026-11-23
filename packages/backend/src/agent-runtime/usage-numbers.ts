/**
 * 用量数字归一：只认 provider 真的返回过的字段。
 *
 * 「没返回用量」与「显式返回 0」是两件事：
 * - 没有 usage、或 usage 里没有任何数字字段 → null（这一轮没有用量证据，不进入累计）
 * - usage 里显式写了 0 → 数字 0（真实快照，按 0 记录）
 * 计费口径不变：调用方仍按既有规则决定用 provider 值还是本地 fallback。
 */

export type UsageNumbers = {
  prompt: number
  completion: number
  total: number
  cacheHit: number
  cacheMiss: number
}

const USAGE_NUMBER_KEYS = [
  'prompt_tokens',
  'input_tokens',
  'completion_tokens',
  'output_tokens',
  'total_tokens',
  'prompt_cache_hit_tokens',
  'prompt_cache_miss_tokens',
] as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readNumber = (value: unknown): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** 网关常把用量写成字符串："12" 也算真实返回，但缺字段仍算未返回 */
const isNumericValue = (value: unknown): boolean => {
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'string' && value.trim() !== '') return Number.isFinite(Number(value))
  return false
}

export const readUsageNumbers = (usage: unknown): UsageNumbers | null => {
  if (!isRecord(usage)) return null
  // usage 里连一个数字字段都没有：这一轮没有用量证据，不能当成 0
  const hasAnyNumberField = USAGE_NUMBER_KEYS.some((key) => isNumericValue(usage[key]))
  if (!hasAnyNumberField) return null
  const prompt = readNumber(usage.prompt_tokens ?? usage.input_tokens)
  const completion = readNumber(usage.completion_tokens ?? usage.output_tokens)
  const total = readNumber(usage.total_tokens ?? prompt + completion)
  return {
    prompt,
    completion,
    total,
    cacheHit: readNumber(usage.prompt_cache_hit_tokens),
    cacheMiss: readNumber(usage.prompt_cache_miss_tokens),
  }
}

/** 逐轮累计：每轮只加一次快照，缺失用量的轮次直接跳过，不按 0 计入 */
export const addUsageNumbers = (
  base: UsageNumbers | null,
  next: UsageNumbers | null,
): UsageNumbers | null => {
  if (!next) return base
  if (!base) return { ...next }
  return {
    prompt: base.prompt + next.prompt,
    completion: base.completion + next.completion,
    total: base.total + next.total,
    cacheHit: base.cacheHit + next.cacheHit,
    cacheMiss: base.cacheMiss + next.cacheMiss,
  }
}

export const isUsageNumbersNonZero = (usage: UsageNumbers | null): boolean =>
  usage != null && (usage.prompt > 0 || usage.completion > 0 || usage.total > 0)
