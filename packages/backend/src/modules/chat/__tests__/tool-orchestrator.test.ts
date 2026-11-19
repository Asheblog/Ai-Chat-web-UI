import { runToolOrchestration } from '../../../agent-runtime/tool-orchestrator'
import { convertChatCompletionsMessagesToResponsesInput } from '../../../utils/openai-responses'

function imageRejectionResponse(): Response {
  return Response.json({ error: {
    message: 'Upstream provider: invalid_request (business code 11135): The upstream could not process an image. Replace the image and start a new conversation before retrying.',
    type: 'invalid_request_error',
  } }, { status: 400 })
}

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

function buildSseStreamResponse(events: Record<string, unknown>[]): Response {
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = events.map((e) =>
    encoder.encode(`data: ${JSON.stringify(e)}\n\n`),
  )
  chunks.push(encoder.encode('data: [DONE]\n\n'))

  let i = 0
  const stream = new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(chunks[i++])
      } else {
        controller.close()
      }
    },
  })

  return new Response(stream, { status: 200 })
}

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

  it('does not leak tool-tag prefix when tag name is split across SSE chunks', async () => {
    const deltas: string[] = []
    let requestCount = 0
    const handleToolCall = jest.fn(async (_toolName, toolCall) => ({
      toolCallId: toolCall.id || 'call_1',
      toolName: 'python_runner',
      message: {
        role: 'tool',
        tool_call_id: toolCall.id || 'call_1',
        name: 'python_runner',
        content: JSON.stringify({ stdout: '1' }),
      },
    }))

    const result = await runToolOrchestration({
      provider: 'anthropic',
      requestData: { tool_schema: 'text' },
      initialMessages: [{ role: 'user', content: 'run' }],
      toolDefinitions: [buildPythonToolDefinition()],
      allowedToolNames: new Set<string>(['python_runner']),
      maxIterations: 2,
      stream: true,
      requestTurn: async () => {
        requestCount += 1
        if (requestCount === 1) {
          return buildSseStreamResponse([
            { choices: [{ delta: { content: 'Answer: <py' } }] },
            { choices: [{ delta: { content: 'thon_runner>' } }] },
            {
              choices: [
                { delta: { content: '<code>print(1)</code></python_runner> done' } },
              ],
            },
          ])
        }
        return buildSseStreamResponse([
          { choices: [{ delta: { content: 'Result is 1' } }] },
        ])
      },
      handleToolCall,
      onContentDelta: async (delta) => {
        deltas.push(delta)
      },
    })

    expect(result.status).toBe('completed')
    expect(result.content).toBe('Result is 1')
    expect(handleToolCall).toHaveBeenCalledTimes(1)

    const allDeltas = deltas.join('')
    // Must NOT leak tag fragments
    expect(allDeltas).not.toContain('<py')
    expect(allDeltas).not.toContain('thon_runner>')
    expect(allDeltas).not.toContain('<python_runner>')
    expect(allDeltas).not.toContain('</python_runner>')
    expect(allDeltas).not.toContain('<code>')
    expect(allDeltas).not.toContain('</code>')
    // Safe text should be present
    expect(allDeltas).toContain('Answer:')
    expect(allDeltas).toContain('done')
  })

  it('does not leak tool-call XML through onContentDelta for text schema and still executes tools', async () => {
    const deltas: string[] = []
    let requestCount = 0
    const handleToolCall = jest.fn(async (_toolName, toolCall) => ({
      toolCallId: toolCall.id || 'call_1',
      toolName: 'python_runner',
      message: {
        role: 'tool',
        tool_call_id: toolCall.id || 'call_1',
        name: 'python_runner',
        content: JSON.stringify({ stdout: '42' }),
      },
    }))

    const result = await runToolOrchestration({
      provider: 'anthropic',
      requestData: { tool_schema: 'text' },
      initialMessages: [{ role: 'user', content: 'calc' }],
      toolDefinitions: [buildPythonToolDefinition()],
      allowedToolNames: new Set<string>(['python_runner']),
      maxIterations: 2,
      stream: true,
      requestTurn: async () => {
        requestCount += 1
        if (requestCount === 1) {
          return buildSseStreamResponse([
            { choices: [{ delta: { content: 'Let me check.\n<python_runner>' } }] },
            {
              choices: [
                { delta: { content: '<code>print(42)</code>\n</python_runner>\nDone.' } },
              ],
            },
          ])
        }
        return buildSseStreamResponse([
          { choices: [{ delta: { content: 'The answer is 42' } }] },
        ])
      },
      handleToolCall,
      onContentDelta: async (delta) => {
        deltas.push(delta)
      },
    })

    expect(result.status).toBe('completed')
    expect(result.content).toBe('The answer is 42')
    expect(handleToolCall).toHaveBeenCalledTimes(1)

    // onContentDelta must NOT contain tool XML
    const allDeltas = deltas.join('')
    expect(allDeltas).not.toContain('<python_runner>')
    expect(allDeltas).not.toContain('</python_runner>')
    expect(allDeltas).not.toContain('<code>')
    expect(allDeltas).not.toContain('</code>')
    // Safe text should be present
    expect(allDeltas).toContain('Let me check.')
    expect(allDeltas).toContain('Done.')
  })

  it('streams text-schema plain-text deltas incrementally via onContentDelta', async () => {
    const deltas: string[] = []

    const response = buildSseStreamResponse([
      { choices: [{ delta: { content: 'Hello' } }] },
      { choices: [{ delta: { content: ' ' } }] },
      { choices: [{ delta: { content: 'World' } }] },
    ])

    const result = await runToolOrchestration({
      provider: 'anthropic',
      requestData: { tool_schema: 'text' },
      initialMessages: [{ role: 'user', content: 'hi' }],
      toolDefinitions: [],
      allowedToolNames: new Set<string>(),
      maxIterations: 1,
      stream: true,
      requestTurn: async () => response,
      handleToolCall: async () => null,
      onContentDelta: async (delta) => {
        deltas.push(delta)
      },
    })

    expect(result.status).toBe('completed')
    expect(result.content).toBe('Hello World')
    expect(deltas).toEqual(['Hello', ' ', 'World'])
  })

  it.each([
    { withUpload: false, stringOnly: false },
    { withUpload: true, stringOnly: false },
    { withUpload: true, stringOnly: true },
  ])('retries optional page images (user upload: $withUpload; string-only gateway: $stringOnly)', async ({ withUpload, stringOnly }) => {
    const userImage = 'data:image/png;base64,dXBsb2Fk'
    const question = 'How does it compare with a shared gateway?'
    const initialMessages = [
      { role: 'user', content: 'What is the local gateway?' },
      { role: 'assistant', content: 'It routes requests to model providers.' },
      { role: 'user', content: withUpload ? [
        { type: 'text', text: question },
        { type: 'image_url', image_url: { url: userImage } },
      ] : question },
    ]
    const articleImage = 'data:image/png;base64,YXJ0aWNsZQ=='
    const secondImage = 'data:image/png;base64,c2Vjb25k'
    const directImage = 'data:image/png;base64,ZGlyZWN0'
    const laterImage = 'data:image/png;base64,bGF0ZXI='
    const articleBody = 'https://example.com/article\nThe shared gateway manages a shared pool of upstream accounts.'
    const onOptionalImageRetry = jest.fn()
    const toolNames = ['web_search', 'read_url']
    const executedTool = jest.fn(async (name: string, call: { id?: string }) => ({
      toolCallId: call.id!,
      toolName: name,
      message: {
        role: 'tool' as const,
        tool_call_id: call.id,
        name,
        content: name === 'read_url' ? articleBody : 'Search results',
        ...(name === 'read_url' ? { imageEvidence: {
          kind: call.id === 'call_direct' ? 'resource' as const : 'page' as const,
          images: [{
            sourceUrl: 'https://example.com/' + call.id,
            title: 'News ' + call.id,
            imageUrl: 'https://cdn.example.com/' + call.id + '.png',
            dataUrl: call.id === 'call_direct' ? directImage
              : call.id === 'call_read_3' ? laterImage
                : call.id === 'call_read_2' ? secondImage : articleImage,
          }],
        } } : {}),
      },
    }))
    const toolCall = (name: string, id: string, index = 0) => ({
      type: 'response.output_item.done',
      output_index: index,
      item: { type: 'function_call', call_id: id, name, arguments: '{}' },
    })
    const requests: Array<{ iteration: number; input: unknown[] }> = []
    const result = await runToolOrchestration({
      provider: 'openai_responses',
      initialMessages,
      toolDefinitions: toolNames.map((name) => ({
        type: 'function',
        function: { name, description: name, parameters: {} },
      })),
      allowedToolNames: new Set(toolNames),
      maxIterations: 3,
      stream: true,
      onOptionalImageRetry,
      requestTurn: async ({ iteration, messages }) => {
        // The context guard can replace message wrappers without changing their image content.
        if (iteration === 2) messages.splice(0, messages.length, ...messages.map((message) => ({ ...message })))
        const input = convertChatCompletionsMessagesToResponsesInput(messages)
        requests.push({ iteration, input })
        if (iteration === 0) return buildSseStreamResponse([toolCall('web_search', 'call_search')])
        if (iteration === 1) return buildSseStreamResponse([
          toolCall('read_url', 'call_read_1'), toolCall('read_url', 'call_read_2', 1),
          ...(stringOnly ? [] : [toolCall('read_url', 'call_direct', 2)]),
        ])
        if (iteration === 2) {
          if (JSON.stringify(input).includes(articleImage)) {
            return stringOnly
              ? new Response(JSON.stringify({ error: { param: 'input[4].output', message: 'function_call_output.output must be a string' } }), { status: 422 })
              : imageRejectionResponse()
          }
          return buildSseStreamResponse([toolCall('read_url', 'call_read_3')])
        }
        return buildSseStreamResponse([{ type: 'response.output_text.delta', delta: 'They serve different users.' }])
      },
      handleToolCall: executedTool,
    })

    expect(result).toMatchObject({ status: 'completed', content: 'They serve different users.' })
    expect(executedTool.mock.calls.map(([, call]) => call.id)).toEqual([
      'call_search', 'call_read_1', 'call_read_2', ...(stringOnly ? [] : ['call_direct']), 'call_read_3',
    ])
    expect(requests.map(({ iteration }) => iteration)).toEqual([0, 1, 2, 2, 3])
    expect(onOptionalImageRetry).toHaveBeenCalledTimes(1)
    expect(onOptionalImageRetry).toHaveBeenCalledWith({ iteration: 2, affectedToolResults: 2 })
    expect(requests[0].input).toEqual(convertChatCompletionsMessagesToResponsesInput(initialMessages))
    expect(requests[2].input.filter((item: any) => item.role === 'user')).toEqual(
      requests[0].input.filter((item: any) => item.role === 'user'),
    )
    for (const [callId, dataUrl] of [['call_read_1', articleImage], ['call_read_2', secondImage]]) {
      expect(requests[2].input).toContainEqual({
        type: 'function_call_output', call_id: callId, output: [
          { type: 'input_text', text: articleBody },
          { type: 'input_text', text: expect.stringContaining('https://example.com/' + callId) },
          { type: 'input_image', detail: 'auto', image_url: dataUrl },
        ],
      })
      expect(JSON.stringify(requests[3].input)).not.toContain(dataUrl)
    }
    const isDirectImageResult = (item: any) => item.call_id === 'call_direct' && item.type === 'function_call_output'
    const directResult = requests[2].input.find(isDirectImageResult)
    if (stringOnly) {
      expect(directResult).toBeUndefined()
    } else {
      expect(JSON.stringify(directResult)).toContain(directImage)
      expect(requests[3].input.find(isDirectImageResult)).toEqual(directResult)
    }
    expect(requests[3].input).toEqual(expect.arrayContaining([
      ...requests[0].input,
      { type: 'function_call', call_id: 'call_read_1', name: 'read_url', arguments: '{}' },
      { type: 'function_call_output', call_id: 'call_read_1', output: articleBody },
      { type: 'function_call', call_id: 'call_read_2', name: 'read_url', arguments: '{}' },
      { type: 'function_call_output', call_id: 'call_read_2', output: articleBody },
    ]))
    expect(requests[4].input).toEqual([
      ...requests[3].input,
      { type: 'function_call', call_id: 'call_read_3', name: 'read_url', arguments: '{}' },
      { type: 'function_call_output', call_id: 'call_read_3', output: articleBody },
    ])
  })

  it.each([
    { name: 'an unrelated 400', unrelated: true, requests: 2 },
    { name: 'a repeated 11135 rejection', unrelated: false, requests: 3 },
  ])('propagates $name without another image retry', async ({ unrelated, requests }) => {
    const requestTurn = jest.fn(async ({ iteration }: { iteration: number }) => {
      if (iteration === 0) {
        return buildSseStreamResponse([{
          type: 'response.output_item.done',
          item: { type: 'function_call', call_id: 'call_read', name: 'read_url', arguments: '{}' },
        }])
      }
      return unrelated
        ? Response.json({ error: { message: 'Another invalid request' } }, { status: 400 })
        : imageRejectionResponse()
    })
    await expect(runToolOrchestration({
      provider: 'openai_responses',
      initialMessages: [{ role: 'user', content: 'Read this article.' }],
      toolDefinitions: [{
        type: 'function',
        function: { name: 'read_url', description: 'Read an article', parameters: {} },
      }],
      allowedToolNames: new Set(['read_url']),
      maxIterations: 1,
      stream: true,
      requestTurn,
      handleToolCall: async () => ({
        toolCallId: 'call_read',
        toolName: 'read_url',
        message: {
          role: 'tool', tool_call_id: 'call_read', name: 'read_url', content: 'Article text',
          imageEvidence: {
            kind: 'page',
            images: [{ sourceUrl: 'https://example.com/article', title: 'News', imageUrl: 'https://example.com/news.png', dataUrl: 'data:image/png;base64,YXJ0aWNsZQ==' }],
          },
        },
      }),
    })).rejects.toMatchObject({ status: 400, message: expect.stringContaining(unrelated ? 'Another invalid request' : '11135') })
    expect(requestTurn).toHaveBeenCalledTimes(requests)
  })

  it('keeps a 11135 rejection when the only image was uploaded by the user', async () => {
    const requestTurn = jest.fn(async () => imageRejectionResponse())
    await expect(runToolOrchestration({
      provider: 'openai_responses',
      initialMessages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: 'data:image/png;base64,dXBsb2Fk' } },
      ] }],
      toolDefinitions: [],
      allowedToolNames: new Set(),
      maxIterations: 0,
      stream: true,
      requestTurn,
      handleToolCall: async () => null,
    })).rejects.toMatchObject({ status: 400, message: expect.stringContaining('11135') })
    expect(requestTurn).toHaveBeenCalledTimes(1)
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

