jest.mock('sharp', () => {
  const sharpMock = jest.fn(() => ({
    metadata: async () => {
      throw new Error('sharp metadata failed')
    },
  }))
  return {
    __esModule: true,
    default: sharpMock,
  }
})

import { validateChatImages } from './chat-images'

const ONE_BY_ONE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6Kf0cAAAAASUVORK5CYII='

describe('validateChatImages', () => {
  it('falls back to safe metadata parsing when sharp metadata fails', async () => {
    await expect(
      validateChatImages([{ data: ONE_BY_ONE_PNG_BASE64, mime: 'image/png' }]),
    ).resolves.toBeUndefined()
  })
})
