/**
 * 知识库功能与角色策略：用户面前的读写入口必须按设置判定。
 *
 * 边界：`/admin` 与管理动作（建库、上传、删文档）属于管理面，不受角色策略影响；
 * `GET /`、`GET /:id`、`POST /search` 是用户消费面，必须同时满足
 * 「知识库功能已开启」与「当前身份被允许」。
 */

const mockActorHolder: { actor: any } = { actor: null }

jest.mock('../../middleware/auth', () => ({
  actorMiddleware: async (c: any, next: any) => {
    c.set('actor', mockActorHolder.actor)
    await next()
  },
  adminOnlyMiddleware: async (_c: any, next: any) => next(),
}))

import { createKnowledgeBasesApi } from '../knowledge-bases'

const ADMIN_ACTOR = {
  type: 'user',
  id: 9,
  role: 'ADMIN',
  status: 'ACTIVE',
  username: 'root',
  identifier: 'user:9',
}
const USER_ACTOR = {
  type: 'user',
  id: 1,
  role: 'USER',
  status: 'ACTIVE',
  username: 'tester',
  identifier: 'user:1',
}
const ANONYMOUS_ACTOR = {
  type: 'anonymous',
  key: 'anon-key',
  identifier: 'anon:anon-key',
  expiresAt: null,
}

const KNOWLEDGE_BASE_ROW = {
  id: 1,
  name: '产品手册',
  description: null,
  ownerId: null,
  isPublic: true,
  status: 'active',
  documentCount: 2,
  totalChunks: 6,
  createdAt: new Date('2026-11-01T00:00:00Z'),
  updatedAt: new Date('2026-11-02T00:00:00Z'),
}

const settingsRows = (values: Record<string, string>) =>
  Object.entries(values).map(([key, value]) => ({ key, value }))

const buildPrisma = (settings: Record<string, string>) =>
  ({
    systemSetting: {
      findMany: jest.fn().mockResolvedValue(settingsRows(settings)),
    },
    knowledgeBase: {
      findMany: jest.fn().mockResolvedValue([KNOWLEDGE_BASE_ROW]),
      findUnique: jest.fn().mockResolvedValue({
        ...KNOWLEDGE_BASE_ROW,
        documents: [],
      }),
      update: jest.fn().mockResolvedValue(KNOWLEDGE_BASE_ROW),
    },
    knowledgeBaseDocument: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  }) as any

const ENABLED_FOR_USERS = {
  knowledge_base_enabled: 'true',
  knowledge_base_allow_anonymous: 'false',
  knowledge_base_allow_users: 'true',
}

const buildApp = (settings: Record<string, string>) =>
  createKnowledgeBasesApi(buildPrisma(settings))

const listKnowledgeBases = (app: ReturnType<typeof buildApp>) =>
  app.request('http://localhost/', { method: 'GET' })

const readKnowledgeBase = (app: ReturnType<typeof buildApp>) =>
  app.request('http://localhost/1', { method: 'GET' })

const searchKnowledgeBase = (app: ReturnType<typeof buildApp>) =>
  app.request('http://localhost/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: '安装步骤', knowledgeBaseIds: [1] }),
  })

beforeEach(() => {
  mockActorHolder.actor = USER_ACTOR
})

describe('知识库功能总开关', () => {
  const disabled = {
    knowledge_base_enabled: 'false',
    knowledge_base_allow_anonymous: 'true',
    knowledge_base_allow_users: 'true',
  }

  it('关闭后注册用户的列表、详情与检索都返回 403', async () => {
    const app = buildApp(disabled)

    for (const res of [
      await listKnowledgeBases(app),
      await readKnowledgeBase(app),
      await searchKnowledgeBase(app),
    ]) {
      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(String(body.error)).toContain('知识库')
    }
  })

  it('关闭后管理员同样不能从消费面读取（管理面 /admin 仍可用）', async () => {
    mockActorHolder.actor = ADMIN_ACTOR
    const app = buildApp(disabled)

    expect((await listKnowledgeBases(app)).status).toBe(403)
    expect((await readKnowledgeBase(app)).status).toBe(403)
    expect((await searchKnowledgeBase(app)).status).toBe(403)
    expect((await app.request('http://localhost/admin', { method: 'GET' })).status).toBe(200)
  })
})

