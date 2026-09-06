import { computeStreamMetrics as computeTimingMetrics } from '@aichat/shared/stream-metrics'
import type { MessageStreamMetrics } from '@/types'
import type { StreamUsageSnapshot } from '../types'

export const computeStreamMetrics = (
  params: {
    startedAt?: number | null
    firstChunkAt?: number | null
    completedAt?: number | null
  },
  usage?: StreamUsageSnapshot | null,
): MessageStreamMetrics | null => {
  const normalizeNumber = (value: unknown) => {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  const startedAt = normalizeNumber(params.startedAt)
  const firstChunkAt = normalizeNumber(params.firstChunkAt)
  const completedAt = normalizeNumber(params.completedAt)
  const promptTokens = normalizeNumber(usage?.prompt_tokens)
  const completionTokens = normalizeNumber(usage?.completion_tokens)
  const totalTokens = normalizeNumber(usage?.total_tokens)

  const resolvedCompletionTokens =
    completionTokens != null
      ? completionTokens
      : totalTokens != null && promptTokens != null
        ? totalTokens - promptTokens
        : null

  const timingMetrics =
    startedAt != null && completedAt != null && completedAt >= startedAt
      ? computeTimingMetrics({
          timing: {
            requestStartedAt: startedAt,
            firstChunkAt,
            completedAt,
          },
          completionTokens: resolvedCompletionTokens ?? 0,
        })
      : null

  const speedDurationMs =
    completedAt != null
      ? completedAt - (firstChunkAt ?? startedAt ?? completedAt)
      : null
  const tokensPerSecond =
    resolvedCompletionTokens != null && speedDurationMs != null && speedDurationMs > 0
      ? (timingMetrics?.tokensPerSecond ?? null)
      : null

  const metrics: MessageStreamMetrics = {
    firstTokenLatencyMs: timingMetrics?.firstTokenLatencyMs ?? null,
    responseTimeMs: timingMetrics?.responseTimeMs ?? null,
    tokensPerSecond,
    promptTokens,
    completionTokens: resolvedCompletionTokens,
    totalTokens,
  }
  const hasValue = Object.values(metrics).some((value) => typeof value === 'number')
  return hasValue ? metrics : null
}
