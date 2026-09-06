import { getAppConfig } from '../../../config/app-config'
import {
  MESSAGE_DEDUPE_WINDOW_MS,
  setChatConfig,
} from '../chat-common'

describe('chat-common config injection', () => {
  const originalConfig = getAppConfig()

  afterEach(() => {
    setChatConfig(originalConfig)
  })

  it('updates message dedupe window when config is injected', () => {
    setChatConfig({
      ...originalConfig,
      chat: {
        ...originalConfig.chat,
        messageDedupeWindowMs: 999,
      },
    })

    expect(MESSAGE_DEDUPE_WINDOW_MS).toBe(999)
  })
})
