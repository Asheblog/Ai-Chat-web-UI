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

import { createChatStreamHandler } from '../chat-stream-use-case'
import { ConnectionServiceError } from '../../../../services/connections/connection-service'

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
      message: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
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
})
