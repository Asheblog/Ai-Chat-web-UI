import { runToolOrchestration } from '../tool-orchestrator'
import {
  buildNonStreamResponseLike,
  buildPythonToolDefinition,
  buildToolCallTurnResponse,
  buildToolHandlerResult,
} from './fixtures/tool-stop-fixtures'

describe('tool-orchestrator stop tools', () => {
  it('lets in-flight tools finish, dispatches nothing further and closes with a tool-free turn', async () => {
    let stopRequested = false
    const executed: string[] = []
    const capturedRequests: Array<{ toolsEnabled: boolean; messages: any[] }> = []

    const result = await runToolOrchestration({
      provider: 'openai',
      requestData: {},
      initialMessages: [{ role: 'user', content: '查一下' }],
      toolDefinitions: [buildPythonToolDefinition()],
      allowedToolNames: new Set<string>(['python_runner']),
      maxIterations: 4,
      stream: false,
      shouldStopTools: () => stopRequested,
      requestTurn: async ({ messages, toolsEnabled }) => {
        capturedRequests.push({ toolsEnabled, messages: JSON.parse(JSON.stringify(messages)) })
        if (capturedRequests.length === 1) {
          return buildToolCallTurnResponse([
            { id: 'call_a', name: 'python_runner', args: { code: 'print(1)' } },
            { id: 'call_b', name: 'python_runner', args: { code: 'print(2)' } },
          ])
        }
        return buildNonStreamResponseLike('final answer')
      },
      handleToolCall: async (_toolName, toolCall) => {
        executed.push(toolCall.id as string)
        // 用户在中途按下「停止工具」：在途工具必须自然结束
        stopRequested = true
        return buildToolHandlerResult(toolCall.id as string) as any
      },
    })

    expect(executed).toEqual(['call_a', 'call_b'])
    expect(capturedRequests).toHaveLength(2)
    expect(capturedRequests[1].toolsEnabled).toBe(false)
    expect(capturedRequests[1].messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'tool', tool_call_id: 'call_a' }),
        expect.objectContaining({ role: 'tool', tool_call_id: 'call_b' }),
      ]),
    )
    expect(result.status).toBe('completed')
    expect(result.content).toBe('final answer')
    expect(result.stopReason).toBe('stop_tools')
    expect(result.finalAnswerGenerated).toBe(true)
  })


  it('does not dispatch a round that arrived after the stop request and pairs the announced calls', async () => {
    let stopRequested = false
    const handleToolCall = jest.fn(async (_toolName: string, toolCall: any) =>
      buildToolHandlerResult(toolCall.id),
    )
    const skipped: Array<{ toolName: string; reason: string; id?: string }> = []
    const capturedRequests: Array<{ toolsEnabled: boolean; messages: any[] }> = []

    const result = await runToolOrchestration({
      provider: 'openai',
      requestData: {},
      initialMessages: [{ role: 'user', content: '查一下' }],
      toolDefinitions: [buildPythonToolDefinition()],
      allowedToolNames: new Set<string>(['python_runner']),
      maxIterations: 4,
      stream: false,
      shouldStopTools: () => stopRequested,
      onToolCallSkipped: ({ toolCall, toolName, reason }) => {
        skipped.push({ toolName, reason, id: toolCall.id })
      },
      requestTurn: async ({ messages, toolsEnabled }) => {
        capturedRequests.push({ toolsEnabled, messages: JSON.parse(JSON.stringify(messages)) })
        if (capturedRequests.length === 1) {
          stopRequested = true
          return buildToolCallTurnResponse([
            { id: 'call_late', name: 'python_runner', args: { code: 'print(1)' } },
          ])
        }
        return buildNonStreamResponseLike('answer without tools')
      },
      handleToolCall,
    })

    expect(handleToolCall).not.toHaveBeenCalled()
    expect(skipped).toEqual([{ toolName: 'python_runner', reason: 'stop_tools', id: 'call_late' }])
    expect(capturedRequests[1].toolsEnabled).toBe(false)
    const closingMessages = capturedRequests[1].messages
    expect(
      closingMessages.some(
        (message) => message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length === 1,
      ),
    ).toBe(true)
    const paired = closingMessages.find((message) => message.role === 'tool' && message.tool_call_id === 'call_late')
    expect(paired).toBeDefined()
    expect(JSON.parse(paired.content)).toMatchObject({ status: 'aborted', reason: 'stop_tools' })
    expect(result.status).toBe('completed')
    expect(result.stopReason).toBe('stop_tools')
    expect(result.finalAnswerGenerated).toBe(true)
  })


  it('marks calls from the closing turn as not executed and stops without a further request', async () => {
    let stopRequested = false
    const executed: string[] = []
    const skipped: string[] = []
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
      onToolCallSkipped: ({ toolCall }) => {
        skipped.push(toolCall.id as string)
      },
      requestTurn: async ({ toolsEnabled }) => {
        requestCount += 1
        if (requestCount === 1) {
          return buildToolCallTurnResponse([{ id: 'call_a', name: 'python_runner', args: { code: '1' } }])
        }
        expect(toolsEnabled).toBe(false)
        // 收尾轮不携带 tools，但模型仍返回 tool_calls：只标未执行
        return buildToolCallTurnResponse([{ id: 'call_c', name: 'python_runner', args: { code: '2' } }])
      },
      handleToolCall: async (_toolName, toolCall) => {
        executed.push(toolCall.id as string)
        stopRequested = true
        return buildToolHandlerResult(toolCall.id as string) as any
      },
    })

    expect(executed).toEqual(['call_a'])
    expect(skipped).toEqual(['call_c'])
    expect(requestCount).toBe(2)
    expect(result.status).toBe('stopped_without_answer')
    expect(result.content).toBe('')
    expect(result.stopReason).toBe('stop_tools')
    expect(result.finalAnswerGenerated).toBe(false)
    const assistantCalls = result.messages.filter(
      (message) => message.role === 'assistant' && Array.isArray(message.tool_calls),
    )
    expect(assistantCalls).toHaveLength(2)
    const closingPaired = result.messages.find(
      (message) => message.role === 'tool' && message.tool_call_id === 'call_c',
    )
    expect(closingPaired).toBeDefined()
    expect(JSON.parse(closingPaired.content)).toMatchObject({ status: 'aborted' })
  })


  it('reports no final answer instead of throwing when the closing turn produces no text', async () => {
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
      emptyContentErrorMessage: 'Model finished without producing a final answer',
      shouldStopTools: () => stopRequested,
      requestTurn: async () => {
        requestCount += 1
        if (requestCount === 1) {
          return buildToolCallTurnResponse([{ id: 'call_a', name: 'python_runner', args: { code: '1' } }])
        }
        return buildNonStreamResponseLike('')
      },
      handleToolCall: async (_toolName, toolCall) => {
        stopRequested = true
        return buildToolHandlerResult(toolCall.id as string) as any
      },
    })

    expect(requestCount).toBe(2)
    expect(result.status).toBe('stopped_without_answer')
    expect(result.content).toBe('')
    expect(result.finalAnswerGenerated).toBe(false)
  })


  it('gives a real cancel priority over the stop-tools closing turn', async () => {
    let stopRequested = false
    let cancelled = false
    let requestCount = 0

    await expect(
      runToolOrchestration({
        provider: 'openai',
        requestData: {},
        initialMessages: [{ role: 'user', content: '查一下' }],
        toolDefinitions: [buildPythonToolDefinition()],
        allowedToolNames: new Set<string>(['python_runner']),
        maxIterations: 4,
        stream: false,
        shouldStopTools: () => stopRequested,
        checkAbort: () => {
          if (cancelled) throw new Error('Agent stream cancelled by client')
        },
        requestTurn: async () => {
          requestCount += 1
          return buildToolCallTurnResponse([{ id: 'call_a', name: 'python_runner', args: { code: '1' } }])
        },
        handleToolCall: async (_toolName, toolCall) => {
          stopRequested = true
          cancelled = true
          return buildToolHandlerResult(toolCall.id as string) as any
        },
      }),
    ).rejects.toThrow('cancelled')

    expect(requestCount).toBe(1)
  })


  it('honours a stop request that arrives before the first turn', async () => {
    let requestCount = 0
    let capturedToolsEnabled: boolean | null = null
    const handleToolCall = jest.fn(async (_toolName: string, toolCall: any) =>
      buildToolHandlerResult(toolCall.id),
    )

    const result = await runToolOrchestration({
      provider: 'openai',
      requestData: {},
      initialMessages: [{ role: 'user', content: '查一下' }],
      toolDefinitions: [buildPythonToolDefinition()],
      allowedToolNames: new Set<string>(['python_runner']),
      maxIterations: 4,
      stream: false,
      shouldStopTools: () => true,
      requestTurn: async ({ toolsEnabled }) => {
        requestCount += 1
        capturedToolsEnabled = toolsEnabled
        return buildNonStreamResponseLike('answer without any tool')
      },
      handleToolCall,
    })

    expect(requestCount).toBe(1)
    expect(capturedToolsEnabled).toBe(false)
    expect(handleToolCall).not.toHaveBeenCalled()
    expect(result.status).toBe('completed')
    expect(result.content).toBe('answer without any tool')
    expect(result.stopReason).toBe('stop_tools')
  })

})
