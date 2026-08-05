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
jest.mock('../../../../utils/quota', () => ({
  __esModule: true,
  consumeActorQuota: jest.fn().mockResolvedValue({ success: true, snapshot: null }),
  serializeQuotaSnapshot: jest.fn().mockReturnValue({}),
}))

// Mock chat-images
jest.mock('../../../../utils/chat-images', () => ({
  __esModule: true,
  cleanupExpiredChatImages: jest.fn().mockResolvedValue(undefined),
  loadPersistedChatImages: jest.fn().mockResolvedValue([]),
  determineChatImageBaseUrl: jest.fn().mockReturnValue(''),
  CHAT_IMAGE_DEFAULT_RETENTION_DAYS: 30,
  persistChatImages: jest.fn().mockResolvedValue(undefined),
  validateChatImages: jest.fn().mockResolvedValue(undefined),
}))

// Mock task-trace
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
  shouldEnableTaskTrace: jest.fn().mockResolvedValue({ enabled: false, traceLevel: 'off', config: { idleTimeoutMs: 0, maxEvents: 0 } }),
  summarizeSseLine: jest.fn(),
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
jest.mock('../../../../utils/anonymous-cleanup', () => ({
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

// Mock vision-proxy-service
jest.mock('../../services/vision-proxy-service', () => ({
  __esModule: true,
  VisionProxyServiceError: class VisionProxyServiceError extends Error {
    statusCode = 500
  },
  isVisionProxyReady: jest.fn().mockReturnValue(false),
  loadHistoryImageDescriptions: jest.fn().mockResolvedValue(new Map()),
  parseStoredImageDescriptions: jest.fn().mockReturnValue(null),
  loadVisionProxyConfig: jest.fn(),
}))

jest.mock('../../agent-tool-config', () => {
  const actual = jest.requireActual('../../agent-tool-config')
  return {
    __esModule: true,
    ...actual,
    computeAgentToolFlags: jest.fn((...args: unknown[]) => actual.computeAgentToolFlags(...args)),
  }
})

// Mock model-capabilities
jest.mock('../../../../utils/model-capabilities', () => ({
  __esModule: true,
  resolveModelCapabilitiesForSession: jest.fn().mockResolvedValue({ vision: true }),
}))

import { createChatStreamHandler } from '../chat-stream-use-case'
import { ConnectionServiceError } from '../../../../services/connections/connection-service'
import {
  isVisionProxyReady,
  loadHistoryImageDescriptions,
  loadVisionProxyConfig,
  parseStoredImageDescriptions,
} from '../../services/vision-proxy-service'
import { resolveModelCapabilitiesForSession } from '../../../../utils/model-capabilities'
import { computeAgentToolFlags } from '../../agent-tool-config'

// visionProxyService 实例：deps 构造与用例断言共用同一 mock
const visionProxyService = { transcribeImages: jest.fn() }

const createMockContext = () => {
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
        return { identifier: 'test-actor', type: 'user', id: 1, personalPrompt: null }
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
      azureApiVersion: null,
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
    visionProxyService: visionProxyService as any,
    ...(overrides.depsOverrides ?? {}),
  }
}

describe('createChatStreamHandler error handling', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(isVisionProxyReady as jest.Mock).mockReturnValue(false)
    ;(resolveModelCapabilitiesForSession as jest.Mock).mockResolvedValue({ vision: true })
    ;(loadHistoryImageDescriptions as jest.Mock).mockResolvedValue(new Map())
    ;(parseStoredImageDescriptions as jest.Mock).mockReturnValue(null)
    ;(computeAgentToolFlags as jest.Mock).mockImplementation(
      (...args: unknown[]) =>
        jest.requireActual('../../agent-tool-config').computeAgentToolFlags(...args),
    )
    visionProxyService.transcribeImages.mockReset()
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

  it('auto-transcribes images for non-vision main model in standard flow', async () => {
    ;(isVisionProxyReady as jest.Mock).mockReturnValue(true)
    ;(resolveModelCapabilitiesForSession as jest.Mock).mockResolvedValue({ vision: false })
    ;(loadVisionProxyConfig as jest.Mock).mockReturnValue({ enabled: true, connectionId: 2, modelId: 'gemini-2.5-flash' })
    ;(visionProxyService.transcribeImages as jest.Mock).mockResolvedValue({ description: '图里有一只猫', modelRawId: 'm' })
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
      reasoning: { enabled: false, effort: 'medium', ollamaThink: false },
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
      images: [{ data: 'aW1n', mime: 'image/png' }],
    }))

    const handler = createChatStreamHandler(deps)
    await handler(c)

    // 自动转写：图片不随消息发出，转写描述作为前缀注入
    expect(mockPrepare).toHaveBeenCalledWith(expect.objectContaining({
      images: [],
      mainModelVision: false,
      visionTranscriptionPrefix: '图里有一只猫',
      historyImageDescriptions: expect.any(Map),
    }))
    const autoPrepareArg = mockPrepare.mock.calls[0][0]
    expect(autoPrepareArg.visionAttachmentImageCount).toBeUndefined()
    // 转写调用携带原始图片、用户问题与转写代理配置
    expect(visionProxyService.transcribeImages).toHaveBeenCalledWith(
      [{ data: 'aW1n', mime: 'image/png' }],
      'hello',
      expect.objectContaining({ enabled: true, connectionId: 2 }),
    )
    // 历史图片描述加载：仅主模型无 vision 且转写就绪时触发
    expect(loadHistoryImageDescriptions).toHaveBeenCalledWith((deps as any).prisma, 1, expect.any(Date))
    // 转写结果持久化到用户消息
    expect((deps as any).prisma.message.update).toHaveBeenCalledWith({
      where: { id: 100 },
      data: { imageDescriptionsJson: JSON.stringify([{ description: '图里有一只猫', modelRawId: 'm' }]) },
    })
  })

  it('passes visionAttachmentImageCount in tool flow without auto-transcribing', async () => {
    ;(isVisionProxyReady as jest.Mock).mockReturnValue(true)
    ;(resolveModelCapabilitiesForSession as jest.Mock).mockResolvedValue({ vision: false })
    ;(loadVisionProxyConfig as jest.Mock).mockReturnValue({
      enabled: true,
      connectionId: 2,
      modelId: 'gemini-2.5-flash',
    })
    ;(computeAgentToolFlags as jest.Mock).mockReturnValue({
      agentToolsActive: true,
      agentWebSearchActive: true,
      pythonToolActive: false,
      workspaceToolsActive: false,
      urlReaderActive: true,
      documentToolsActive: false,
      knowledgeBaseToolsActive: false,
      dynamicSkillRequested: false,
    })
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
      reasoning: { enabled: false, effort: 'medium', ollamaThink: false },
    })
    const deps = createMinimalDeps({
      mockPrepare,
      depsOverrides: {
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
      content: '不对啊',
      clientMessageId: 'test-client-id',
      images: [
        { data: 'aW1n', mime: 'image/png' },
        { data: 'aW1nMg==', mime: 'image/jpeg' },
      ],
    }))

    const handler = createChatStreamHandler(deps)
    await handler(c)

    expect(visionProxyService.transcribeImages).not.toHaveBeenCalled()
    expect(mockPrepare).toHaveBeenCalledWith(
      expect.objectContaining({
        images: [],
        mainModelVision: false,
        visionAttachmentImageCount: 2,
      }),
    )
    const prepareArg = mockPrepare.mock.calls[0][0]
    expect(prepareArg.visionTranscriptionPrefix).toBeFalsy()
  })

  it('does not pass visionAttachmentImageCount when main model has vision', async () => {
    ;(isVisionProxyReady as jest.Mock).mockReturnValue(true)
    ;(resolveModelCapabilitiesForSession as jest.Mock).mockResolvedValue({ vision: true })
    ;(loadVisionProxyConfig as jest.Mock).mockReturnValue({
      enabled: true,
      connectionId: 2,
      modelId: 'gemini-2.5-flash',
    })
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
      reasoning: { enabled: false, effort: 'medium', ollamaThink: false },
    })
    const deps = createMinimalDeps({
      mockPrepare,
      depsOverrides: {
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
      content: '看看图',
      clientMessageId: 'test-client-id',
      images: [{ data: 'aW1n', mime: 'image/png' }],
    }))

    const handler = createChatStreamHandler(deps)
    await handler(c)

    expect(visionProxyService.transcribeImages).not.toHaveBeenCalled()
    expect(mockPrepare).toHaveBeenCalledWith(
      expect.objectContaining({
        mainModelVision: true,
        images: [{ data: 'aW1n', mime: 'image/png' }],
      }),
    )
    expect(mockPrepare.mock.calls[0][0].visionAttachmentImageCount).toBeUndefined()
  })
})
