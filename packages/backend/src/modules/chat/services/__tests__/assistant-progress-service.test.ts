import { AssistantProgressService } from '../assistant-progress-service'

const build = () => {
  const prisma = {
    message: {
      update: jest.fn(),
    },
  }
  const upsertAssistantMessageByClientId = jest.fn()
  const logger = { warn: jest.fn() }
  const service = new AssistantProgressService({
    prisma: prisma as any,
    upsertAssistantMessageByClientId,
    logger,
  })
  return { prisma, upsertAssistantMessageByClientId, logger, service }
}

describe('AssistantProgressService', () => {
  it('persists progress via update', async () => {
    const { prisma, service } = build()
    prisma.message.update.mockResolvedValueOnce({})
    const result = await service.persistProgress({
      assistantMessageId: 1,
      sessionId: 2,
      content: 'hello',
      reasoning: 'why',
      status: 'streaming',
      errorMessage: null,
    })
    expect(prisma.message.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({ streamStatus: 'streaming' }),
      }),
    )
    expect(result.messageId).toBe(1)
  })

  it('upserts when record missing (P2025)', async () => {
    const { prisma, service, upsertAssistantMessageByClientId, logger } = build()
    const error: any = new Error('not found')
    error.code = 'P2025'
    prisma.message.update.mockRejectedValueOnce(error)
    upsertAssistantMessageByClientId.mockResolvedValueOnce(5)
    const result = await service.persistProgress({
      assistantMessageId: 3,
      sessionId: 4,
      clientMessageId: 'c1',
      content: 'hi',
      reasoning: null,
      status: 'done',
    })
    expect(upsertAssistantMessageByClientId).toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalled()
    expect(result).toEqual({ messageId: 5, recovered: true })
  })

  it('returns original id when upsert fails', async () => {
    const { prisma, service, logger } = build()
    const error: any = new Error('not found')
    error.code = 'P2025'
    prisma.message.update.mockRejectedValueOnce(error)
    const result = await service.persistProgress({
      assistantMessageId: 6,
      sessionId: 7,
      content: 'hi',
    })
    expect(logger.warn).toHaveBeenCalled()
    expect(result.messageId).toBe(6)
  })
})
