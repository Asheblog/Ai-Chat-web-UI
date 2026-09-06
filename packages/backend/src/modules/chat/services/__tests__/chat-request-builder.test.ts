jest.mock('../../../../utils/providers', () => ({
  ...jest.requireActual('../../../../utils/providers'),
  buildHeaders: jest.fn(async () => ({
    'Content-Type': 'application/json',
    Authorization: 'Bearer mocked',
  })),
  convertOpenAIReasoningPayload: (body: any) => body,
}))

jest.mock('../../../../db', () => ({
  prisma: {},
}))

import { ChatRequestBuilder } from '../../../../agent-runtime/chat-request-builder'
import { ConnectionServiceError } from '../../../../services/connections/connection-service'

const baseSession = {
  id: 1,
  connectionId: 10,
  modelRawId: 'gpt-4o-mini',
  reasoningEnabled: null,
  reasoningEffort: null,
  connection: {
    provider: 'openai',
    baseUrl: 'https://api.example.com/v1',
    headersJson: null,
    authType: 'bearer',
    secretVaultId: 1,
  },
}

const buildBuilder = () => {
  const prisma = {
    message: {
      findMany: jest.fn(),
    },
    systemSetting: {
      findMany: jest.fn(),
    },
    modelCatalog: {
      findMany: jest.fn(),
    },
  }
  const tokenizer = {
    truncateMessages: jest.fn(),
    countConversationTokens: jest.fn(),
  }
  const resolveContextLimit = jest.fn()
  const resolveCompletionLimit = jest.fn()
  const cleanupExpiredChatImages = jest.fn(() => Promise.resolve())
  const secretVault = { decryptById: jest.fn(() => Promise.resolve('decoded')) }

  const builder = new ChatRequestBuilder({
    prisma: prisma as any,
    tokenizer,
    resolveContextLimit,
    resolveCompletionLimit,
    cleanupExpiredChatImages,
    secretVault: secretVault as any,
  })

  return {
    prisma,
    tokenizer,
    resolveContextLimit,
    resolveCompletionLimit,
    cleanupExpiredChatImages,
    secretVault,
    builder,
  }
}

