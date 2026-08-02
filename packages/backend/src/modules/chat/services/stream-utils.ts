/**
 * Chat 流式链路纯函数工具。
 *
 * 收敛历史重复实现：
 * - usage token 归一化（chat-stream-use-case.ts 3 处内联 + battle-executor.ts buildUsage）
 * - agentMaxToolIterations 解析（chat-stream-use-case.ts 内联 + battle-executor.ts resolveMaxToolIterations）
 * - metaso scope 白名单（统一引用 utils/web-search.ts 权威声明）
 */
import type { UsageStats } from '@aichat/shared/chat-stream-contract'
import { METASO_SCOPE_WHITELIST } from '../../../utils/web-search'

/** 规范化 scope：仅接受白名单内取值，非法值返回 undefined（与 web-search.ts 默认 'webpage' 策略相区分） */
export const sanitizeScope = (scope?: string): string | undefined => {
  if (!scope) return undefined
  const normalized = scope.trim().toLowerCase()
  return METASO_SCOPE_WHITELIST.has(normalized) ? normalized : undefined
}

/** 解析 agent 最大工具迭代次数（0=无限，1-20=硬限制，默认 4） */
export const resolveMaxToolIterations = (sysMap: Record<string, string>): number => {
  const raw = sysMap.agent_max_tool_iterations || process.env.AGENT_MAX_TOOL_ITERATIONS || '4'
  const parsed = Number.parseInt(String(raw), 10)
  if (Number.isFinite(parsed) && parsed >= 0) {
    if (parsed === 0) {
      return Number.POSITIVE_INFINITY
    }
    return Math.min(20, parsed)
  }
  return 4
}

export interface ExtractedUsageNumbers {
  prompt: number
  completion: number
  total: number
}

/**
 * 从厂商 usage 载荷归一化 token 数。
 * 兼容 OpenAI（prompt_tokens/completion_tokens/total_tokens）、
 * Ollama（prompt_eval_count/eval_count）与部分网关（input_tokens/output_tokens）。
 */
export const extractUsageNumbers = (u: any): ExtractedUsageNumbers => {
  const prompt = Number(u?.prompt_tokens ?? u?.prompt_eval_count ?? u?.input_tokens ?? 0) || 0
  const completion = Number(u?.completion_tokens ?? u?.eval_count ?? u?.output_tokens ?? 0) || 0
  const total = Number(u?.total_tokens ?? (prompt + completion)) || prompt + completion
  return { prompt, completion, total }
}

export interface BuildUsageContext {
  promptTokens: number
  contextLimit: number
  contextRemaining: number
}

/**
 * 将厂商 usage 载荷归一化为 UsageStats（含上下文统计）。
 * 供 battle 执行器与 chat 流式尾部统计共用。
 */
export const buildUsage = (
  json: any,
  context: BuildUsageContext,
): UsageStats => {
  const u = json?.usage || {}
  const promptTokens =
    Number(u?.prompt_tokens ?? u?.prompt_eval_count ?? u?.input_tokens ?? context.promptTokens) ||
    context.promptTokens
  const completionTokens =
    Number(u?.completion_tokens ?? u?.eval_count ?? u?.output_tokens ?? 0) || 0
  const totalTokens =
    Number(u?.total_tokens ?? 0) || promptTokens + (Number(u?.completion_tokens ?? 0) || 0)
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
    context_limit: context.contextLimit,
    context_remaining: context.contextRemaining,
  }
}