describe('tool-orchestrator research plan termination', () => {
  const buildTerminatingHandler = (iterations: number[]) =>
    jest.fn(async (_toolName: string, toolCall: any, _args: Record<string, unknown>, iteration?: number) => {
      if (typeof iteration === 'number') iterations.push(iteration)
      return {
        toolCallId: toolCall.id || 'call_term',
        toolName: 'research_plan',
        message: {
          role: 'tool',
          tool_call_id: toolCall.id || 'call_term',
          name: 'research_plan',
          content: JSON.stringify({ status: 'cancelled' }),
        },
        termination: {
          code: 'research_plan_cancelled',
          message: '深度研究已取消',
        },
      } as any
    })

  it('terminates the tools schema without a second model turn', async () => {
    const iterations: number[] = []
    let requestCount = 0
    const handleToolCall = buildTerminatingHandler(iterations)

    const result = await runToolOrchestration({
      provider: 'openai',
      requestData: {},
      initialMessages: [{ role: 'user', content: 'research' }],
      toolDefinitions: [buildPythonToolDefinition()],
      allowedToolNames: new Set<string>(['research_plan']),
      maxIterations: 4,
      stream: false,
      requestTurn: async () => {
        requestCount += 1
        return buildToolCallTurnResponse('research_plan', { title: 't' }, 'call_term')
      },
      handleToolCall,
    })

    expect(result.status).toBe('terminated')
    expect((result as any).termination.code).toBe('research_plan_cancelled')
    expect(requestCount).toBe(1)
    expect(handleToolCall).toHaveBeenCalledTimes(1)
    expect(iterations).toEqual([0])
  })

  it('terminates the functions schema and passes iteration', async () => {
    const iterations: number[] = []
    const result = await runToolOrchestration({
      provider: 'openai',
      requestData: { tool_schema: 'functions' },
      initialMessages: [{ role: 'user', content: 'research' }],
      toolDefinitions: [buildPythonToolDefinition()],
      allowedToolNames: new Set<string>(['research_plan']),
      maxIterations: 4,
      stream: false,
      requestTurn: async () => buildToolCallTurnResponse('research_plan', { title: 't' }, 'call_fn_term'),
      handleToolCall: buildTerminatingHandler(iterations),
    })

    expect(result.status).toBe('terminated')
    expect(iterations).toEqual([0])
  })

  it('terminates the text schema after a tool-call turn', async () => {
    const iterations: number[] = []
    const result = await runToolOrchestration({
      provider: 'anthropic',
      requestData: { tool_schema: 'text' },
      initialMessages: [{ role: 'user', content: 'research' }],
      toolDefinitions: [buildPythonToolDefinition()],
      allowedToolNames: new Set<string>(['research_plan']),
      maxIterations: 4,
      stream: false,
      requestTurn: async () => buildToolCallTurnResponse('research_plan', { title: 't' }, 'call_text_term'),
      handleToolCall: buildTerminatingHandler(iterations),
    })

    expect(result.status).toBe('terminated')
    expect(iterations).toEqual([0])
  })

  it('passes anthropic thinking blocks into the next tool iteration', async () => {
    let calls = 0
    let capturedMessages: any[] = []
    const result = await runToolOrchestration({
      provider: 'anthropic',
      requestData: {},
      initialMessages: [{ role: 'user', content: 'hello' }],
      toolDefinitions: [buildPythonToolDefinition()],
      allowedToolNames: new Set(['python_runner']),
      maxIterations: 2,
      stream: true,
      requestTurn: async ({ messages }) => {
        calls += 1
        if (calls === 1) {
          return buildSseStreamResponse([
            {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call_1',
                        type: 'function',
                        function: { name: 'python_runner', arguments: '{"code":"1"}' },
                      },
                    ],
                  },
                  finish_reason: null,
                },
              ],
            },
            {
              choices: [{ delta: {}, finish_reason: 'tool_calls' }],
              anthropic_thinking_blocks: [
                { type: 'thinking', thinking: 'plan', signature: 'sig-1' },
              ],
            },
          ])
        }
        capturedMessages = JSON.parse(JSON.stringify(messages))
        return buildSseStreamResponse([
          { choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }] },
        ])
      },
      handleToolCall: async () => ({
        toolCallId: 'call_1',
        toolName: 'python_runner',
        message: {
          role: 'tool',
          tool_call_id: 'call_1',
          name: 'python_runner',
          content: 'ok',
        },
      }),
    })

    expect(result.status).toBe('completed')
    expect(result.content).toBe('done')
    const assistant = capturedMessages.find(
      (message) => message.role === 'assistant' && Array.isArray(message.tool_calls),
    )
    expect(assistant.thinking_blocks).toEqual([
      { type: 'thinking', thinking: 'plan', signature: 'sig-1' },
    ])
  })

})