describe('ChatRequestBuilder', () => {
  it.each(['azure_openai', 'ollama'])('rejects retired %s before loading history or credentials', async (provider) => {
    const { builder, prisma, secretVault } = buildBuilder()
    await expect(builder.prepare({
      session: { ...baseSession, connection: { ...baseSession.connection, provider } } as any,
      payload: { content: 'hello' },
      content: 'hello',
      mode: 'stream',
    })).rejects.toThrow('Unsupported provider')
    expect(prisma.message.findMany).not.toHaveBeenCalled()
    expect(secretVault.decryptById).not.toHaveBeenCalled()
  })

  it('builds stream request with web-search skill prompt', async () => {
    const { builder, prisma, tokenizer, resolveContextLimit, resolveCompletionLimit } = buildBuilder()
    prisma.message.findMany.mockResolvedValue([
      { role: 'assistant', content: 'hi', createdAt: new Date('2024-01-01T00:00:00Z') },
    ])
    prisma.systemSetting.findMany.mockResolvedValue([
      { key: 'provider_timeout_ms', value: '123000' },
      { key: 'reasoning_enabled', value: 'true' },
    ])
    prisma.modelCatalog.findMany.mockResolvedValue([])
    tokenizer.truncateMessages.mockResolvedValue([
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'hello' },
    ])
    tokenizer.countConversationTokens.mockResolvedValue(120)
    resolveContextLimit.mockResolvedValue(4000)
    resolveCompletionLimit.mockResolvedValue(2048)

    const prepared = await builder.prepare({
      session: baseSession as any,
      payload: { sessionId: 1, content: 'hello', skills: { enabled: ['web-search'] } } as any,
      content: 'hello',
      images: [],
      mode: 'stream',
    })

    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sessionId: 1 }),
      }),
    )
    expect(prepared.promptTokens).toBe(120)
    expect(prepared.providerRequest.url).toContain('/chat/completions')
    expect(prepared.providerRequest.headers.Authorization).toBe('Bearer mocked')
    expect(prepared.messagesPayload[0].role).toBe('system')
    expect(prepared.baseRequestBody.stream).toBe(true)
    expect(prepared.reasoning.enabled).toBe(true)
  })

  it('injects plan-first deep research prompt when web search is active', async () => {
    const { builder, prisma, tokenizer, resolveContextLimit, resolveCompletionLimit } = buildBuilder()
    prisma.message.findMany.mockResolvedValue([])
    prisma.systemSetting.findMany.mockResolvedValue([])
    prisma.modelCatalog.findMany.mockResolvedValue([])
    tokenizer.truncateMessages.mockResolvedValue([{ role: 'user', content: '调研' }])
    tokenizer.countConversationTokens.mockResolvedValue(10)
    resolveContextLimit.mockResolvedValue(4000)
    resolveCompletionLimit.mockResolvedValue(2048)

    const prepared = await builder.prepare({
      session: baseSession as any,
      payload: {
        sessionId: 1,
        content: '调研 2026 年 AI 芯片竞争格局',
        skills: { builtin: ['deep-research'] },
      } as any,
      content: '调研 2026 年 AI 芯片竞争格局',
      mode: 'stream',
      requestedSkills: { builtin: ['deep-research'], enabled: [] },
      deepResearchWebSearchActive: true,
    })

    const serialized = JSON.stringify(prepared.baseRequestBody.messages)
    expect(serialized).toContain('research_plan')
    expect(serialized).toContain('在收到用户批准之前')
    expect(serialized).toContain('export_pdf')
  })

  it('injects unverified fallback prompt for deep research without search', async () => {
    const { builder, prisma, tokenizer, resolveContextLimit, resolveCompletionLimit } = buildBuilder()
    prisma.message.findMany.mockResolvedValue([])
    prisma.systemSetting.findMany.mockResolvedValue([])
    prisma.modelCatalog.findMany.mockResolvedValue([])
    tokenizer.truncateMessages.mockResolvedValue([{ role: 'user', content: '调研' }])
    tokenizer.countConversationTokens.mockResolvedValue(10)
    resolveContextLimit.mockResolvedValue(4000)
    resolveCompletionLimit.mockResolvedValue(2048)

    const prepared = await builder.prepare({
      session: baseSession as any,
      payload: {
        sessionId: 1,
        content: '调研 2026 年 AI 芯片竞争格局',
        skills: { builtin: ['deep-research'] },
      } as any,
      content: '调研 2026 年 AI 芯片竞争格局',
      mode: 'stream',
      requestedSkills: { builtin: ['deep-research'], enabled: [] },
      deepResearchWebSearchActive: false,
    })

    const serialized = JSON.stringify(prepared.baseRequestBody.messages)
    expect(serialized).toContain('不要调用 research_plan')
    expect(serialized).toContain('未经联网验证')
  })

  it('applies history upper bound and completion mode for OpenAI provider', async () => {
    const { builder, prisma, tokenizer, resolveContextLimit, resolveCompletionLimit } = buildBuilder()
    prisma.message.findMany.mockResolvedValue([
      { role: 'assistant', content: 'old', createdAt: new Date('2024-01-01T00:00:00Z') },
    ])
    prisma.systemSetting.findMany.mockResolvedValue([
      { key: 'provider_timeout_ms', value: '600000' },
      { key: 'reasoning_enabled', value: 'false' },
    ])
    prisma.modelCatalog.findMany.mockResolvedValue([])
    tokenizer.truncateMessages.mockResolvedValue([
      { role: 'assistant', content: 'old' },
      { role: 'user', content: 'replay' },
    ])
    tokenizer.countConversationTokens.mockResolvedValue(80)
    resolveContextLimit.mockResolvedValue(2000)
    resolveCompletionLimit.mockResolvedValue(500)

    const completionSession = {
      ...baseSession,
      connection: {
        ...baseSession.connection,
        provider: 'openai',
      },
    }

    const upperBound = new Date('2024-01-01T00:00:00Z')
    const prepared = await builder.prepare({
      session: completionSession as any,
      payload: { sessionId: 1, content: 'replay', reasoningEnabled: false } as any,
      content: 'replay',
      images: [],
      mode: 'completion',
      historyUpperBound: upperBound,
    })

    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: { lte: upperBound },
        }),
      }),
    )
    expect(prepared.reasoning.enabled).toBe(false)
    expect(prepared.providerRequest.url).toContain('/chat/completions')
    expect(prepared.providerRequest.body.stream).toBe(false)
  })

  it('prefers session prompt over personal and system prompts', async () => {
    const { builder, prisma, tokenizer, resolveContextLimit, resolveCompletionLimit } = buildBuilder()
    prisma.message.findMany.mockResolvedValue([])
    prisma.systemSetting.findMany.mockResolvedValue([
      { key: 'chat_system_prompt', value: 'global prompt' },
    ])
    prisma.modelCatalog.findMany.mockResolvedValue([])
    tokenizer.truncateMessages.mockResolvedValue([{ role: 'user', content: 'hi' }])
    tokenizer.countConversationTokens.mockResolvedValue(10)
    resolveContextLimit.mockResolvedValue(1000)
    resolveCompletionLimit.mockResolvedValue(500)

    const prepared = await builder.prepare({
      session: { ...baseSession, systemPrompt: 'session prompt' } as any,
      payload: { sessionId: 1, content: 'hi' } as any,
      content: 'hi',
      mode: 'stream',
      personalPrompt: 'personal prompt',
    })

    expect(prepared.messagesPayload[0]).toMatchObject({
      role: 'system',
      content: 'session prompt',
    })
  })

  it('uses personal prompt when session prompt missing but global exists', async () => {
    const { builder, prisma, tokenizer, resolveContextLimit, resolveCompletionLimit } = buildBuilder()
    prisma.message.findMany.mockResolvedValue([])
    prisma.systemSetting.findMany.mockResolvedValue([
      { key: 'chat_system_prompt', value: 'global prompt' },
    ])
    prisma.modelCatalog.findMany.mockResolvedValue([])
    tokenizer.truncateMessages.mockResolvedValue([{ role: 'user', content: 'hi' }])
    tokenizer.countConversationTokens.mockResolvedValue(10)
    resolveContextLimit.mockResolvedValue(1000)
    resolveCompletionLimit.mockResolvedValue(500)

    const prepared = await builder.prepare({
      session: baseSession as any,
      payload: { sessionId: 1, content: 'hi' } as any,
      content: 'hi',
      mode: 'stream',
      personalPrompt: 'personal prompt',
    })

    expect(prepared.messagesPayload[0]).toMatchObject({
      role: 'system',
      content: 'personal prompt',
    })
  })

  it('prefers model-specific temperature over system default', async () => {
    const { builder, prisma, tokenizer, resolveContextLimit, resolveCompletionLimit } = buildBuilder()
    prisma.message.findMany.mockResolvedValue([])
    prisma.systemSetting.findMany.mockResolvedValue([
      { key: 'temperature_default', value: '0.7' },
    ])
    prisma.modelCatalog.findMany.mockResolvedValue([
      {
        metaJson: '{"fetched_at":"2026-03-14T13:02:53.706Z"}',
        manualOverride: false,
        lastFetchedAt: new Date('2026-03-14T13:02:53.706Z'),
        modelId: 'kimi-k2.5',
        rawId: 'kimi-k2.5',
      },
      {
        metaJson: '{"temperature":1}',
        manualOverride: true,
        lastFetchedAt: new Date('2026-03-14T13:02:53.707Z'),
        modelId: 'kimi-k2.5',
        rawId: 'kimi-k2.5',
      },
    ])
    tokenizer.truncateMessages.mockResolvedValue([{ role: 'user', content: 'hi' }])
    tokenizer.countConversationTokens.mockResolvedValue(10)
    resolveContextLimit.mockResolvedValue(1000)
    resolveCompletionLimit.mockResolvedValue(500)

    const prepared = await builder.prepare({
      session: { ...baseSession, modelRawId: 'kimi-k2.5' } as any,
      payload: { sessionId: 1, content: 'hi' } as any,
      content: 'hi',
      mode: 'stream',
    })

    expect(prepared.baseRequestBody.temperature).toBe(1)
  })

  it('adds thinking enabled for deepseek vendor when reasoning is on', async () => {
    const { builder, prisma, tokenizer, resolveContextLimit, resolveCompletionLimit } = buildBuilder()
    prisma.message.findMany.mockResolvedValue([])
    prisma.systemSetting.findMany.mockResolvedValue([
      { key: 'provider_timeout_ms', value: '60000' },
    ])
    prisma.modelCatalog.findMany.mockResolvedValue([])
    tokenizer.truncateMessages.mockResolvedValue([{ role: 'user', content: 'hello' }])
    tokenizer.countConversationTokens.mockResolvedValue(10)
    resolveContextLimit.mockResolvedValue(4000)
    resolveCompletionLimit.mockResolvedValue(2048)

    const deepseekSession = {
      ...baseSession,
      connection: {
        ...baseSession.connection,
        vendor: 'deepseek',
      },
    }

    const prepared = await builder.prepare({
      session: deepseekSession as any,
      payload: { sessionId: 1, content: 'hello', reasoningEnabled: true, reasoningEffort: 'high' } as any,
      content: 'hello',
      mode: 'stream',
    })

    expect(prepared.baseRequestBody.thinking).toEqual({ type: 'enabled' })
    expect(prepared.baseRequestBody.reasoning_effort).toBe('high')
    expect(prepared.reasoning.enabled).toBe(true)
  })

  it('adds thinking disabled for openai_interleave vendor when reasoning is off', async () => {
    const { builder, prisma, tokenizer, resolveContextLimit, resolveCompletionLimit } = buildBuilder()
    prisma.message.findMany.mockResolvedValue([])
    prisma.systemSetting.findMany.mockResolvedValue([
      { key: 'provider_timeout_ms', value: '60000' },
    ])
    prisma.modelCatalog.findMany.mockResolvedValue([])
    tokenizer.truncateMessages.mockResolvedValue([{ role: 'user', content: 'hello' }])
    tokenizer.countConversationTokens.mockResolvedValue(10)
    resolveContextLimit.mockResolvedValue(4000)
    resolveCompletionLimit.mockResolvedValue(2048)

    const interleaveSession = {
      ...baseSession,
      connection: {
        ...baseSession.connection,
        vendor: 'openai_interleave',
      },
    }

    const prepared = await builder.prepare({
      session: interleaveSession as any,
      payload: { sessionId: 1, content: 'hello', reasoningEnabled: false } as any,
      content: 'hello',
      mode: 'stream',
    })

    expect(prepared.baseRequestBody.thinking).toEqual({ type: 'disabled' })
    expect(prepared.baseRequestBody.reasoning_effort).toBeUndefined()
    expect(prepared.reasoning.enabled).toBe(false)
  })

  it('does not add thinking parameter for non-DeepSeek vendor', async () => {
    const { builder, prisma, tokenizer, resolveContextLimit, resolveCompletionLimit } = buildBuilder()
    prisma.message.findMany.mockResolvedValue([])
    prisma.systemSetting.findMany.mockResolvedValue([
      { key: 'provider_timeout_ms', value: '60000' },
    ])
    prisma.modelCatalog.findMany.mockResolvedValue([])
    tokenizer.truncateMessages.mockResolvedValue([{ role: 'user', content: 'hello' }])
    tokenizer.countConversationTokens.mockResolvedValue(10)
    resolveContextLimit.mockResolvedValue(4000)
    resolveCompletionLimit.mockResolvedValue(2048)

    const prepared = await builder.prepare({
      session: baseSession as any,
      payload: { sessionId: 1, content: 'hello' } as any,
      content: 'hello',
      mode: 'stream',
    })

    expect(prepared.baseRequestBody.thinking).toBeUndefined()
  })

  it('throws ConnectionServiceError(400) when secretVaultId is null on bearer connection', async () => {
    const { builder, prisma, tokenizer, resolveContextLimit, resolveCompletionLimit } = buildBuilder()
    prisma.message.findMany.mockResolvedValue([])
    prisma.systemSetting.findMany.mockResolvedValue([
      { key: 'provider_timeout_ms', value: '60000' },
    ])
    prisma.modelCatalog.findMany.mockResolvedValue([])
    tokenizer.truncateMessages.mockResolvedValue([{ role: 'user', content: 'hello' }])
    tokenizer.countConversationTokens.mockResolvedValue(10)
    resolveContextLimit.mockResolvedValue(4000)
    resolveCompletionLimit.mockResolvedValue(2048)

    const brokenSession = {
      ...baseSession,
      connection: {
        ...baseSession.connection,
        secretVaultId: null,
      },
    }

    await expect(builder.prepare({
      session: brokenSession as any,
      payload: { sessionId: 1, content: 'hello' } as any,
      content: 'hello',
      mode: 'stream',
    })).rejects.toMatchObject({ statusCode: 400, message: '连接缺少 secretVaultId，无法获取 API Key' })
  })
})

