import type { Message } from '@prisma/client'
import { OpenAICompatMessageService, OpenAICompatMessageServiceError } from './message-service'

const buildService = () => {
  const prisma = {
    chatSession: {
      findFirst: jest.fn(),
    },
    message: {
      findMany: jest.fn(),
      upsert: jest.fn(),
      create: jest.fn(),
    },
  }
  const persistChatImages = jest.fn()
  const logger = { warn: jest.fn(), error: jest.fn() }

  const service = new OpenAICompatMessageService({
    prisma: prisma as any,
    persistChatImages,
    logger,
  })

  return { prisma, persistChatImages, logger, service }
}

const baseMessage = (): Message => ({
  id: 1,
  sessionId: 10,
  role: 'assistant',
  content: 'hello',
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
  modelId: null,
  clientMessageId: null,
  parentMessageId: null,
  variantIndex: null,
  streamStatus: null,
  streamCursor: null,
  streamReasoning: null,
  streamError: null,
  reasoning: null,
  reasoningDurationSeconds: null,
  toolLogsJson: null,
  attachmentsJson: null,
})

const VALID_IMAGE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/w8AAgMBgSppZQAAAABJRU5ErkJggg=='

describe('OpenAICompatMessageService', () => {
  it('ensures session ownership and throws when missing', async () => {
    const { service, prisma } = buildService()
    prisma.chatSession.findFirst.mockResolvedValueOnce({ id: 8 })
    await expect(service.ensureSessionOwnedByUser(1, 8)).resolves.toEqual({ id: 8 })

    prisma.chatSession.findFirst.mockResolvedValueOnce(null)
    await expect(service.ensureSessionOwnedByUser(1, 99)).rejects.toThrow(
      OpenAICompatMessageServiceError,
    )
  })

  it('lists messages with optional limit', async () => {
    const { service, prisma } = buildService()
    const message = baseMessage()
    prisma.message.findMany.mockResolvedValueOnce([message])

    const result = await service.listMessages({ sessionId: 10, limit: 5 })
    expect(result).toEqual([message])
    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sessionId: 10 },
        take: 5,
      }),
    )

    prisma.message.findMany.mockClear()
    prisma.message.findMany.mockResolvedValueOnce([message])
    await service.listMessages({ sessionId: 10, limit: -1 })
    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sessionId: 10 },
      }),
    )
  })

  it('saves message via upsert when client id provided and persists images', async () => {
    const { service, prisma, persistChatImages, logger } = buildService()
    const saved = { ...baseMessage(), id: 2 }
    prisma.message.upsert.mockResolvedValueOnce(saved)

    const result = await service.saveMessage({
      sessionId: 11,
      role: 'assistant',
      content: 'hi',
      clientMessageId: 'c-1',
      reasoning: 'because',
      reasoningDurationSeconds: 2,
      images: [{ data: VALID_IMAGE_BASE64, mime: 'image/png' }],
      userId: 5,
    })

    expect(result).toEqual(saved)
    expect(prisma.message.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sessionId_clientMessageId: { sessionId: 11, clientMessageId: 'c-1' } },
      }),
    )
    expect(persistChatImages).toHaveBeenCalledWith(
      [{ data: VALID_IMAGE_BASE64, mime: 'image/png' }],
      expect.objectContaining({
        sessionId: 11,
        messageId: 2,
        userId: 5,
        clientMessageId: 'c-1',
        skipValidation: true,
      }),
    )
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('creates message when no client id and bubbles image errors', async () => {
    const { service, prisma, persistChatImages, logger } = buildService()
    const saved = baseMessage()
    prisma.message.create.mockResolvedValueOnce(saved)
    persistChatImages.mockRejectedValueOnce(new Error('disk full'))

    await expect(
      service.saveMessage({
        sessionId: 12,
        role: 'user',
        content: 'question',
        images: [{ data: VALID_IMAGE_BASE64, mime: 'image/jpeg' }],
        userId: 9,
      }),
    ).rejects.toThrow('disk full')
    expect(prisma.message.create).toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
  })
})
