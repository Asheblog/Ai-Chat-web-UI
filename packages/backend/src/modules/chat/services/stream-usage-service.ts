import { BackendLogger as log } from '../../../utils/logger'
import { persistAssistantFinalResponse as defaultPersistFinal } from '../assistant-message-service'
import type { TaskTraceRecorder } from '../../../utils/task-trace'

export type ProviderUsageSnapshot = {
  prompt_tokens?: number
  prompt_eval_count?: number
  input_tokens?: number
  completion_tokens?: number
  eval_count?: number
  output_tokens?: number
  total_tokens?: number
}

export interface FinalizeParams {
  sessionId: number
  modelRawId: string
  providerHost: string | null
  assistantMessageId: number | null
  assistantClientMessageId?: string | null
  clientMessageId?: string | null
  userMessageId?: number | null
  content: string
  reasoningBuffer: string
  reasoningDurationSeconds: number
  promptTokens: number
  completionTokensFallback: number
  contextLimit: number
  providerUsageSeen: boolean
  providerUsageSnapshot: ProviderUsageSnapshot | null
  reasoningEnabled: boolean
  reasoningSaveToDb: boolean
  assistantReplyHistoryLimit: number
  traceRecorder?: TaskTraceRecorder
  timing?: {
    requestStartedAt: number
    firstChunkAt?: number | null
    completedAt: number
  }
  /** 预计算的 metrics，如果提供则直接使用，否则从 timing 计算 */
  precomputedMetrics?: StreamMetrics
}

export interface FinalizeResult {
  assistantMessageId: number | null
  finalUsage: { prompt: number; completion: number; total: number; contextLimit: number }
  providerUsageSource: 'provider' | 'fallback'
}

export const extractUsageNumbers = (
  u: ProviderUsageSnapshot | null,
): { prompt: number; completion: number; total: number } => {
  try {
    const prompt = Number(u?.prompt_tokens ?? u?.prompt_eval_count ?? u?.input_tokens ?? 0) || 0
    const completion = Number(u?.completion_tokens ?? u?.eval_count ?? u?.output_tokens ?? 0) || 0
    const total = Number(u?.total_tokens ?? prompt + completion) || prompt + completion
    return { prompt, completion, total }
  } catch {
    return { prompt: 0, completion: 0, total: 0 }
  }
}

export const resolveCompletionTokensForMetrics = (params: {
  providerUsageSeen: boolean
  providerUsageSnapshot: ProviderUsageSnapshot | null
  completionTokensFallback: number
}): number => {
  const fallback = Math.max(0, Number(params.completionTokensFallback) || 0)
  if (!params.providerUsageSeen) return fallback

  const providerNums = extractUsageNumbers(params.providerUsageSnapshot)
  const providerValid =
    providerNums.prompt > 0 || providerNums.completion > 0 || providerNums.total > 0
  if (!providerValid) return fallback

  if (providerNums.completion > 0) return providerNums.completion
  return Math.max(0, providerNums.total - providerNums.prompt)
}

export interface StreamMetrics {
  firstTokenLatencyMs: number
  responseTimeMs: number
  tokensPerSecond: number
}

export interface ComputeMetricsParams {
  timing: {
    requestStartedAt: number
    firstChunkAt?: number | null
    completedAt: number
  }
  completionTokens: number
}

/**
 * 计算流式响应的性能指标（纯计算，不涉及持久化）
 */
export const computeStreamMetrics = (params: ComputeMetricsParams): StreamMetrics => {
  const { timing, completionTokens } = params
  const startedAt = Math.max(0, Number(timing.requestStartedAt) || Date.now())
  const firstChunkAt = Math.max(0, Number(timing.firstChunkAt ?? startedAt) || startedAt)
  const completedAt = Math.max(0, Number(timing.completedAt) || Date.now())
  const firstTokenLatencyMs = Math.max(0, Math.round(firstChunkAt - startedAt))
  const responseTimeMs = Math.max(0, Math.round(completedAt - startedAt))
  const speedWindowMs = Math.max(1, completedAt - firstChunkAt || completedAt - startedAt || 1)
  const tokensPerSecond = completionTokens > 0 ? completionTokens / (speedWindowMs / 1000) : 0

  return {
    firstTokenLatencyMs,
    responseTimeMs,
    tokensPerSecond,
  }
}

