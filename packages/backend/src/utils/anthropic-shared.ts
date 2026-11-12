// Anthropic 适配层共享的小工具：类型守卫、数字归一化、用量与 stop_reason 映射。

export const isRecord = (value: unknown): value is Record<string, any> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const toNumber = (value: unknown): number | null => {
  const num = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  return Number.isFinite(num) ? num : null
}

export const createToolCallId = (): string =>
  'toolu_' + Math.random().toString(36).slice(2, 10)

export const mapStopReason = (stopReason: unknown): string => {
  switch (typeof stopReason === 'string' ? stopReason : '') {
    case 'max_tokens':
      return 'length'
    case 'tool_use':
      return 'tool_calls'
    case 'refusal':
      return 'content_filter'
    case 'stop_sequence':
    case 'end_turn':
    case 'pause_turn':
      return 'stop'
    default:
      return 'stop'
  }
}

export const convertUsage = (usage: any): Record<string, any> | undefined => {
  if (!isRecord(usage)) return undefined
  // Anthropic 的 input_tokens 不含缓存命中/写入；OpenAI prompt_tokens 是总输入。
  const input = toNumber(usage.input_tokens) ?? 0
  const cacheRead = toNumber(usage.cache_read_input_tokens) ?? 0
  const cacheCreation = toNumber(usage.cache_creation_input_tokens) ?? 0
  const prompt = input + cacheRead + cacheCreation
  const completion = toNumber(usage.output_tokens) ?? 0
  const result: Record<string, any> = {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
  }
  if (cacheRead > 0) {
    result.prompt_tokens_details = { cached_tokens: cacheRead }
  }
  return result
}

/**
 * 把 Anthropic Messages 响应转换为 OpenAI chat.completion。
 * 已符合 OpenAI 形状的载荷原样返回，便于所有调用点复用。
 */