describe('ChatRequestBuilder.prepare vision proxy', () => {
  // tokenizer.truncateMessages 透传输入，确保注入到历史消息的描述能流入最终 payload
  const passthroughTokenizer = (tokenizer: any) => {
    tokenizer.truncateMessages.mockImplementation(async (messages: any[]) => messages)
    tokenizer.countConversationTokens.mockResolvedValue(10)
  }

  it('injects visionTranscriptionPrefix into current user message and strips images', async () => {
    const { builder, prisma, tokenizer, resolveContextLimit, resolveCompletionLimit } = buildBuilder()
    prisma.message.findMany.mockResolvedValue([])
    prisma.systemSetting.findMany.mockResolvedValue([])
    prisma.modelCatalog.findMany.mockResolvedValue([])
    passthroughTokenizer(tokenizer)
    resolveContextLimit.mockResolvedValue(1000)
    resolveCompletionLimit.mockResolvedValue(500)

    const prepared = await builder.prepare({
      session: baseSession as any,
      payload: { sessionId: 1, content: '看看这张图' } as any,
      content: '看看这张图',
      images: [{ data: 'aGk=', mime: 'image/png' }],
      mode: 'stream',
      mainModelVision: false,
      visionTranscriptionPrefix: '图片里有一只猫',
      historyImageDescriptions: null,
    })
    const messages: any[] = prepared.baseRequestBody.messages
    const last = messages[messages.length - 1]
    expect(JSON.stringify(last.content)).toContain('图片里有一只猫')
    expect(JSON.stringify(last.content)).not.toContain('image_url')
    expect(JSON.stringify(last.content)).toContain('看看这张图')
  })

  it('injects vision attachment hint with image count for tool-flow non-vision models', async () => {
    const { builder, prisma, tokenizer, resolveContextLimit, resolveCompletionLimit } = buildBuilder()
    prisma.message.findMany.mockResolvedValue([])
    prisma.systemSetting.findMany.mockResolvedValue([])
    prisma.modelCatalog.findMany.mockResolvedValue([])
    passthroughTokenizer(tokenizer)
    resolveContextLimit.mockResolvedValue(1000)
    resolveCompletionLimit.mockResolvedValue(500)

    const prepared = await builder.prepare({
      session: baseSession as any,
      payload: { sessionId: 1, content: '不对啊' } as any,
      content: '不对啊',
      images: [],
      mode: 'stream',
      mainModelVision: false,
      visionAttachmentImageCount: 2,
    })
    const messages: any[] = prepared.baseRequestBody.messages
    const last = messages[messages.length - 1]
    const serialized = JSON.stringify(last.content)
    expect(serialized).toContain('[用户附件]')
    expect(serialized).toContain('本消息含 2 张图片')
    expect(serialized).toContain('analyze_visual_media')
    expect(serialized).toContain('不对啊')
  })

  it('does not inject vision attachment hint when count is absent or zero', async () => {
    const { builder, prisma, tokenizer, resolveContextLimit, resolveCompletionLimit } = buildBuilder()
    prisma.message.findMany.mockResolvedValue([])
    prisma.systemSetting.findMany.mockResolvedValue([])
    prisma.modelCatalog.findMany.mockResolvedValue([])
    passthroughTokenizer(tokenizer)
    resolveContextLimit.mockResolvedValue(1000)
    resolveCompletionLimit.mockResolvedValue(500)

    const prepared = await builder.prepare({
      session: baseSession as any,
      payload: { sessionId: 1, content: '纯文字' } as any,
      content: '纯文字',
      mode: 'stream',
      mainModelVision: false,
      visionAttachmentImageCount: 0,
    })
    const messages: any[] = prepared.baseRequestBody.messages
    const last = messages[messages.length - 1]
    expect(JSON.stringify(last.content)).not.toContain('[用户附件]')
    expect(JSON.stringify(last.content)).not.toContain('analyze_visual_media')
  })

  it('keeps images for vision main model', async () => {
    const { builder, prisma, tokenizer, resolveContextLimit, resolveCompletionLimit } = buildBuilder()
    prisma.message.findMany.mockResolvedValue([])
    prisma.systemSetting.findMany.mockResolvedValue([])
    prisma.modelCatalog.findMany.mockResolvedValue([])
    passthroughTokenizer(tokenizer)
    resolveContextLimit.mockResolvedValue(1000)
    resolveCompletionLimit.mockResolvedValue(500)

    const prepared = await builder.prepare({
      session: baseSession as any,
      payload: { sessionId: 1, content: '看看这张图' } as any,
      content: '看看这张图',
      images: [{ data: 'aGk=', mime: 'image/png' }],
      mode: 'stream',
      mainModelVision: true,
    })
    const messages: any[] = prepared.baseRequestBody.messages
    const last = messages[messages.length - 1]
    expect(JSON.stringify(last.content)).toContain('image_url')
    expect(JSON.stringify(last.content)).not.toContain('图片里有一只猫')
  })

  it('injects history descriptions into historical user messages', async () => {
    const { builder, prisma, tokenizer, resolveContextLimit, resolveCompletionLimit } = buildBuilder()
    prisma.message.findMany.mockResolvedValue([])
    prisma.systemSetting.findMany.mockResolvedValue([])
    prisma.modelCatalog.findMany.mockResolvedValue([])
    passthroughTokenizer(tokenizer)
    resolveContextLimit.mockResolvedValue(1000)
    resolveCompletionLimit.mockResolvedValue(500)

    const historyImageDescriptions = new Map<number, any[]>(
      [[100, [{ description: '历史上的图：一只狗', modelRawId: 'm' }]]],
    )
    const prepared = await builder.prepare({
      session: baseSession as any,
      payload: { sessionId: 1, content: '继续' } as any,
      content: '继续',
      mode: 'stream',
      mainModelVision: false,
      historyImageDescriptions,
      historySnapshot: {
        messages: [
          { id: 100, role: 'user', content: '看这张', createdAt: new Date(), messageGroupId: null },
        ],
        groups: [],
      },
    })
    const messages: any[] = prepared.baseRequestBody.messages
    expect(JSON.stringify(messages)).toContain('历史上的图：一只狗')
  })
})
