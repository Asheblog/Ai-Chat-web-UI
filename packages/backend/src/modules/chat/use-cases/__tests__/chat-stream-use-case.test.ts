jest.mock('../../../../db', () => ({ prisma: { $transaction: jest.fn() } }))

// Mock message-service to control createUserMessageWithQuota (called before prepare())
jest.mock('../../services/message-service', () => ({
  __esModule: true,
  createUserMessageWithQuota: jest.fn().mockResolvedValue({
    userMessage: { id: 100, content: 'hello', createdAt: new Date() },
    messageWasReused: false,
    quotaSnapshot: { used: 0, limit: 100, remaining: 100, resetAt: new Date() },
  }),
}))

// Mock quota utils
jest.mock('../../../../services/quota/legacy-utils', () => ({
  __esModule: true,
  consumeActorQuota: jest.fn().mockResolvedValue({ success: true, snapshot: null }),
  serializeQuotaSnapshot: jest.fn().mockReturnValue({}),
}))

// Mock chat-images（服务代理与纯函数已拆分）
jest.mock('../../../../services/attachment/legacy-utils', () => ({
  __esModule: true,
  cleanupExpiredChatImages: jest.fn().mockResolvedValue(undefined),
  loadPersistedChatImages: jest.fn().mockResolvedValue([]),
}))

jest.mock('../../../../utils/chat-images', () => ({
  __esModule: true,
  determineChatImageBaseUrl: jest.fn().mockReturnValue(''),
}))

// Mock task-trace（Recorder 纯工具与配置代理已拆分）
jest.mock('../../../../utils/task-trace', () => ({
  __esModule: true,
  TaskTraceRecorder: {
    create: jest.fn().mockResolvedValue({
      log: jest.fn(),
      isEnabled: jest.fn().mockReturnValue(false),
      finalize: jest.fn().mockResolvedValue(undefined),
      setMessageContext: jest.fn(),
    }),
  },
  summarizeSseLine: jest.fn(),
  // 编排层在 trace 事件参数里调用 truncateString：缺它会在 prepare 之后抛 TypeError
  truncateString: jest.fn((value: string) => value),
}))

jest.mock('../../../../services/task-trace/legacy-utils', () => ({
  __esModule: true,
  shouldEnableTaskTrace: jest.fn().mockResolvedValue({ enabled: false, traceLevel: 'off', config: { idleTimeoutMs: 0, maxEvents: 0 } }),
}))

// Mock stream-state
jest.mock('../../../chat/stream-state', () => ({
  __esModule: true,
  buildPendingCancelKeyByClientId: jest.fn().mockReturnValue('key'),
  buildPendingCancelKeyByMessageId: jest.fn().mockReturnValue('key'),
  clearPendingCancelMarkers: jest.fn(),
  deriveAssistantClientMessageId: jest.fn().mockReturnValue('assistant-client-id'),
  hasPendingStreamCancelKey: jest.fn().mockReturnValue(false),
  registerStreamMeta: jest.fn().mockReturnValue({ streamKey: 'test', cancelled: false }),
  releaseStreamMeta: jest.fn(),
  updateStreamMetaController: jest.fn(),
  deletePendingStreamCancelKey: jest.fn(),
}))

// Mock document-services-factory
jest.mock('../../../../services/document-services-factory', () => ({
  __esModule: true,
  getDocumentServices: jest.fn().mockReturnValue(null),
}))

// Mock anonymous-cleanup
jest.mock('../../../../services/cleanup/legacy-utils', () => ({
  __esModule: true,
  cleanupAnonymousSessions: jest.fn().mockResolvedValue(undefined),
}))

// Mock rag-context-builder
jest.mock('../../../chat/rag-context-builder', () => ({
  __esModule: true,
  RAGContextBuilder: jest.fn().mockImplementation(() => ({
    hasKnowledgeBases: jest.fn().mockResolvedValue(false),
    enhanceFromKnowledgeBases: jest.fn(),
    buildSystemPrompt: jest.fn(),
  })),
}))

// Mock trace-helpers
jest.mock('../../../../utils/trace-helpers', () => ({
  __esModule: true,
  redactHeadersForTrace: jest.fn().mockReturnValue({}),
  summarizeErrorForTrace: jest.fn().mockReturnValue('error'),
  summarizeBodyForTrace: jest.fn().mockReturnValue('body'),
}))

// Mock api-error-parser
jest.mock('../../../../utils/api-error-parser', () => ({
  __esModule: true,
  parseApiError: jest.fn().mockReturnValue({ message: 'mock error', suggestion: null }),
  getFriendlyErrorMessage: jest.fn().mockReturnValue('mock error'),
}))

