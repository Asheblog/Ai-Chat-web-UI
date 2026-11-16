/**
 * 聊天链路的知识库闸门：直接携带 knowledgeBaseIds 的请求也要经过功能与角色策略，
 * 不能只在 `/api/knowledge-bases` 的列表/检索上拦住。
 */

const mockCount = jest.fn()
const mockSettingsFindMany = jest.fn()

jest.mock('../../../db', () => ({
  prisma: {
    systemSetting: { findMany: mockSettingsFindMany },
    knowledgeBaseDocument: { count: mockCount },
    knowledgeBase: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
  },
}))

import { RAGContextBuilder } from '../rag-context-builder'

const settingsRows = (values: Record<string, string>) =>
  Object.entries(values).map(([key, value]) => ({ key, value }))

const enabledPolicy = (overrides: Record<string, string> = {}) =>
  settingsRows({
    knowledge_base_enabled: 'true',
    knowledge_base_allow_anonymous: 'true',
    knowledge_base_allow_users: 'true',
    ...overrides,
  })

const buildBuilder = () => new RAGContextBuilder({} as any)

beforeEach(() => {
  mockCount.mockReset().mockResolvedValue(2)
  mockSettingsFindMany.mockReset().mockResolvedValue(enabledPolicy())
})

describe('RAGContextBuilder.hasKnowledgeBases 功能闸门', () => {
  it('知识库功能关闭时即便知识库有文档也不可用', async () => {
    mockSettingsFindMany.mockResolvedValue(
      settingsRows({
        knowledge_base_enabled: 'false',
        knowledge_base_allow_anonymous: 'true',
        knowledge_base_allow_users: 'true',
      }),
    )

    await expect(buildBuilder().hasKnowledgeBases([1])).resolves.toBe(false)
  })

  it('未传身份上下文时只受功能总闸约束（既有调用方契约不变）', async () => {
    await expect(buildBuilder().hasKnowledgeBases([1])).resolves.toBe(true)
  })

  it('传入身份上下文时同时受角色策略约束', async () => {
    mockSettingsFindMany.mockResolvedValue(
      enabledPolicy({ knowledge_base_allow_anonymous: 'false' }),
    )
    const builder = buildBuilder()

    await expect(
      builder.hasKnowledgeBases([1], { isAnonymous: true, isAdmin: false }),
    ).resolves.toBe(false)
    await expect(
      builder.hasKnowledgeBases([1], { isAnonymous: false, isAdmin: false }),
    ).resolves.toBe(true)
  })

  it('管理员绕过角色开关但仍受功能总闸约束', async () => {
    mockSettingsFindMany.mockResolvedValue(
      enabledPolicy({ knowledge_base_allow_anonymous: 'false', knowledge_base_allow_users: 'false' }),
    )
    const builder = buildBuilder()

    await expect(
      builder.hasKnowledgeBases([1], { isAnonymous: false, isAdmin: true }),
    ).resolves.toBe(true)
  })

  it('没有文档或没有选择知识库时直接不可用，不触发策略查询', async () => {
    mockCount.mockResolvedValue(0)
    const builder = buildBuilder()

    await expect(builder.hasKnowledgeBases([])).resolves.toBe(false)
    await expect(builder.hasKnowledgeBases([1])).resolves.toBe(false)
    // 空选择不应产生设置查询
    expect(mockSettingsFindMany).toHaveBeenCalledTimes(1)
  })
})
