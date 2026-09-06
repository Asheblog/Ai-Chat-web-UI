import type { StreamEventContext } from './stream-event-context'

export const handleCompleteEvent = (evt: any, ctx: StreamEventContext): void => {
  const { active, set, runtime } = ctx
  const activeBuffer = active
  // 如果后端在 complete 事件中下发了最终内容，直接覆盖本地累积的内容
  if (typeof (evt as any).content === 'string' && (evt as any).content.length > 0) {
    active.pendingContent = ''
    active.content = (evt as any).content
  }
  if (
    (evt as any).streamStatus === 'cancelled' ||
    (evt as any).streamStatus === 'error' ||
    (evt as any).streamStatus === 'done'
  ) {
    active.pendingMeta.streamStatus = (evt as any).streamStatus
    active.terminalStreamStatus = (evt as any).streamStatus
  }
  if (activeBuffer) {
    activeBuffer.pendingMeta.reasoningStatus = 'done'
    activeBuffer.completedAt = Date.now()
    // 保存后端发送的 metrics
    if (evt.metrics) {
      activeBuffer.serverMetrics = {
        firstTokenLatencyMs: evt.metrics.firstTokenLatencyMs ?? null,
        responseTimeMs: evt.metrics.responseTimeMs ?? null,
        tokensPerSecond: evt.metrics.tokensPerSecond ?? null,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
      }
    }
    if (evt.usage && typeof evt.usage === 'object') {
      const usage = evt.usage as import('../types').StreamUsageSnapshot
      activeBuffer.lastUsage = usage
      set((state) => ({
        usageCurrent: {
          prompt_tokens: usage.prompt_tokens,
          context_limit: usage.context_limit ?? state.usageCurrent?.context_limit ?? undefined,
          context_remaining:
            usage.context_remaining ?? state.usageCurrent?.context_remaining ?? undefined,
        },
        usageLastRound:
          usage.completion_tokens != null || usage.total_tokens != null
            ? usage
            : state.usageLastRound,
      }))
    }
  }
  runtime.scheduleFlush(active)
}
