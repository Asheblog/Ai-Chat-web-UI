import { runToolOrchestration } from '../tool-orchestrator'
import {
  buildNonStreamResponseLike,
  buildPythonToolDefinition,
  buildToolCallTurnResponse,
  buildToolHandlerResult,
} from './fixtures/tool-stop-fixtures'

const CANCEL_MESSAGE = 'Agent stream cancelled by client'

describe('tool-orchestrator retrieval chain end', () => {
  it('ends the chain after the round and spends exactly one tool-free closing turn when evidence exists', async () => {
    let requestCount = 0
    const toolsEnabledSeen: boolean[] = []
    let chainEndChecks = 0

    const result = await runToolOrchestration({
      provider: 'openai',
      requestData: {},
      initialMessages: [{ role: 'user', content: '查一下最近的新闻' }],
      toolDefinitions: [buildPythonToolDefinition()],
      allowedToolNames: new Set<string>(['web_search']),
      maxIterations: 6,
      stream: false,
      hasRetainedEvidence: () => true,
      shouldEndToolChain: () => {
        chainEndChecks += 1
        return chainEndChecks === 1 ? { cause: 'sources_cooling_down' } : null
      },
      requestTurn: async ({ toolsEnabled }) => {
        requestCount += 1
        toolsEnabledSeen.push(toolsEnabled)
        if (requestCount === 1) {
          return buildToolCallTurnResponse([
            { id: 'call_a', name: 'web_search', args: { query: 'a' } },
          ])
        }
        return buildNonStreamResponseLike('基于已有证据的回答')
      },
      handleToolCall: async (_toolName, toolCall) =>
        buildToolHandlerResult(toolCall.id as string, 'web_search') as any,
    })

    // 第二轮必须是无工具收尾，且只请求了这一次收尾
    expect(toolsEnabledSeen).toEqual([true, false])
    expect(requestCount).toBe(2)
    expect(result.status).toBe('completed')
    expect(result.content).toBe('基于已有证据的回答')
    // 提前来源耗尽不是全局预算：有证据收尾成功走正常完成，不写 stopReason
    expect(result.stopReason).toBeNull()
  })

  it('stops without any further request when the chain ends and no evidence was retained', async () => {
    let requestCount = 0

    const result = await runToolOrchestration({
      provider: 'openai',
      requestData: {},
      initialMessages: [{ role: 'user', content: '查一下最近的新闻' }],
      toolDefinitions: [buildPythonToolDefinition()],
      allowedToolNames: new Set<string>(['web_search']),
      maxIterations: 6,
      stream: false,
      hasRetainedEvidence: () => false,
      shouldEndToolChain: () => ({ cause: 'no_active_engine' }),
      requestTurn: async () => {
        requestCount += 1
        return buildToolCallTurnResponse([
          { id: `call_${requestCount}`, name: 'web_search', args: { query: 'a' } },
        ])
      },
      handleToolCall: async (_toolName, toolCall) =>
        buildToolHandlerResult(toolCall.id as string, 'web_search') as any,
    })

    expect(requestCount).toBe(1)
    expect(result.status).toBe('stopped_without_answer')
    // 无证据时沿用现有 finalAnswerGenerated=false，且不带 stopReason
    expect(result.stopReason).toBeNull()
    expect(result.finalAnswerGenerated).toBe(false)
  })

  it('lets a cancellation beat the chain closing turn', async () => {
    let cancelled = false
    let requestCount = 0

    await expect(
      runToolOrchestration({
        provider: 'openai',
        requestData: {},
        initialMessages: [{ role: 'user', content: '查一下' }],
        toolDefinitions: [buildPythonToolDefinition()],
        allowedToolNames: new Set<string>(['web_search']),
        maxIterations: 6,
        stream: false,
        hasRetainedEvidence: () => true,
        shouldEndToolChain: () => ({ cause: 'repeated_no_progress' }),
        checkAbort: () => {
          if (cancelled) throw new Error(CANCEL_MESSAGE)
        },
        requestTurn: async () => {
          requestCount += 1
          return buildToolCallTurnResponse([
            { id: `call_${requestCount}`, name: 'web_search', args: { query: 'a' } },
          ])
        },
        handleToolCall: async (_toolName, toolCall) => {
          cancelled = true
          return buildToolHandlerResult(toolCall.id as string, 'web_search') as any
        },
      }),
    ).rejects.toThrow(CANCEL_MESSAGE)

    expect(requestCount).toBe(1)
  })

  it('hands the whole round tool list to the chain predicate', async () => {
    const seenToolNames: string[][] = []
    let requestCount = 0

    await runToolOrchestration({
      provider: 'openai',
      requestData: {},
      initialMessages: [{ role: 'user', content: '查一下' }],
      toolDefinitions: [buildPythonToolDefinition()],
      allowedToolNames: new Set<string>(['web_search', 'read_url']),
      maxIterations: 3,
      stream: false,
      hasRetainedEvidence: () => true,
      shouldEndToolChain: ({ toolNames }) => {
        seenToolNames.push(toolNames)
        return null
      },
      requestTurn: async () => {
        requestCount += 1
        if (requestCount === 1) {
          return buildToolCallTurnResponse([
            { id: 'call_a', name: 'web_search', args: { query: 'a' } },
            { id: 'call_b', name: 'read_url', args: { url: 'https://example.com' } },
          ])
        }
        return buildNonStreamResponseLike('最终回答')
      },
      handleToolCall: async (_toolName, toolCall) =>
        buildToolHandlerResult(toolCall.id as string, _toolName) as any,
    })

    expect(seenToolNames).toEqual([['web_search', 'read_url']])
  })

  it('keeps dispatching while the chain has not ended', async () => {
    let requestCount = 0
    const toolsEnabledSeen: boolean[] = []

    const result = await runToolOrchestration({
      provider: 'openai',
      requestData: {},
      initialMessages: [{ role: 'user', content: '查一下' }],
      toolDefinitions: [buildPythonToolDefinition()],
      allowedToolNames: new Set<string>(['web_search']),
      maxIterations: 6,
      stream: false,
      hasRetainedEvidence: () => true,
      shouldEndToolChain: () => null,
      requestTurn: async ({ toolsEnabled }) => {
        requestCount += 1
        toolsEnabledSeen.push(toolsEnabled)
        if (requestCount <= 2) {
          return buildToolCallTurnResponse([
            { id: `call_${requestCount}`, name: 'web_search', args: { query: 'a' } },
          ])
        }
        return buildNonStreamResponseLike('最终回答')
      },
      handleToolCall: async (_toolName, toolCall) =>
        buildToolHandlerResult(toolCall.id as string, 'web_search') as any,
    })

    expect(toolsEnabledSeen).toEqual([true, true, true])
    expect(requestCount).toBe(3)
    expect(result.status).toBe('completed')
    expect(result.stopReason).toBeNull()
  })
})