export interface StreamUsageServiceDeps {
  persistAssistantFinalResponse?: typeof defaultPersistFinal
  logger?: Pick<typeof console, 'warn'>
}

export class StreamUsageService {
  private persistAssistantFinalResponse: typeof defaultPersistFinal
  private logger: Pick<typeof console, 'warn'>

  constructor(deps: StreamUsageServiceDeps = {}) {
    this.persistAssistantFinalResponse =
      deps.persistAssistantFinalResponse ?? defaultPersistFinal
    this.logger = deps.logger ?? log
  }

  async finalize(params: FinalizeParams): Promise<FinalizeResult> {
    const providerNums = params.providerUsageSeen
      ? extractUsageNumbers(params.providerUsageSnapshot)
      : { prompt: 0, completion: 0, total: 0 }
    const providerValid =
      providerNums.prompt > 0 || providerNums.completion > 0 || providerNums.total > 0
    const finalUsage = providerValid
      ? providerNums
      : {
          prompt: params.promptTokens,
          completion: params.completionTokensFallback,
          total: params.promptTokens + params.completionTokensFallback,
        }

    // 使用预计算的 metrics，如果没有则现场计算
    const metrics = params.precomputedMetrics ?? (params.timing
      ? computeStreamMetrics({
          timing: {
            requestStartedAt: params.timing.requestStartedAt,
            firstChunkAt: params.timing.firstChunkAt,
            completedAt: params.timing.completedAt,
          },
          completionTokens: finalUsage.completion,
        })
      : { firstTokenLatencyMs: 0, responseTimeMs: 0, tokensPerSecond: 0 })

    const { firstTokenLatencyMs, responseTimeMs, tokensPerSecond } = metrics

    let persistedAssistantMessageId = params.assistantMessageId
    const trimmedContent = params.content.trim()
    if (trimmedContent) {
      const shouldPersistReasoning =
        params.reasoningEnabled &&
        params.reasoningSaveToDb &&
        params.reasoningBuffer.trim().length > 0

      const persistedId = await this.persistAssistantFinalResponse({
        sessionId: params.sessionId,
        existingMessageId: params.assistantMessageId,
        assistantClientMessageId: params.assistantClientMessageId,
        fallbackClientMessageId: params.clientMessageId,
        parentMessageId: params.userMessageId ?? null,
        replyHistoryLimit: params.assistantReplyHistoryLimit,
        content: trimmedContent,
        streamReasoning: shouldPersistReasoning ? params.reasoningBuffer.trim() : null,
        reasoning: shouldPersistReasoning ? params.reasoningBuffer.trim() : null,
        reasoningDurationSeconds: shouldPersistReasoning ? params.reasoningDurationSeconds : null,
        streamError: null,
        usage: {
          promptTokens: finalUsage.prompt,
          completionTokens: finalUsage.completion,
          totalTokens: finalUsage.total,
          contextLimit: params.contextLimit,
        },
        metrics: {
          firstTokenLatencyMs,
          responseTimeMs,
          tokensPerSecond,
        },
        model: params.modelRawId,
        provider: params.providerHost ?? undefined,
      })
      if (persistedId) {
        persistedAssistantMessageId = persistedId
        params.traceRecorder?.log('db:persist_final', {
          messageId: persistedId,
          length: trimmedContent.length,
          promptTokens: finalUsage.prompt,
          completionTokens: finalUsage.completion,
          totalTokens: finalUsage.total,
          source: 'stream_final',
        })
      }
    }

    return {
      assistantMessageId: persistedAssistantMessageId,
      finalUsage: { ...finalUsage, contextLimit: params.contextLimit },
      providerUsageSource: providerValid ? 'provider' : 'fallback',
    }
  }
}

let streamUsageService = new StreamUsageService()

export const setStreamUsageService = (service: StreamUsageService) => {
  streamUsageService = service
}

export { streamUsageService }
