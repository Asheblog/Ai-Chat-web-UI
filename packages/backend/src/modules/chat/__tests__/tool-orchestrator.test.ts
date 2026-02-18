import { runToolOrchestration } from '../tool-orchestrator'

const buildNonStreamResponseLike = (content: string, usage?: Record<string, unknown>) =>
  ({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        choices: [{ message: { content } }],
        usage: usage ?? { total_tokens: 1 },
      }),
  }) as any

const buildToolCallTurnResponse = (toolName: string, args: Record<string, unknown>, toolCallId = 'call_1') =>
  ({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                {
                  id: toolCallId,
                  type: 'function',
                  function: {
                    name: toolName,
                    arguments: JSON.stringify(args),
                  },
                },
              ],
            },
          },
        ],
        usage: { total_tokens: 1 },
      }),
  }) as any

const buildPythonToolDefinition = () =>
  ({
    type: 'function',
    function: {
      name: 'python_runner',
      description: 'Run Python',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string' },
        },
        required: ['code'],
      },
    },
  }) as any

describe('tool-orchestrator', () => {
  it('supports requestTurn returning a raw Response-like object', async () => {
    const result = await runToolOrchestration({
      provider: 'openai',
      requestData: {},
      initialMessages: [{ role: 'user', content: 'hello' }],
      toolDefinitions: [],
      allowedToolNames: new Set<string>(),
      maxIterations: 1,
      stream: false,
      requestTurn: async () => buildNonStreamResponseLike('hello world'),
      handleToolCall: async () => null,
    })

    expect(result.status).toBe('completed')
    expect(result.content).toBe('hello world')
  })

  it('supports requestTurn returning { response, onDone } with Response-like response', async () => {
    const onDone = jest.fn()
    const result = await runToolOrchestration({
      provider: 'openai',
      requestData: {},
      initialMessages: [{ role: 'user', content: 'hello' }],
      toolDefinitions: [],
      allowedToolNames: new Set<string>(),
      maxIterations: 1,
      stream: false,
      requestTurn: async () => ({
        response: buildNonStreamResponseLike('wrapped response'),
        onDone,
      }),
      handleToolCall: async () => null,
    })

    expect(result.status).toBe('completed')
    expect(result.content).toBe('wrapped response')
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('throws explicit error when requestTurn returns invalid result shape', async () => {
    await expect(
      runToolOrchestration({
        provider: 'openai',
        requestData: {},
        initialMessages: [{ role: 'user', content: 'hello' }],
        toolDefinitions: [],
        allowedToolNames: new Set<string>(),
        maxIterations: 1,
        stream: false,
        requestTurn: async () => ({ invalid: true } as any),
        handleToolCall: async () => null,
      }),
    ).rejects.toThrow('Tool orchestrator requestTurn must return Response')
  })

  it('allows one final answer turn after reaching a single tool round budget', async () => {
    let requestCount = 0
    const handleToolCall = jest.fn(async () => ({
      toolCallId: 'call_1',
      toolName: 'python_runner',
      message: {
        role: 'tool',
        tool_call_id: 'call_1',
        name: 'python_runner',
        content: JSON.stringify({ stdout: '1' }),
      },
    }))

    const result = await runToolOrchestration({
      provider: 'openai',
      requestData: {},
      initialMessages: [{ role: 'user', content: 'calc' }],
      toolDefinitions: [buildPythonToolDefinition()],
      allowedToolNames: new Set<string>(['python_runner']),
      maxIterations: 1,
      stream: false,
      requestTurn: async () => {
        requestCount += 1
        if (requestCount === 1) {
          return buildToolCallTurnResponse('python_runner', { code: 'print(1)' })
        }
        return buildNonStreamResponseLike('final answer')
      },
      handleToolCall,
    })

    expect(result.status).toBe('completed')
    expect(result.content).toBe('final answer')
    expect(requestCount).toBe(2)
    expect(handleToolCall).toHaveBeenCalledTimes(1)
  })

  it('preserves infinite max iterations instead of collapsing to 1', async () => {
    let requestCount = 0
    const result = await runToolOrchestration({
      provider: 'openai',
      requestData: {},
      initialMessages: [{ role: 'user', content: 'calc' }],
      toolDefinitions: [buildPythonToolDefinition()],
      allowedToolNames: new Set<string>(['python_runner']),
      maxIterations: Number.POSITIVE_INFINITY,
      stream: false,
      requestTurn: async () => {
        requestCount += 1
        if (requestCount <= 2) {
          return buildToolCallTurnResponse('python_runner', { code: `print(${requestCount})` }, `call_${requestCount}`)
        }
        return buildNonStreamResponseLike('done')
      },
      handleToolCall: async (_toolName, toolCall) => ({
        toolCallId: toolCall.id || 'call',
        toolName: 'python_runner',
        message: {
          role: 'tool',
          tool_call_id: toolCall.id || 'call',
          name: 'python_runner',
          content: JSON.stringify({ stdout: 'ok' }),
        },
      }),
    })

    expect(result.status).toBe('completed')
    expect(result.content).toBe('done')
    expect(requestCount).toBe(3)
  })
})
