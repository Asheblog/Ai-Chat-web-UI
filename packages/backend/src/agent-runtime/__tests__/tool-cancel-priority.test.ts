import { runToolOrchestration } from '../tool-orchestrator'
import {
  buildNonStreamResponseLike,
  buildPythonToolDefinition,
  buildToolCallTurnResponse,
  buildToolHandlerResult,
} from './fixtures/tool-stop-fixtures'

const CANCEL_MESSAGE = 'Agent stream cancelled by client'

describe('tool-orchestrator client cancellation', () => {
  it('does not dispatch the announced tool round when the client cancels while it is generated', async () => {
    let cancelled = false
    let requestCount = 0
    const executed: string[] = []

    await expect(
      runToolOrchestration({
        provider: 'openai',
        requestData: {},
        initialMessages: [{ role: 'user', content: '查一下今天的新闻' }],
        toolDefinitions: [buildPythonToolDefinition()],
        allowedToolNames: new Set<string>(['python_runner']),
        maxIterations: 4,
        stream: false,
        checkAbort: () => {
          if (cancelled) throw new Error(CANCEL_MESSAGE)
        },
        requestTurn: async () => {
          requestCount += 1
          // 客户端在这一轮生成期间取消：这一轮已经声明的检索不得继续派发
          cancelled = true
          return buildToolCallTurnResponse([
            { id: 'call_a', name: 'web_search', args: { query: 'a' } },
            { id: 'call_b', name: 'web_search', args: { query: 'b' } },
          ])
        },
        handleToolCall: async (_toolName, toolCall) => {
          executed.push(toolCall.id as string)
          return buildToolHandlerResult(toolCall.id as string) as any
        },
      }),
    ).rejects.toThrow(CANCEL_MESSAGE)

    expect(executed).toEqual([])
    expect(requestCount).toBe(1)
  })

  it('cancels instead of spending the budget closing turn when the cancel lands on the budget decision', async () => {
    let cancelled = false
    let requestCount = 0
    const executed: string[] = []

    await expect(
      runToolOrchestration({
        provider: 'openai',
        requestData: {},
        initialMessages: [{ role: 'user', content: '查一下' }],
        toolDefinitions: [buildPythonToolDefinition()],
        allowedToolNames: new Set<string>(['python_runner']),
        maxIterations: 1,
        stream: false,
        onBudgetExhausted: 'finish',
        // 预算判定这一刻收到取消：即便有证据，也不得再发无工具收尾请求
        hasRetainedEvidence: () => {
          cancelled = true
          return true
        },
        checkAbort: () => {
          if (cancelled) throw new Error(CANCEL_MESSAGE)
        },
        requestTurn: async () => {
          requestCount += 1
          return buildToolCallTurnResponse([{ id: `call_${requestCount}`, name: 'python_runner', args: {} }])
        },
        handleToolCall: async (_toolName, toolCall) => {
          executed.push(toolCall.id as string)
          return buildToolHandlerResult(toolCall.id as string) as any
        },
      }),
    ).rejects.toThrow(CANCEL_MESSAGE)

    expect(executed).toEqual(['call_1'])
    // 只有两轮生成：预算轮之后收尾轮被取消拦下
    expect(requestCount).toBe(2)
  })

  it('keeps answering normally when no cancellation arrives', async () => {
    let requestCount = 0
    const result = await runToolOrchestration({
      provider: 'openai',
      requestData: {},
      initialMessages: [{ role: 'user', content: '查一下' }],
      toolDefinitions: [buildPythonToolDefinition()],
      allowedToolNames: new Set<string>(['python_runner']),
      maxIterations: 4,
      stream: false,
      checkAbort: () => {},
      requestTurn: async () => {
        requestCount += 1
        if (requestCount === 1) {
          return buildToolCallTurnResponse([{ id: 'call_a', name: 'python_runner', args: {} }])
        }
        return buildNonStreamResponseLike('最终回答')
      },
      handleToolCall: async (_toolName, toolCall) =>
        buildToolHandlerResult(toolCall.id as string) as any,
    })

    expect(result.status).toBe('completed')
    expect(result.content).toBe('最终回答')
    expect(requestCount).toBe(2)
  })
})
