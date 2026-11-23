/**
 * 编排终态集成测试：createAgentWebSearchResponse 与编排结果的接线。
 *
 * 编排层（runToolOrchestration）在单测里已覆盖，这里只把它替换成真实的终态对象，
 * 验证答复层如何落 SSE、追踪事件与终态状态：不得把上游未交付标成取消或成功。
 */
jest.mock('../../../db', () => ({
  prisma: {
    message: {
      update: jest.fn(async () => ({})),
      count: jest.fn(async () => 1),
    },
    chatSession: {
      count: jest.fn(async () => 1),
    },
  },
}))

jest.mock('../assistant-message-service', () => ({
  persistAssistantFinalResponse: jest.fn(async () => 7),
  upsertAssistantMessageByClientId: jest.fn(async () => null),
}))

jest.mock('../../../utils/model-capabilities', () => ({
  resolveModelCapabilitiesForSession: jest.fn(async () => ({})),
}))

// 工具处理器不属于本测试范围（且由检索侧并行改动）：只保留答复层需要的导出
jest.mock('../tool-handlers', () => ({
  sendUnsupportedToolError: jest.fn(),
}))

jest.mock('../../skills/skill-registry', () => ({
  createSkillRegistry: jest.fn(async () => ({
    getToolDefinitions: () => [
      {
        type: 'function',
        function: { name: 'python_runner', description: 'run', parameters: { type: 'object', properties: {} } },
      },
      {
        type: 'function',
        function: { name: 'web_search', description: 'search', parameters: { type: 'object', properties: {} } },
      },
    ],
    getAllowedToolNames: () => new Set<string>(['python_runner', 'web_search', 'read_url']),
    // 由各用例通过 globalThis.__webSearchToolResult 按工具名注入结果
    handleToolCall: jest.fn(async (toolName: string) => {
      const results = (globalThis as any).__webSearchToolResult
      return results && results[toolName] ? results[toolName] : null
    }),
  })),
}))

jest.mock('../../../agent-runtime/tool-orchestrator', () => ({
  runToolOrchestration: jest.fn(),
}))

import { runToolOrchestration } from '../../../agent-runtime/tool-orchestrator'
import { streamMetaStore } from '../../../services/chat/stream-meta-store'
import { createAgentWebSearchResponse } from '../agent-web-search-response'

const runOrchestration = runToolOrchestration as jest.MockedFunction<typeof runToolOrchestration>

type TraceEvent = { event: string; payload: Record<string, unknown> }

const createTraceRecorder = () => {
  const events: TraceEvent[] = []
  return {
    events,
    recorder: {
      log: jest.fn((event: string, payload?: Record<string, unknown>) => {
        events.push({ event, payload: payload ?? {} })
      }),
      finalize: jest.fn(async () => {}),
      setMessageContext: jest.fn(),
    },
  }
}

const baseParams = (sessionId: number, traceRecorder: any) => ({
  session: {
    id: sessionId,
    connectionId: 10,
    modelRawId: 'gpt-4o-mini',
    connection: { id: 10, provider: 'openai' },
  } as any,
  sessionId,
  requestData: {},
  messagesPayload: [{ role: 'user', content: '帮我查一下最近的新闻' }],
  promptTokens: 100,
  contextLimit: 8000,
  contextRemaining: 7900,
  quotaSnapshot: null,
  userMessageRecord: { id: 5 },
  sseHeaders: { 'Content-Type': 'text/event-stream' },
  agentConfig: { engines: [] } as any,
  pythonToolConfig: {} as any,
  urlReaderConfig: { enableDeepseekFallback: false } as any,
  workspaceToolConfig: {} as any,
  agentMaxToolIterations: 4,
  toolFlags: { webSearch: true },
  requestedSkills: { builtin: ['web_search'], custom: [] } as any,
  provider: 'openai',
  baseUrl: 'https://api.example.com/v1',
  authHeader: {},
  extraHeaders: {},
  reasoningEnabled: false,
  reasoningSaveToDb: false,
  actorIdentifier: `actor-${sessionId}`,
  requestSignal: new AbortController().signal,
  assistantMessageId: null,
  assistantClientMessageId: null,
  streamProgressPersistIntervalMs: 50,
  traceRecorder,
  idleTimeoutMs: 0,
  maxConcurrentStreams: 8,
  concurrencyErrorMessage: 'too many streams',
})

