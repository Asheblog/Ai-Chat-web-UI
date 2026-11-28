import { DEFAULT_CHAT_IMAGE_LIMITS } from '@aichat/shared/image-limits'
import { sendMessageSchema } from './chat-common'

describe('chat image count contract', () => {
  const requestWithImages = (length: number) => ({
    sessionId: 1,
    content: 'Compare these images',
    images: Array.from({ length }, () => ({ data: 'aW1hZ2U=', mime: 'image/png' })),
  })

  it('accepts the shared limit and rejects a request above it', () => {
    const limit = DEFAULT_CHAT_IMAGE_LIMITS.maxCount
    expect(sendMessageSchema.safeParse(requestWithImages(limit)).success).toBe(true)
    expect(sendMessageSchema.safeParse(requestWithImages(limit + 1)).success).toBe(false)
  })
})