// Mock image-generation-response
jest.mock('../../../chat/image-generation-response', () => ({
  __esModule: true,
  createImageGenerationResponse: jest.fn(),
  checkImageGenerationCapability: jest.fn().mockResolvedValue(false),
}))

// Mock vision-proxy-service：编排层已不再调用转写，但 agent-tool-config 仍导入其配置加载器，
// 屏蔽掉以避免本单测加载视觉服务的原生依赖
jest.mock('../../../../services/vision/vision-proxy-service', () => ({
  __esModule: true,
  loadVisionProxyConfig: jest.fn(),
}))

import { createChatStreamHandler } from '../chat-stream-use-case'
import { ConnectionServiceError } from '../../../../services/connections/connection-service'

const createMockContext = (actorOverrides: Record<string, unknown> = {}) => {
  const jsonMock = jest.fn()
  const req: any = {
    valid: jest.fn(() => ({
      sessionId: 1,
      content: 'hello',
      clientMessageId: 'test-client-id',
    })),
    raw: {
      signal: new AbortController().signal,
    },
  }
  const c: any = {
    get: jest.fn((key: string) => {
      if (key === 'actor') {
        return { identifier: 'test-actor', type: 'user', id: 1, personalPrompt: null, ...actorOverrides }
      }
      return undefined
    }),
    req,
    json: jsonMock,
    newResponse: jest.fn(),
    header: jest.fn(),
  }
  return { c, jsonMock }
}

const createMinimalDeps = (overrides: Record<string, unknown> = {}) => {
  const mockPrepare = overrides.mockPrepare ?? jest.fn()
  const baseSession = {
    id: 1,
    connectionId: 10,
    modelRawId: 'gpt-4o-mini',
    connection: {
      id: 10,
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
      headersJson: null,
      authType: 'bearer',
      secretVaultId: 1,
    },
  }

  return {
    prisma: {
      message: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null), updateMany: jest.fn().mockResolvedValue({ count: 0 }), update: jest.fn().mockResolvedValue({}) },
      systemSetting: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
      modelCatalog: { findMany: jest.fn().mockResolvedValue([]) },
      messageGroup: { findMany: jest.fn().mockResolvedValue([]) },
      session: { findUnique: jest.fn().mockResolvedValue(null) },
      connection: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(),
    } as any,
    chatService: {
      getSessionWithConnection: jest.fn().mockResolvedValue(baseSession),
    } as any,
    chatRequestBuilder: {
      prepare: mockPrepare,
    } as any,
    reasoningCompatibilityService: {
      decideProtocol: jest.fn().mockResolvedValue({ protocol: 'chat_completions', reason: 'test', profile: null }),
      createAttempt: jest.fn().mockReturnValue(null),
      finalizeAttempt: jest.fn().mockResolvedValue(null),
      markSignal: jest.fn(),
      markReasoningObserved: jest.fn(),
      buildUnavailableNotice: jest.fn(),
      markUnavailable: jest.fn(),
    } as any,
    providerRequester: {
      requestWithBackoff: jest.fn(),
      executeFallback: jest.fn(),
    } as any,
    nonStreamFallbackService: {} as any,
    assistantProgressService: {} as any,
    streamUsageService: {} as any,
    streamTraceService: {
      handleLatexTrace: jest.fn().mockResolvedValue({ latexTraceRecorder: null, latexAuditSummary: null }),
    } as any,
    streamSseService: {
      createEmitter: jest.fn(() => ({
        enqueue: jest.fn(),
        isClosed: jest.fn().mockReturnValue(false),
        markClosed: jest.fn(),
      })),
      startHeartbeat: jest.fn(() => jest.fn()),
    } as any,
    conversationCompressionService: {
      compressIfNeeded: jest.fn().mockResolvedValue({ applied: false, payload: null }),
    } as any,
    ...(overrides.depsOverrides ?? {}),
  }
}