const readSseEvents = async (response: Response): Promise<Array<Record<string, any>>> => {
  const text = await response.text()
  return text
    .split('\n\n')
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith('data:'))
    .map((chunk) => JSON.parse(chunk.replace(/^data:\s*/, '')))
}

const answerOutcome = (overrides: Record<string, unknown> = {}) => ({
  delivered: false,
  truncated: false,
  reason: 'provider_content_filter',
  source: 'provider_signal',
  suspectedInterception: false,
  matchedHintId: null,
  contentLength: 15,
  signal: { finishReason: 'content_filter' },
  ...overrides,
})

afterEach(() => {
  jest.clearAllMocks()
  delete (globalThis as any).__webSearchToolResult
})

describe('agent web search answer delivery terminal', () => {
  it('keeps a provider-blocked turn out of delivery without marking the run cancelled', async () => {
    const { events, recorder } = createTraceRecorder()
    const hint = '抱歉，我不能协助完成这个请求。'
    runOrchestration.mockImplementation(async (params) => {
      await params.onFirstResponseEvent?.()
      await params.onContentDelta?.(hint)
      await params.onUsage?.(
        { prompt_tokens: 120, completion_tokens: 8 },
        { iteration: 0, attempt: 1, toolsEnabled: true },
      )
      return {
        status: 'answer_not_delivered',
        content: hint,
        answerOutcome: answerOutcome({ contentLength: hint.length }) as any,
        usage: { prompt_tokens: 120, completion_tokens: 8 },
        messages: [],
        reasoningChunks: [],
        toolSchema: 'tools',
        stopReason: null,
        finalAnswerGenerated: false,
      } as any
    })

    const response = await createAgentWebSearchResponse(baseParams(101, recorder) as any)
    const sse = await readSseEvents(response)
    const complete = sse.find((event) => event.type === 'complete')!

    expect(complete.content).toBe(hint)
    expect(complete.finalAnswerGenerated).toBe(false)
    expect(complete.stopReason).toBeUndefined()
    expect(sse.some((event) => event.type === 'error')).toBe(false)

    const outcomeEvent = events.find((event) => event.event === 'agent:answer_outcome')!
    expect(outcomeEvent.payload).toMatchObject({
      delivered: false,
      reason: 'provider_content_filter',
      source: 'provider_signal',
      stopReason: null,
      contentLength: hint.length,
    })
    expect(JSON.stringify(outcomeEvent.payload).includes(hint)).toBe(false)

    const usageEvent = events.find((event) => event.event === 'agent:provider_usage')!
    expect(usageEvent.payload).toMatchObject({
      iteration: 0,
      attempt: 1,
      toolsEnabled: true,
      prompt: 120,
      completion: 8,
      total: 128,
    })

    const firstContentEvent = events.find((event) => event.event === 'agent:first_visible_content')!
    expect(typeof firstContentEvent.payload.elapsedMs).toBe('number')
    expect(firstContentEvent.payload).toMatchObject({ length: hint.length, iteration: 0 })
    expect(JSON.stringify(firstContentEvent.payload).includes(hint)).toBe(false)

    expect(recorder.finalize).toHaveBeenCalledWith('completed', expect.anything())
  })

  it('counts one usage snapshot per round and keeps round totals separate from the billed last round', async () => {
    const { recorder } = createTraceRecorder()
    runOrchestration.mockImplementation(async (params) => {
      // 同一轮的两份快照：后一份才完整，不得相加
      await params.onUsage?.(
        { prompt_tokens: 100, completion_tokens: 4 },
        { iteration: 0, attempt: 1, toolsEnabled: true },
      )
      await params.onUsage?.(
        { prompt_tokens: 130, completion_tokens: 9 },
        { iteration: 0, attempt: 1, toolsEnabled: true },
      )
      await params.onUsage?.(
        { prompt_tokens: 200, completion_tokens: 20 },
        { iteration: 1, attempt: 1, toolsEnabled: false },
      )
      return {
        status: 'completed',
        content: '2026 年 3 月 5 日，某媒体发布财报。',
        answerOutcome: answerOutcome({
          delivered: true,
          reason: null,
          source: 'none',
          contentLength: 22,
          signal: { finishReason: 'stop' },
        }) as any,
        usage: { prompt_tokens: 200, completion_tokens: 20 },
        messages: [],
        reasoningChunks: [],
        toolSchema: 'tools',
        stopReason: null,
        finalAnswerGenerated: true,
      } as any
    })

    const response = await createAgentWebSearchResponse(baseParams(102, recorder) as any)
    const sse = await readSseEvents(response)
    const complete = sse.find((event) => event.type === 'complete')!

    // 正常交付沿用既有 SSE：不带 finalAnswerGenerated=false，也不带 stopReason
    expect(complete.finalAnswerGenerated).not.toBe(false)
    expect(complete.stopReason).toBeUndefined()
    expect(complete.usage).toMatchObject({ prompt_tokens: 200, completion_tokens: 20 })

    const usageEvents = (recorder.log as jest.Mock).mock.calls
      .filter((call) => call[0] === 'agent:provider_usage')
      .map((call) => call[1])
    expect(usageEvents).toHaveLength(2)
    expect(usageEvents[0]).toMatchObject({ iteration: 0, attempt: 1, prompt: 130, completion: 9 })
    expect(usageEvents[1]).toMatchObject({ iteration: 1, attempt: 1, prompt: 200, completion: 20 })

    const finalizeMetadata = (recorder.finalize as jest.Mock).mock.calls[0][1].metadata
    expect(finalizeMetadata.providerUsageRounds).toBe(2)
    expect(finalizeMetadata.providerUsageTotals).toMatchObject({ prompt: 330, completion: 29 })

    const outcomeEvent = (recorder.log as jest.Mock).mock.calls.find(
      (call) => call[0] === 'agent:answer_outcome',
    )
    expect(outcomeEvent[1]).toMatchObject({ delivered: true, finalAnswerGenerated: true })
  })

  it('keeps the original non-delivered text visible when the provider streams no deltas', async () => {
    const { events, recorder } = createTraceRecorder()
    const hint = '作为AI语言模型，我无法访问互联网。'
    runOrchestration.mockImplementation(async () => ({
      status: 'answer_not_delivered',
      content: hint,
      answerOutcome: answerOutcome({
        reason: 'fixed_hint_phrase',
        source: 'content_hint',
        suspectedInterception: true,
        matchedHintId: 'zh-ai-cannot-browse',
        contentLength: hint.length,
        signal: {},
      }) as any,
      usage: null,
      messages: [],
      reasoningChunks: [],
      toolSchema: 'tools',
      stopReason: null,
      finalAnswerGenerated: false,
    }) as any)

    const response = await createAgentWebSearchResponse(baseParams(104, recorder) as any)
    const sse = await readSseEvents(response)
    const contentEvents = sse.filter((event) => event.type === 'content')
    const complete = sse.find((event) => event.type === 'complete')!

    expect(contentEvents.map((event) => event.content).join('')).toBe(hint)
    expect(complete.content).toBe(hint)
    expect(complete.finalAnswerGenerated).toBe(false)

    const outcomeEvent = events.find((event) => event.event === 'agent:answer_outcome')!
    expect(outcomeEvent.payload).toMatchObject({
      delivered: false,
      reason: 'fixed_hint_phrase',
      suspectedInterception: true,
      matchedHintId: 'zh-ai-cannot-browse',
    })
    // 固定话术只归类，不自动换模型、不重试
    expect(runOrchestration).toHaveBeenCalledTimes(1)
  })

  it('ends the retrieval chain from the machine-readable outcome without a second provider request', async () => {
    const { events, recorder } = createTraceRecorder()
    ;(globalThis as any).__webSearchToolResult = {
      web_search: {
        toolCallId: 'call_1',
        toolName: 'web_search',
        message: {
          role: 'tool',
          tool_call_id: 'call_1',
          name: 'web_search',
          content: JSON.stringify({
            retrievalOutcome: { status: 'failed', reason: 'all_sources_cooling_down' },
          }),
        },
      },
    }
    let chainEnd: unknown = 'not-called'
    runOrchestration.mockImplementation(async (params) => {
      await params.handleToolCall?.(
        'web_search',
        { id: 'call_1', function: { name: 'web_search', arguments: '{}' } } as any,
        {},
        0,
      )
      chainEnd = params.shouldEndToolChain?.({ toolNames: ['web_search'] }) ?? null
      // 编排对「来源提前用尽」不给 stopReason：无证据即未交付
      return {
        status: 'stopped_without_answer',
        content: '',
        usage: null,
        messages: [],
        reasoningChunks: [],
        toolSchema: 'tools',
        stopReason: null,
        finalAnswerGenerated: false,
        answerOutcome: null,
      } as any
    })

    const response = await createAgentWebSearchResponse(baseParams(105, recorder) as any)
    const sse = await readSseEvents(response)
    const complete = sse.find((event) => event.type === 'complete')!

    expect(chainEnd).toEqual({ cause: 'sources_cooling_down' })
    const chainEndEvent = events.find((event) => event.event === 'agent:retrieval_chain_ended')!
    expect(chainEndEvent.payload).toMatchObject({
      cause: 'sources_cooling_down',
      iteration: 0,
      retrievalRounds: 1,
      retrievalEvidenceRounds: 0,
    })
    expect(complete.finalAnswerGenerated).toBe(false)
    // 提前来源耗尽不冒充全局预算：SSE 不带 stopReason
    expect(complete.stopReason).toBeUndefined()
    expect(runOrchestration).toHaveBeenCalledTimes(1)
    expect(sse.some((event) => event.type === 'error')).toBe(false)
  })

  it('does not end the chain when the same round also ran read_url', async () => {
    const { events, recorder } = createTraceRecorder()
    const webSearchResult = {
      message: {
        role: 'tool',
        tool_call_id: 'call_search',
        name: 'web_search',
        content: JSON.stringify({
          retrievalOutcome: { status: 'failed', reason: 'all_sources_cooling_down' },
        }),
      },
    }
    const readUrlResult = {
      message: {
        role: 'tool',
        tool_call_id: 'call_read',
        name: 'read_url',
        content: '网页正文：该公司发布了 2026 年第一季度财报。',
      },
    }
    ;(globalThis as any).__webSearchToolResult = {
      web_search: webSearchResult,
      read_url: readUrlResult,
    }
    let chainEnd: unknown = 'not-called'
    runOrchestration.mockImplementation(async (params) => {
      await params.handleToolCall?.(
        'web_search',
        { id: 'call_search', function: { name: 'web_search', arguments: '{}' } } as any,
        {},
        0,
      )
      await params.handleToolCall?.(
        'read_url',
        { id: 'call_read', function: { name: 'read_url', arguments: '{}' } } as any,
        {},
        0,
      )
      chainEnd = params.shouldEndToolChain?.({ toolNames: ['web_search', 'read_url'] }) ?? null
      return {
        status: 'completed',
        content: '基于 read_url 正文的回答',
        answerOutcome: answerOutcome({
          delivered: true,
          reason: null,
          source: 'none',
          contentLength: 15,
          signal: { finishReason: 'stop' },
        }) as any,
        usage: null,
        messages: [],
        reasoningChunks: [],
        toolSchema: 'tools',
        stopReason: null,
        finalAnswerGenerated: true,
      } as any
    })

    const response = await createAgentWebSearchResponse(baseParams(106, recorder) as any)
    const sse = await readSseEvents(response)
    const complete = sse.find((event) => event.type === 'complete')!

    expect(chainEnd).toBeNull()
    expect(events.some((event) => event.event === 'agent:retrieval_chain_ended')).toBe(false)
    expect(complete.content).toBe('基于 read_url 正文的回答')
  })

  it('does not count a failed read_url as retained evidence', async () => {
    const { recorder } = createTraceRecorder()
    ;(globalThis as any).__webSearchToolResult = {
      read_url: {
        message: {
          role: 'tool',
          tool_call_id: 'call_read',
          name: 'read_url',
          content: JSON.stringify({
            url: 'https://example.com/a',
            retrievalOutcome: { status: 'failed', reason: 'read_failed' },
            evidenceSummary: { source: 'origin', results: 0, read: 0, readFailed: 1 },
          }),
        },
      },
    }
    let retained: unknown = 'not-called'
    runOrchestration.mockImplementation(async (params) => {
      await params.handleToolCall?.(
        'read_url',
        { id: 'call_read', function: { name: 'read_url', arguments: '{}' } } as any,
        {},
        0,
      )
      retained = params.hasRetainedEvidence?.()
      return {
        status: 'stopped_without_answer',
        content: '',
        usage: null,
        messages: [],
        reasoningChunks: [],
        toolSchema: 'tools',
        stopReason: null,
        finalAnswerGenerated: false,
        answerOutcome: null,
      } as any
    })

    const response = await createAgentWebSearchResponse(baseParams(107, recorder) as any)
    // 必须先消费流再断言：编排在 ReadableStream.start() 里执行
    await readSseEvents(response)
    expect(runOrchestration).toHaveBeenCalledTimes(1)
    expect(retained).toBe(false)
  })

  it('counts a successful read_url body as retained evidence', async () => {
    const { recorder } = createTraceRecorder()
    const summary = JSON.stringify({
      source: 'origin',
      queries: [],
      results: 1,
      read: 1,
      readFailed: 0,
    })
    ;(globalThis as any).__webSearchToolResult = {
      read_url: {
        message: {
          role: 'tool',
          tool_call_id: 'call_read',
          name: 'read_url',
          content: `正文：该公司发布了财报。\n\n## 检索摘要\n${summary}`,
        },
      },
    }
    let retained: unknown = 'not-called'
    runOrchestration.mockImplementation(async (params) => {
      await params.handleToolCall?.(
        'read_url',
        { id: 'call_read', function: { name: 'read_url', arguments: '{}' } } as any,
        {},
        0,
      )
      retained = params.hasRetainedEvidence?.()
      return {
        status: 'stopped_without_answer',
        content: '',
        usage: null,
        messages: [],
        reasoningChunks: [],
        toolSchema: 'tools',
        stopReason: null,
        finalAnswerGenerated: false,
        answerOutcome: null,
      } as any
    })

    const response = await createAgentWebSearchResponse(baseParams(108, recorder) as any)
    // 必须先消费流再断言：编排在 ReadableStream.start() 里执行
    await readSseEvents(response)
    expect(runOrchestration).toHaveBeenCalledTimes(1)
    expect(retained).toBe(true)
  })

  it('reports cancellation without emitting a provider error or an answer outcome', async () => {
    const { events, recorder } = createTraceRecorder()
    runOrchestration.mockImplementation(async () => {
      // 客户端取消：先置取消标记，再让编排按取消抛错
      streamMetaStore.cancelAllStreamsForSession(103)
      throw new Error('Agent stream cancelled by client')
    })

    const response = await createAgentWebSearchResponse(baseParams(103, recorder) as any)
    const sse = await readSseEvents(response)

    expect(sse.some((event) => event.type === 'error')).toBe(false)
    expect(events.some((event) => event.event === 'stream:cancelled')).toBe(true)
    expect(events.some((event) => event.event === 'agent:answer_outcome')).toBe(false)
    expect(recorder.finalize).toHaveBeenCalledWith('cancelled', expect.anything())
  })
})
