import {
  StreamUsageService,
  computeStreamMetrics,
  resolveCompletionTokensForMetrics,
} from '../stream-usage-service'

const build = () => {
  const persistAssistantFinalResponse = jest.fn(async () => 10)
  const logger = { warn: jest.fn() }
  const service = new StreamUsageService({
    persistAssistantFinalResponse,
    logger,
  })
  return { service, persistAssistantFinalResponse, logger }
}

const baseParams = () => ({
  sessionId: 1,
  modelRawId: 'gpt',
  providerHost: 'api.example.com',
  assistantMessageId: 2,
  assistantClientMessageId: 'a1',
  clientMessageId: 'c1',
  userMessageId: 3,
  content: 'hello world',
  reasoningBuffer: 'think',
  reasoningDurationSeconds: 2,
  promptTokens: 10,
  completionTokensFallback: 5,
  contextLimit: 100,
  providerUsageSeen: false,
  providerUsageSnapshot: null,
  reasoningEnabled: true,
  reasoningSaveToDb: true,
  assistantReplyHistoryLimit: 3,
  traceRecorder: { log: jest.fn(), setMessageContext: jest.fn(), isEnabled: () => true } as any,
})

describe('StreamUsageService', () => {
  it('returns null latency when first chunk timestamp is missing', () => {
    const metrics = computeStreamMetrics({
      timing: {
        requestStartedAt: 1000,
        firstChunkAt: null,
        completedAt: 2200,
      },
      completionTokens: 24,
    })
    expect(metrics.firstTokenLatencyMs).toBeNull()
    expect(metrics.responseTimeMs).toBe(1200)
    expect(metrics.tokensPerSecond).toBeCloseTo(20, 5)
  })

  it('clamps first chunk timestamp to completedAt when provider clock drifts', () => {
    const metrics = computeStreamMetrics({
      timing: {
        requestStartedAt: 1000,
        firstChunkAt: 5000,
        completedAt: 1600,
      },
      completionTokens: 6,
    })
    expect(metrics.firstTokenLatencyMs).toBe(600)
    expect(metrics.responseTimeMs).toBe(600)
    expect(metrics.tokensPerSecond).toBeCloseTo(10, 5)
  })

  it('uses speedStartedAt for tokensPerSecond when provided (reasoning started early, visible content started later)', () => {
    const metrics = computeStreamMetrics({
      timing: {
        requestStartedAt: 1000,
        firstChunkAt: 1200,       // first delta (reasoning) arrived at 1200
        speedStartedAt: 5000,     // visible content delta arrived at 5000
        completedAt: 9000,        // stream finished at 9000
      },
      completionTokens: 80,
    })
    // firstTokenLatencyMs still uses firstChunkAt (1200 - 1000 = 200)
    expect(metrics.firstTokenLatencyMs).toBe(200)
    // responseTimeMs still uses requestStartedAt to completedAt
    expect(metrics.responseTimeMs).toBe(8000)
    // tokensPerSecond uses speedStartedAt(5000) to completedAt(9000) = 4000ms, 80/4 = 20
    expect(metrics.tokensPerSecond).toBeCloseTo(20, 5)
  })

  it('falls back to firstChunkAt when speedStartedAt is not provided', () => {
    const metrics = computeStreamMetrics({
      timing: {
        requestStartedAt: 1000,
        firstChunkAt: 2000,
        completedAt: 5000,
      },
      completionTokens: 40,
    })
    // tokensPerSecond uses firstChunkAt(2000) to completedAt(5000) = 3000ms, 40/3 = 13.33
    expect(metrics.tokensPerSecond).toBeCloseTo(40 / 3, 5)
  })

  it('uses provider completion tokens for metrics when fallback tokens are zero', () => {
    const completion = resolveCompletionTokensForMetrics({
      providerUsageSeen: true,
      providerUsageSnapshot: { prompt_tokens: 100, completion_tokens: 42, total_tokens: 142 },
      completionTokensFallback: 0,
    })
    expect(completion).toBe(42)
  })

  it('derives completion from total minus prompt when provider omits completion field', () => {
    const completion = resolveCompletionTokensForMetrics({
      providerUsageSeen: true,
      providerUsageSnapshot: { prompt_tokens: 60, total_tokens: 90 },
      completionTokensFallback: 0,
    })
    expect(completion).toBe(30)
  })

  it('uses provider usage when present', async () => {
    const { service, persistAssistantFinalResponse } = build()
    const result = await service.finalize({
      ...baseParams(),
      providerUsageSeen: true,
      providerUsageSnapshot: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 },
    })
    expect(persistAssistantFinalResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        usage: expect.objectContaining({ promptTokens: 20, completionTokens: 30, totalTokens: 50 }),
      }),
    )
    expect(result.finalUsage.prompt).toBe(20)
    expect(result.providerUsageSource).toBe('provider')
    expect(result.assistantMessageId).toBe(10)
  })

  it('falls back to computed usage when provider missing', async () => {
    const { service } = build()
    const result = await service.finalize({
      ...baseParams(),
      providerUsageSeen: false,
    })
    expect(result.finalUsage.prompt).toBe(10)
    expect(result.finalUsage.completion).toBe(5)
    expect(result.providerUsageSource).toBe('fallback')
  })

  it('skips reasoning when disabled', async () => {
    const { service, persistAssistantFinalResponse } = build()
    await service.finalize({
      ...baseParams(),
      reasoningEnabled: false,
      reasoningSaveToDb: false,
      reasoningBuffer: 'reasoning content',
    })
    expect(persistAssistantFinalResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        streamReasoning: null,
        reasoning: null,
        reasoningDurationSeconds: null,
      }),
    )
  })
})
