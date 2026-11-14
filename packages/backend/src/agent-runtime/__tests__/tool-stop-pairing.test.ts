import { runToolOrchestration } from '../tool-orchestrator'
import {
  buildNonStreamResponseLike,
  buildPythonToolDefinition,
  buildToolCallTurnResponse,
  buildToolHandlerResult,
} from './fixtures/tool-stop-fixtures'

describe('tool-orchestrator stop tools: terminal outcome and skipped pairing', () => {
  it('does not label a run stopped when the final answer was already produced', async () => {
    let stopRequested = false
    let requestCount = 0

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
        requestCount += 1
        // 作答流式期间才收到停止请求
        stopRequested = true
        return buildNonStreamResponseLike('完整的最终回答')
      },
      handleToolCall: async () => null,
    })

    expect(requestCount).toBe(1)
    expect(result.status).toBe('completed')
    expect(result.content).toBe('完整的最终回答')
    expect(result.stopReason).toBeNull()
    expect(result.finalAnswerGenerated).toBe(true)
  })


  it('pairs skipped text-schema calls with a tool-result message', async () => {
    let stopRequested = false
    let requestCount = 0
    const handleToolCall = jest.fn(async (_toolName: string, toolCall: any) =>
      buildToolHandlerResult(toolCall.id),
    )

    const result = await runToolOrchestration({
      provider: 'anthropic',
      requestData: { tool_schema: 'text' },
      initialMessages: [{ role: 'user', content: '查一下' }],
      toolDefinitions: [buildPythonToolDefinition()],
      allowedToolNames: new Set<string>(['python_runner']),
      maxIterations: 4,
      stream: false,
      shouldStopTools: () => stopRequested,
      requestTurn: async () => {
        requestCount += 1
        if (requestCount === 1) {
          stopRequested = true
          return buildToolCallTurnResponse([{ id: 'call_text', name: 'python_runner', args: { code: '1' } }])
        }
        return buildNonStreamResponseLike('text schema answer')
      },
      handleToolCall,
    })

    expect(handleToolCall).not.toHaveBeenCalled()
    const paired = result.messages.find(
      (message) => message.role === 'user' && String(message.content).startsWith('工具结果(python_runner):'),
    )
    expect(paired).toBeDefined()
    expect(JSON.parse(String(paired.content).replace('工具结果(python_runner): ', ''))).toMatchObject({
      status: 'aborted',
    })
    expect(result.status).toBe('completed')
    expect(result.stopReason).toBe('stop_tools')
  })


  it('pairs skipped functions-schema calls with a function result message', async () => {
    let stopRequested = false
    let requestCount = 0
    const handleToolCall = jest.fn(async (_toolName: string, toolCall: any) =>
      buildToolHandlerResult(toolCall.id),
    )

    const result = await runToolOrchestration({
      provider: 'openai',
      requestData: { tool_schema: 'functions' },
      initialMessages: [{ role: 'user', content: '查一下' }],
      toolDefinitions: [buildPythonToolDefinition()],
      allowedToolNames: new Set<string>(['python_runner']),
      maxIterations: 4,
      stream: false,
      shouldStopTools: () => stopRequested,
      requestTurn: async () => {
        requestCount += 1
        if (requestCount === 1) {
          stopRequested = true
          return buildToolCallTurnResponse([{ id: 'call_fn', name: 'python_runner', args: { code: '1' } }])
        }
        return buildNonStreamResponseLike('functions schema answer')
      },
      handleToolCall,
    })

    expect(handleToolCall).not.toHaveBeenCalled()
    const paired = result.messages.find(
      (message) => message.role === 'function' && message.name === 'python_runner',
    )
    expect(paired).toBeDefined()
    expect(JSON.parse(paired.content)).toMatchObject({ status: 'aborted' })
    expect(result.status).toBe('completed')
  })
})
