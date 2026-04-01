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

  it('retries current turn when onTurnError asks for retry', async () => {
    let requestCount = 0
    const result = await runToolOrchestration({
      provider: 'openai',
      requestData: {},
      initialMessages: [{ role: 'user', content: 'hello' }],
      toolDefinitions: [],
      allowedToolNames: new Set<string>(),
      maxIterations: 1,
      stream: false,
      requestTurn: async () => {
        requestCount += 1
        if (requestCount === 1) {
          return {
            ok: false,
            status: 400,
            text: async () => 'maximum context length is 1000 tokens, however you requested 2500 tokens',
          } as any
        }
        return buildNonStreamResponseLike('retry success')
      },
      onTurnError: async (params) =>
        String((params.error as any)?.message || '').includes('maximum context length'),
      handleToolCall: async () => null,
    })

    expect(result.status).toBe('completed')
    expect(result.content).toBe('retry success')
    expect(requestCount).toBe(2)
  })

  it('normalizes assistant tool-call message content to null when model emits empty content', async () => {
    let requestCount = 0
    const result = await runToolOrchestration({
      provider: 'openai',
      requestData: {},
      initialMessages: [{ role: 'user', content: '查一下新闻' }],
      toolDefinitions: [buildPythonToolDefinition()],
      allowedToolNames: new Set<string>(['python_runner']),
      maxIterations: 1,
      stream: false,
      requestTurn: async () => {
        requestCount += 1
        if (requestCount === 1) {
          return buildToolCallTurnResponse('python_runner', { code: 'print("hello")' }, 'call_empty_content')
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
          content: JSON.stringify({ stdout: 'hello' }),
        },
      }),
    })

    expect(result.status).toBe('completed')
    const assistantToolCallMessage = result.messages.find(
      (msg) => msg?.role === 'assistant' && Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0,
    )
    expect(assistantToolCallMessage).toBeDefined()
    expect(assistantToolCallMessage?.content).toBeNull()
  })

  it('appends tool followup messages into next tool turn context', async () => {
    const capturedMessages: any[][] = []
    let requestCount = 0

    const result = await runToolOrchestration({
      provider: 'openai',
      requestData: {},
      initialMessages: [{ role: 'user', content: '请读图' }],
      toolDefinitions: [buildPythonToolDefinition()],
      allowedToolNames: new Set<string>(['python_runner']),
      maxIterations: 1,
      stream: false,
      requestTurn: async ({ messages }) => {
        capturedMessages.push(JSON.parse(JSON.stringify(messages)))
        requestCount += 1
        if (requestCount === 1) {
          return buildToolCallTurnResponse('python_runner', { code: 'print("ok")' }, 'call_followup')
        }
        return buildNonStreamResponseLike('done')
      },
      handleToolCall: async (_toolName, toolCall) => ({
        toolCallId: toolCall.id || 'call_followup',
        toolName: 'python_runner',
        message: {
          role: 'tool',
          tool_call_id: toolCall.id || 'call_followup',
          name: 'python_runner',
          content: JSON.stringify({ stdout: 'ok' }),
        },
        followupMessages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: '请结合图片继续回答。' },
              { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA=' } },
            ],
          },
        ],
      }),
    })

    expect(result.status).toBe('completed')
    expect(capturedMessages).toHaveLength(2)
    expect(capturedMessages[1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: [
            { type: 'text', text: '请结合图片继续回答。' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA=' } },
          ],
        }),
      ]),
    )
  })
})
