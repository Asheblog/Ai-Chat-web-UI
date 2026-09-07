/**
 * OpenAI Completions 连接组上的 Thinking 方言：
 * 是否向请求体注入厂商 `thinking` 控制参数。
 */

export const THINKING_DIALECTS = ['off', 'deepseek_compat'] as const

export type ThinkingDialect = (typeof THINKING_DIALECTS)[number]

export function normalizeThinkingDialect(input: unknown): ThinkingDialect {
  return input === 'deepseek_compat' ? 'deepseek_compat' : 'off'
}

export function inferThinkingDialectFromBaseUrl(baseUrl: string): ThinkingDialect {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase()
    if (host.includes('deepseek') || host.includes('siliconflow')) {
      return 'deepseek_compat'
    }
  } catch {
    // invalid URL → off
  }
  return 'off'
}

export function legacyVendorToThinkingDialect(vendor: string | null | undefined): ThinkingDialect {
  if (vendor === 'deepseek' || vendor === 'openai_interleave') {
    return 'deepseek_compat'
  }
  return 'off'
}
