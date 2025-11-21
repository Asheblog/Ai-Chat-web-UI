import { getAppConfig } from '../../../config/app-config'
import {
  BACKOFF_429_MS,
  BACKOFF_5XX_MS,
  MESSAGE_DEDUPE_WINDOW_MS,
  setChatConfig,
} from '../chat-common'

describe('chat-common config injection', () => {
  const originalConfig = getAppConfig()

  afterEach(() => {
    setChatConfig(originalConfig)
  })

  it('updates backoff values when config is injected', () => {
    setChatConfig({
      ...originalConfig,
      retry: {
        upstream429Ms: 123,
        upstream5xxMs: 456,
      },
    })

    expect(BACKOFF_429_MS).toBe(123)
    expect(BACKOFF_5XX_MS).toBe(456)
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