describe('createChatStreamHandler error handling', () => {
  // 本文件用例都在错误路径上跑（prepare 抛错、provider 失败），产品代码会把这些预期错误打到 console。
  // 统一吞掉才能让套件输出干净；断言失败仍由 jest 报出。用 beforeAll/afterAll 是为了覆盖
  // 流式失败在 await handler(c) 之后才打印的异步尾部，并在文件结束后还原，避免影响同 worker 的其它套件。
  let consoleSpies: jest.SpyInstance[]

  beforeAll(() => {
    consoleSpies = (['log', 'warn', 'error'] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation(() => {}),
    )
  })

  afterAll(() => {
    consoleSpies.forEach((spy) => spy.mockRestore())
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 400 JSON when chatRequestBuilder.prepare() throws ConnectionServiceError with statusCode 400', async () => {
    const error = new ConnectionServiceError('连接缺少 secretVaultId，无法获取 API Key', 400)
    const mockPrepare = jest.fn().mockRejectedValue(error)
    const deps = createMinimalDeps({ mockPrepare })
    const { c, jsonMock } = createMockContext()

    const handler = createChatStreamHandler(deps)
    const response = await handler(c)

    expect(jsonMock).toHaveBeenCalled()
    const jsonCallArgs = jsonMock.mock.calls[0]
    expect(jsonCallArgs[0]).toMatchObject({ success: false, error: '连接缺少 secretVaultId，无法获取 API Key' })
    expect(jsonCallArgs[1]).toBe(400)
    expect(response).toBe(jsonMock.mock.results[0]?.value ?? response)
  })

  it('resolves context preference from the actor once and reuses it for the compression gate and request build', async () => {
    const mockPrepare = jest.fn().mockRejectedValue(new Error('stop after wiring check'))
    const deps = createMinimalDeps({ mockPrepare })
    const { c } = createMockContext({ contextEnabled: false })

    const handler = createChatStreamHandler(deps)
    await handler(c)

    expect(deps.conversationCompressionService.compressIfNeeded).not.toHaveBeenCalled()
    expect(mockPrepare.mock.calls[0][0].contextEnabled).toBe(false)
  })

  it('keeps the compression gate on when the account preference is enabled', async () => {
    const mockPrepare = jest.fn().mockRejectedValue(new Error('stop after wiring check'))
    const deps = createMinimalDeps({ mockPrepare })
    // 默认 actor 不含 contextEnabled：解析应回落到 true，压缩门保持开启
    const { c } = createMockContext()

    const handler = createChatStreamHandler(deps)
    await handler(c)

    expect(deps.conversationCompressionService.compressIfNeeded).toHaveBeenCalled()
    expect(mockPrepare.mock.calls[0][0].contextEnabled).toBe(true)
  })

  it('returns 500 JSON for plain Error (no statusCode)', async () => {
    const mockPrepare = jest.fn().mockRejectedValue(new Error('some internal error'))
    const deps = createMinimalDeps({ mockPrepare })
    const { c, jsonMock } = createMockContext()

    const handler = createChatStreamHandler(deps)
    const response = await handler(c)

    expect(jsonMock).toHaveBeenCalled()
    const jsonCallArgs = jsonMock.mock.calls[0]
    expect(jsonCallArgs[0]).toMatchObject({ success: false, error: 'Failed to process chat request' })
    expect(jsonCallArgs[1]).toBe(500)
  })

  it('passes images straight into prepare without any vision fields (interface contract)', async () => {
    const mockPrepare = jest.fn().mockResolvedValue({
      promptTokens: 10,
      contextLimit: 100,
      contextRemaining: 90,
      contextEnabled: true,
      systemSettings: {},
      messagesPayload: [],
      baseRequestBody: {},
      providerRequest: {
        providerLabel: 'openai',
        authHeader: {},
        extraHeaders: {},
        providerHost: 'api.example.com',
        timeoutMs: 60000,
      },
      reasoning: { enabled: false, effort: 'medium' },
    })
    const deps = createMinimalDeps({
      mockPrepare,
      depsOverrides: {
        // 标准流后续走到 provider 请求失败路径：mock 掉进度持久化与非流式兜底，
        // 避免真实实现抛错导致 start() 挂起/未处理拒绝
        assistantProgressService: {
          persistProgress: jest.fn().mockResolvedValue({ recovered: false, messageId: null }),
        } as any,
        nonStreamFallbackService: {
          execute: jest.fn().mockResolvedValue(null),
        } as any,
        providerRequester: {
          requestWithBackoff: jest.fn().mockRejectedValue(new Error('provider error')),
          executeFallback: jest.fn(),
        } as any,
      },
    })
    const { c } = createMockContext()
    c.req.valid = jest.fn(() => ({
      sessionId: 1,
      content: 'hello',
      clientMessageId: 'test-client-id',
      images: [{ data: 'aGk=', mime: 'image/png' }],
    }))

    const handler = createChatStreamHandler(deps)
    await handler(c)

    // 契约用例：验证 prepare 的入参形状（图片原样透传、四个转写字段不存在），不声称覆盖写回路径；
    // 对旧实现的区分力由下面四条 not.toHaveProperty 承担
    const prepareArg = mockPrepare.mock.calls[0][0]
    expect(prepareArg.images).toEqual([{ data: 'aGk=', mime: 'image/png' }])
    expect(prepareArg).not.toHaveProperty('mainModelVision')
    expect(prepareArg).not.toHaveProperty('visionTranscriptionPrefix')
    expect(prepareArg).not.toHaveProperty('visionAttachmentImageCount')
    expect(prepareArg).not.toHaveProperty('historyImageDescriptions')
  })
})