describe('知识库角色策略', () => {
  it('匿名未获准时匿名身份被拒，注册用户不受影响', async () => {
    const app = buildApp(ENABLED_FOR_USERS)

    mockActorHolder.actor = ANONYMOUS_ACTOR
    const anonymousRes = await listKnowledgeBases(app)
    expect(anonymousRes.status).toBe(403)
    const anonymousBody = await anonymousRes.json()
    expect(String(anonymousBody.error)).toContain('匿名')

    mockActorHolder.actor = USER_ACTOR
    const userRes = await listKnowledgeBases(app)
    expect(userRes.status).toBe(200)
    const userBody = await userRes.json()
    expect(userBody.data).toHaveLength(1)
  })

  it('只放开匿名时，匿名身份可用而注册用户被拒', async () => {
    const app = buildApp({
      knowledge_base_enabled: 'true',
      knowledge_base_allow_anonymous: 'true',
      knowledge_base_allow_users: 'false',
    })

    mockActorHolder.actor = ANONYMOUS_ACTOR
    expect((await listKnowledgeBases(app)).status).toBe(200)

    mockActorHolder.actor = USER_ACTOR
    const denied = await readKnowledgeBase(app)
    expect(denied.status).toBe(403)
    const deniedBody = await denied.json()
    expect(String(deniedBody.error)).toContain('注册用户')
  })

  it('管理员绕过角色开关，但知识库功能开启时才可用', async () => {
    mockActorHolder.actor = ADMIN_ACTOR
    const app = buildApp({
      knowledge_base_enabled: 'true',
      knowledge_base_allow_anonymous: 'false',
      knowledge_base_allow_users: 'false',
    })

    expect((await listKnowledgeBases(app)).status).toBe(200)
    expect((await readKnowledgeBase(app)).status).toBe(200)
    expect((await searchKnowledgeBase(app)).status).toBe(200)
  })
})
describe('知识库策略的布尔解析（与项目 parseBooleanSetting 同一语义）', () => {
  it('enabled="1" 视为开启，allowUsers="1" 视为允许', async () => {
    const app = buildApp({
      knowledge_base_enabled: '1',
      knowledge_base_allow_anonymous: '0',
      knowledge_base_allow_users: '1',
    })

    mockActorHolder.actor = USER_ACTOR
    expect((await listKnowledgeBases(app)).status).toBe(200)

    mockActorHolder.actor = ANONYMOUS_ACTOR
    const anonymousRes = await listKnowledgeBases(app)
    expect(anonymousRes.status).toBe(403)
  })

  it('enabled="on" 与 allowAnonymous="yes" 同样生效', async () => {
    const app = buildApp({
      knowledge_base_enabled: 'on',
      knowledge_base_allow_anonymous: 'yes',
      knowledge_base_allow_users: 'off',
    })

    mockActorHolder.actor = ANONYMOUS_ACTOR
    expect((await listKnowledgeBases(app)).status).toBe(200)

    mockActorHolder.actor = USER_ACTOR
    expect((await readKnowledgeBase(app)).status).toBe(403)
  })

  it('"0"/"no"/"off" 视为关闭，未识别的值走默认（enabled 默认关、allowUsers 默认开）', async () => {
    const disabledApp = buildApp({
      knowledge_base_enabled: 'no',
      knowledge_base_allow_anonymous: 'true',
      knowledge_base_allow_users: 'true',
    })
    mockActorHolder.actor = USER_ACTOR
    const disabledRes = await listKnowledgeBases(disabledApp)
    expect(disabledRes.status).toBe(403)
    expect(String((await disabledRes.json()).error)).toContain('未开启')

    // 未识别值：enabled 回落到默认 false
    const unknownApp = buildApp({
      knowledge_base_enabled: 'enabled',
      knowledge_base_allow_anonymous: 'false',
      knowledge_base_allow_users: 'false',
    })
    expect((await listKnowledgeBases(unknownApp)).status).toBe(403)

    // 未识别值：allowUsers 回落到默认 true，注册用户仍可用
    const userDefaultApp = buildApp({
      knowledge_base_enabled: 'true',
      knowledge_base_allow_anonymous: 'false',
      knowledge_base_allow_users: 'maybe',
    })
    expect((await listKnowledgeBases(userDefaultApp)).status).toBe(200)
  })
})
