import { BattleExecutor } from './battle-executor'
import type { PreparedChatRequest } from '../../modules/chat/services/chat-request-builder'

const buildPreparedRequest = (messages: any[]): PreparedChatRequest => ({
  promptTokens: 10,
  contextLimit: 120000,
  contextRemaining: 119000,
  appliedMaxTokens: 1000,
  contextEnabled: false,
  systemSettings: {},
  providerRequest: {
    providerLabel: 'openai',
    providerHost: null,
    baseUrl: 'https://example.com/v1',
    rawModelId: 'glm-5',
    azureApiVersion: null,
    url: 'https://example.com/v1/chat/completions',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' },
    authHeader: { Authorization: 'Bearer test' },
    extraHeaders: {},
    body: {
      model: 'glm-5',
      messages,
      stream: false,
      temperature: 0.7,
      max_tokens: 512,
    },
    timeoutMs: 30000,
  },
  messagesPayload: messages,
  baseRequestBody: {
    model: 'glm-5',
    messages,
    stream: false,
    temperature: 0.7,
    max_tokens: 512,
  },
  reasoning: {
    enabled: true,
    effort: 'high',
    ollamaThink: false,
  },
})

const buildContext = () => ({
  checkRunCancelled: () => {},
  checkAttemptCancelled: () => {},
  buildAbortHandlers: () => ({}),
  buildTraceContext: (extra?: Record<string, unknown>) => extra || {},
})

describe('BattleExecutor', () => {
  it('sends text-only user content as plain string for provider compatibility', async () => {
    const messages = [
      { role: 'system', content: '今天日期是 2026-03-16' },
      {
        role: 'user',
        content: [{ type: 'text', text: '你好，求解这个题目' }],
      },
    ]

    const prepared = buildPreparedRequest(messages)
    const prepare = jest.fn(async () => prepared)
    const requestWithBackoff = jest.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })

    const executor = new BattleExecutor({
      requestBuilder: { prepare } as any,
      requester: { requestWithBackoff } as any,
    })

    await executor.executeModel({
      prompt: '你好，求解这个题目',
      promptImages: [],
      modelConfig: { modelId: 'glm-5', skills: { enabled: [] } },
      resolved: { connection: { id: 1 } as any, rawModelId: 'glm-5' },
      systemSettings: {},
      context: buildContext(),
    })

    const providerBody = requestWithBackoff.mock.calls[0][0].request.body
    expect(providerBody.messages[1].content).toBe('你好，求解这个题目')
  })
})
