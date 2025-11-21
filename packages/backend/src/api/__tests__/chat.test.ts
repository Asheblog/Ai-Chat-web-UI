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

import { createChatApi } from '../chat'
import { registerChatStreamRoutes } from '../../modules/chat/routes/stream'
import { registerChatCompletionRoutes } from '../../modules/chat/routes/completion'

describe('chat api factory', () => {
  it('passes injected logTraffic into stream/completion routes', () => {
    const logTraffic = jest.fn()

    createChatApi({ logTraffic })

    expect(registerChatStreamRoutes).toHaveBeenCalledWith(expect.anything(), { logTraffic })
    expect(registerChatCompletionRoutes).toHaveBeenCalledWith(expect.anything(), { logTraffic })
  })
})
