import { runToolOrchestration } from '../tool-orchestrator'
import {
  buildNonStreamFinishResponseLike,
  buildNonStreamResponseLike,
  buildPythonToolDefinition,
  buildResponsesTurnResponseLike,
  buildToolCallTurnResponse,
  buildToolHandlerResult,
} from './fixtures/tool-stop-fixtures'

describe('tool-orchestrator answer delivery', () => {
  it('keeps a normal answer as completed', async () => {
    const result = await runToolOrchestration({
      provider: 'openai',
      requestData: {},
      initialMessages: [{ role: 'user', content: '查一下' }],
      toolDefinitions: [buildPythonToolDefinition()],
      allowedToolNames: new Set<string>(['python_runner']),
      maxIterations: 2,
      stream: false,
      requestTurn: async () => buildNonStreamFinishResponseLike('2026 年 3 月 5 日，官方发布了财报。', 'stop'),
      handleToolCall: async () => null as any,
    })

    expect(result.status).toBe('completed')
    expect(result.finalAnswerGenerated).toBe(true)
  })

  it('reports a content-filtered turn as not delivered and keeps the original text', async () => {
    const original = '这段正文其实是被上游内容过滤后的替代文本。'
    const result = await runToolOrchestration({
      provider: 'openai',
      requestData: {},
      initialMessages: [{ role: 'user', content: '查一下' }],
      toolDefinitions: [buildPythonToolDefinition()],
      allowedToolNames: new Set<string>(['python_runner']),
      maxIterations: 2,
      stream: false,
      requestTurn: async () => buildNonStreamFinishResponseLike(original, 'content_filter'),
      handleToolCall: async () => null as any,
    })

    expect(result.status).toBe('answer_not_delivered')
    expect(result.content).toBe(original)
    expect(result.finalAnswerGenerated).toBe(false)
    expect(result.stopReason).toBeNull()
    if (result.status === 'answer_not_delivered') {
      expect(result.answerOutcome).toMatchObject({
        delivered: false,
        reason: 'provider_content_filter',
        source: 'provider_signal',
        suspectedInterception: false,
        contentLength: original.length,
      })
    }
  })

  it('treats a Responses API refusal block as not delivered', async () => {
    const result = await runToolOrchestration({
      provider: 'openai_responses',
      requestData: {},
      initialMessages: [{ role: 'user', content: '查一下' }],
      toolDefinitions: [buildPythonToolDefinition()],
      allowedToolNames: new Set<string>(['python_runner']),
      maxIterations: 2,
      stream: false,
      requestTurn: async () =>
        buildResponsesTurnResponseLike({
          status: 'completed',
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'refusal', refusal: 'I cannot help with that request.' }],
            },
          ],
        }),
      handleToolCall: async () => null as any,
    })

    expect(result.status).toBe('answer_not_delivered')
    if (result.status === 'answer_not_delivered') {
      expect(result.answerOutcome.reason).toBe('provider_refusal')
    }
  })

  it('classifies a known fixed hint as suspected interception without retrying or switching models', async () => {
    const hint = '抱歉，我不能协助完成这个请求。'
    let requestCount = 0
    const result = await runToolOrchestration({
      provider: 'openai',
      requestData: {},
      initialMessages: [{ role: 'user', content: '查一下' }],
      toolDefinitions: [buildPythonToolDefinition()],
      allowedToolNames: new Set<string>(['python_runner']),
      maxIterations: 2,
      stream: false,
      requestTurn: async () => {
        requestCount += 1
        return buildNonStreamFinishResponseLike(hint, 'stop')
      },
      handleToolCall: async () => null as any,
    })

    expect(requestCount).toBe(1)
    expect(result.status).toBe('answer_not_delivered')
    expect(result.content).toBe(hint)
    if (result.status === 'answer_not_delivered') {
      expect(result.answerOutcome).toMatchObject({
        delivered: false,
        reason: 'fixed_hint_phrase',
        source: 'content_hint',
        suspectedInterception: true,
        matchedHintId: 'zh-cannot-assist',
      })
    }
  })

  it('does not report the tool-free closing turn as a delivered answer when the provider blocks it', async () => {
    let stopRequested = false
    const result = await runToolOrchestration({
      provider: 'openai',
      requestData: {},
      initialMessages: [{ role: 'user', content: '查一下' }],
      toolDefinitions: [buildPythonToolDefinition()],
      allowedToolNames: new Set<string>(['python_runner']),
      maxIterations: 4,
      stream: false,
      shouldStopTools: () => stopRequested,
      requestTurn: async () => {
        if (!stopRequested) {
          return buildToolCallTurnResponse([{ id: 'call_a', name: 'python_runner', args: {} }])
        }
        return buildNonStreamFinishResponseLike('被过滤的收尾正文', 'content_filter')
      },
      handleToolCall: async (_toolName, toolCall) => {
        stopRequested = true
        return buildToolHandlerResult(toolCall.id as string) as any
      },
    })

    expect(result.status).toBe('answer_not_delivered')
    expect(result.stopReason).toBe('stop_tools')
    expect(result.finalAnswerGenerated).toBe(false)
    expect(result.content).toBe('被过滤的收尾正文')
  })

  it('does not spend the budget closing turn when no retrieval evidence is retained', async () => {
    let requestCount = 0
    const result = await runToolOrchestration({
      provider: 'openai',
      requestData: {},
      initialMessages: [{ role: 'user', content: '查一下' }],
      toolDefinitions: [buildPythonToolDefinition()],
      allowedToolNames: new Set<string>(['python_runner']),
      maxIterations: 1,
      stream: false,
      onBudgetExhausted: 'finish',
      hasRetainedEvidence: () => false,
      requestTurn: async () => {
        requestCount += 1
        return buildToolCallTurnResponse([{ id: `call_${requestCount}`, name: 'python_runner', args: {} }])
      },
      handleToolCall: async (_toolName, toolCall) =>
        buildToolHandlerResult(toolCall.id as string) as any,
    })

    expect(requestCount).toBe(2)
    expect(result.status).toBe('stopped_without_answer')
    expect(result.stopReason).toBe('budget_exhausted')
    expect(result.finalAnswerGenerated).toBe(false)
  })

  it('allows exactly one tool-free closing turn when retrieval evidence was retained', async () => {
    let requestCount = 0
    const toolsEnabledSeen: boolean[] = []
    const result = await runToolOrchestration({
      provider: 'openai',
      requestData: {},
      initialMessages: [{ role: 'user', content: '查一下' }],
      toolDefinitions: [buildPythonToolDefinition()],
      allowedToolNames: new Set<string>(['python_runner']),
      maxIterations: 1,
      stream: false,
      onBudgetExhausted: 'finish',
      hasRetainedEvidence: () => true,
      requestTurn: async ({ toolsEnabled }) => {
        requestCount += 1
        toolsEnabledSeen.push(toolsEnabled)
        if (requestCount < 3) {
          return buildToolCallTurnResponse([{ id: `call_${requestCount}`, name: 'python_runner', args: {} }])
        }
        return buildNonStreamResponseLike('基于已有证据的回答')
      },
      handleToolCall: async (_toolName, toolCall) =>
        buildToolHandlerResult(toolCall.id as string) as any,
    })

    expect(toolsEnabledSeen).toEqual([true, true, false])
    expect(result.status).toBe('completed')
    expect(result.content).toBe('基于已有证据的回答')
    expect(result.stopReason).toBe('budget_exhausted')
  })
})
