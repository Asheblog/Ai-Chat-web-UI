import {
  PromptTemplateService,
  PromptTemplateServiceError,
} from './prompt-template-service'

const baseDate = new Date('2024-01-01T00:00:00.000Z')

const createMockPrisma = () => ({
  promptTemplate: {
    findMany: jest.fn(),
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
  },
})

const createService = () => {
  const prisma = createMockPrisma()
  const logger = { warn: jest.fn(), error: jest.fn() }
  const service = new PromptTemplateService({ prisma: prisma as any, logger })
  return { service, prisma }
}

describe('PromptTemplateService', () => {
  it('creates template with normalized variables', async () => {
    const { service, prisma } = createService()
    prisma.promptTemplate.create.mockResolvedValue({
      id: 1,
      userId: 7,
      title: '写作助手',
      content: '你是写作助手，今天是 {day time}',
      variablesJson: JSON.stringify(['day time']),
      pinnedAt: baseDate,
      createdAt: baseDate,
      updatedAt: baseDate,
    })

    const result = await service.createTemplate(7, {
      title: ' 写作助手 ',
      content: '你是写作助手，今天是 {day time}',
      variables: ['{day time}', 'day time', ''],
      pinned: true,
    })

    expect(prisma.promptTemplate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 7,
          title: '写作助手',
          variablesJson: JSON.stringify(['day time']),
          pinnedAt: expect.any(Date),
        }),
      }),
    )
    expect(result.variables).toEqual(['day time'])
    expect(result.pinnedAt).toBe(baseDate.toISOString())
  })

  it('lists templates with parsed variables', async () => {
    const { service, prisma } = createService()
    prisma.promptTemplate.findMany.mockResolvedValue([
      {
        id: 2,
        userId: 7,
        title: '翻译模板',
        content: '请翻译为中文：{text}',
        variablesJson: JSON.stringify(['text']),
        pinnedAt: null,
        createdAt: baseDate,
        updatedAt: baseDate,
      },
    ])

    const result = await service.listTemplates(7)

    expect(result).toEqual([
      {
        id: 2,
        userId: 7,
        title: '翻译模板',
        content: '请翻译为中文：{text}',
        variables: ['text'],
        pinnedAt: null,
        createdAt: baseDate.toISOString(),
        updatedAt: baseDate.toISOString(),
      },
    ])
  })

  it('throws 404 when updating a missing template', async () => {
    const { service, prisma } = createService()
    prisma.promptTemplate.findFirst.mockResolvedValue(null)

    await expect(
      service.updateTemplate(7, 999, { content: 'new content' }),
    ).rejects.toEqual(expect.objectContaining({ statusCode: 404 }))
  })

  it('throws when deleting a missing template', async () => {
    const { service, prisma } = createService()
    prisma.promptTemplate.deleteMany.mockResolvedValue({ count: 0 })

    await expect(service.deleteTemplate(7, 999)).rejects.toBeInstanceOf(
      PromptTemplateServiceError,
    )
  })
})
