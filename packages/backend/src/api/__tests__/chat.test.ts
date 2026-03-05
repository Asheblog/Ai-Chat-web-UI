jest.mock('../../modules/chat/routes/messages', () => ({
  registerChatMessageRoutes: jest.fn(),
}))
jest.mock('../../modules/chat/routes/attachments', () => ({
  registerChatAttachmentRoutes: jest.fn(),
}))
jest.mock('../../modules/chat/routes/stream', () => ({
  registerChatStreamRoutes: jest.fn(),
}))
jest.mock('../../modules/chat/routes/completion', () => ({
  registerChatCompletionRoutes: jest.fn(),
}))
jest.mock('../../modules/chat/routes/control', () => ({
  registerChatControlRoutes: jest.fn(),
}))
jest.mock('../../modules/chat/routes/usage', () => ({
  registerChatUsageRoutes: jest.fn(),
}))
jest.mock('../../modules/chat/routes/workspace', () => ({
  registerChatWorkspaceRoutes: jest.fn(),
}))

import { createChatApi } from '../chat'
import { registerChatStreamRoutes } from '../../modules/chat/routes/stream'
import { registerChatCompletionRoutes } from '../../modules/chat/routes/completion'

describe('chat api factory', () => {
  it('registers chat routes', () => {
    const deps: any = {
      messageRoutes: { prisma: {}, chatService: {}, chatMessageQueryService: {} },
      compressionRoutes: { chatService: {}, conversationCompressionService: {} },
      attachmentRoutes: { prisma: {} },
      streamRoutes: {
        prisma: {},
        chatService: {},
        chatRequestBuilder: {},
        reasoningCompatibilityService: {},
        providerRequester: {},
        nonStreamFallbackService: {},
        assistantProgressService: {},
        streamUsageService: {},
        streamTraceService: {},
        streamSseService: {},
        conversationCompressionService: {},
      },
      completionRoutes: { prisma: {}, nonStreamService: {}, conversationCompressionService: {} },
      controlRoutes: { prisma: {} },
      usageRoutes: { prisma: {}, chatService: {} },
      titleSummaryRoutes: { prisma: {}, service: {}, settingsService: {} },
      workspaceRoutes: { prisma: {}, chatService: {}, artifactService: {}, workspaceService: {} },
    }
    createChatApi(deps)

    expect(registerChatStreamRoutes).toHaveBeenCalledWith(expect.anything(), deps.streamRoutes)
    expect(registerChatCompletionRoutes).toHaveBeenCalledWith(expect.anything(), deps.completionRoutes)
  })
})
