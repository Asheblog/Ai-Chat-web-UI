/**
 * 流式性能指标计算 —— backend / frontend 共用（RN 安全）。
 *
 * 收敛三份重复实现：
 * - backend modules/chat/services/stream-usage-service.ts
 * - backend modules/chat/agent-web-search-response.ts
 * - frontend features/chat/store/slices/stream-slice.ts
 *
 * 本函数返回原始数值（不取整）；需要取整的调用方自行包装。
 */

export interface StreamMetrics {
  firstTokenLatencyMs: number | null
  responseTimeMs: number
  tokensPerSecond: number
}

export interface ComputeStreamMetricsParams {
  timing: {
    requestStartedAt: number
    firstChunkAt?: number | null
    /**
     * 用于计算 tokensPerSecond 的起始锚点。如果提供，tokensPerSecond 使用
     * speedStartedAt → completedAt 窗口而非 firstChunkAt → completedAt。
     * 适用于 reasoning 阶段先于可见正文到达的场景，避免 reasoning 时长稀释 TPS。
     */
    speedStartedAt?: number | null
    completedAt: number
  }
  completionTokens: number
}

export const computeStreamMetrics = (
  params: ComputeStreamMetricsParams,
): StreamMetrics => {
  const { timing, completionTokens } = params
  const startedAt = Math.max(0, Number(timing.requestStartedAt) || Date.now())
  const completedAt = Math.max(0, Number(timing.completedAt) || Date.now())
  const firstChunkCandidate = Number(timing.firstChunkAt)
  const firstChunkAt =
    Number.isFinite(firstChunkCandidate) && firstChunkCandidate >= startedAt
      ? Math.min(firstChunkCandidate, completedAt)
      : null
  const firstTokenLatencyMs =
    firstChunkAt != null ? Math.max(0, firstChunkAt - startedAt) : null
  const responseTimeMs = Math.max(0, completedAt - startedAt)

  // speedAnchorAt: 用于 TPS 计算的时间窗口起点
  const speedCandidate = Number(timing.speedStartedAt)
  const speedStartedAt =
    Number.isFinite(speedCandidate) && speedCandidate >= startedAt
      ? Math.min(speedCandidate, completedAt)
      : null
  const speedAnchorAt = speedStartedAt ?? firstChunkAt ?? startedAt
  const speedWindowMs = Math.max(1, completedAt - speedAnchorAt || completedAt - startedAt || 1)
  const tokensPerSecond = completionTokens > 0 ? completionTokens / (speedWindowMs / 1000) : 0

  return {
    firstTokenLatencyMs,
    responseTimeMs,
    tokensPerSecond,
  }
}
