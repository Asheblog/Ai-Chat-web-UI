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
})
