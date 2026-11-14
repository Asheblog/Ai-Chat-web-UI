import { runToolOrchestration } from '../tool-orchestrator'
import {
  buildNonStreamResponseLike,
  buildPythonToolDefinition,
  buildToolCallTurnResponse,
  buildToolHandlerResult,
} from './fixtures/tool-stop-fixtures'

describe('tool-orchestrator stop tools: budget', () => {
  it('closes with a tool-free turn when the tool budget is exhausted in finish mode', async () => {
    let requestCount = 0
    const capturedToolsEnabled: boolean[] = []
    const executed: string[] = []
    const skipped: string[] = []

    const result = await runToolOrchestration({
      provider: 'openai',
      requestData: {},
      initialMessages: [{ role: 'user', content: '查一下' }],
      toolDefinitions: [buildPythonToolDefinition()],
      allowedToolNames: new Set<string>(['python_runner']),
      maxIterations: 1,
      stream: false,
      onBudgetExhausted: 'finish',
      onToolCallSkipped: ({ toolCall }) => {
        skipped.push(toolCall.id as string)
      },
      requestTurn: async ({ toolsEnabled }) => {
        requestCount += 1
        capturedToolsEnabled.push(toolsEnabled)
        if (requestCount === 1) {
          return buildToolCallTurnResponse([{ id: 'call_a', name: 'python_runner', args: { code: '1' } }])
        }
        if (requestCount === 2) {
          // 预算已用完却又要求工具：这一轮不再派发，只标未执行后收尾
          return buildToolCallTurnResponse([{ id: 'call_b', name: 'python_runner', args: { code: '2' } }])
        }
        return buildNonStreamResponseLike('answer from what we have')
      },
      handleToolCall: async (_toolName, toolCall) => {
        executed.push(toolCall.id as string)
        return buildToolHandlerResult(toolCall.id as string) as any
      },
    })

    expect(requestCount).toBe(3)
    expect(capturedToolsEnabled).toEqual([true, true, false])
    expect(executed).toEqual(['call_a'])
    // 预算放弃的 tool_calls 必须留证据：通知台账 + 配对占位结果
    expect(skipped).toEqual(['call_b'])
    const paired = result.messages.find(
      (message) => message.role === 'tool' && message.tool_call_id === 'call_b',
    )
    expect(paired).toBeDefined()
    expect(JSON.parse(paired.content)).toMatchObject({
      status: 'aborted',
      reason: 'budget_exhausted',
    })
    expect(result.status).toBe('completed')
    expect(result.content).toBe('answer from what we have')
    expect(result.stopReason).toBe('budget_exhausted')
    expect(result.finalAnswerGenerated).toBe(true)
  })


  it('keeps the max_iterations status when the budget is exhausted in the default error mode', async () => {
    let requestCount = 0
    const handleToolCall = jest.fn(async (_toolName: string, toolCall: any) =>
      buildToolHandlerResult(toolCall.id),
    )

    const result = await runToolOrchestration({
      provider: 'openai',
      requestData: {},
      initialMessages: [{ role: 'user', content: '查一下' }],
      toolDefinitions: [buildPythonToolDefinition()],
      allowedToolNames: new Set<string>(['python_runner']),
      maxIterations: 1,
      stream: false,
      requestTurn: async () => {
        requestCount += 1
        if (requestCount === 1) {
          return buildToolCallTurnResponse([{ id: 'call_a', name: 'python_runner', args: { code: '1' } }])
        }
        return buildToolCallTurnResponse([{ id: 'call_b', name: 'python_runner', args: { code: '2' } }])
      },
      handleToolCall,
    })

    expect(result.status).toBe('max_iterations')
    expect(result.stopReason).toBe('budget_exhausted')
    expect(result.finalAnswerGenerated).toBe(false)
    expect(requestCount).toBe(2)
    expect(handleToolCall).toHaveBeenCalledTimes(1)
  })

})
