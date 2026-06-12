jest.mock('../../middleware/auth', () => ({
  actorMiddleware: async (c: any, next: any) => {
    const role = (c.req.header('x-role') || 'USER').toUpperCase()
    if (role === 'ANONYMOUS') {
      c.set('actor', {
        type: 'anonymous',
        key: 'anon-key',
        identifier: 'anonymous:anon-key',
      })
    } else {
      c.set('actor', {
        type: 'user',
        id: 1,
        role,
        status: 'ACTIVE',
        username: 'tester',
        identifier: 'user:1',
      })
      c.set('user', {
        id: 1,
        username: 'tester',
        role,
        status: 'ACTIVE',
      })
    }
    await next()
  },
  requireUserActor: async (c: any, next: any) => {
    const actor = c.get('actor')
    if (!actor || actor.type !== 'user') {
      return c.json({ success: false, error: '需要登录' }, 401)
    }
    await next()
  },
  adminOnlyMiddleware: async (c: any, next: any) => {
    const actor = c.get('actor')
    if (!actor || actor.role !== 'ADMIN') {
      return c.json({ success: false, error: 'Admin required' }, 403)
    }
    await next()
  },
}))

jest.mock('../../services/secret-vault', () => {
  const actual = jest.requireActual('../../services/secret-vault')
  return {
    SecretVaultService: actual.SecretVaultService,
    SecretVaultServiceError: actual.SecretVaultServiceError,
  }
})

import { createSecretVaultApi } from '../secret-vault'
import { SecretVaultService } from '../../services/secret-vault'
import type { SecretView } from '../../services/secret-vault'

/** In-memory repository that mimics the SecretVaultRepository interface. */
function createMockRepository() {
  const store = new Map<number, any>()
  let nextId = 1

  return {
    create: jest.fn(async (data: any) => {
      const record = {
        id: nextId++,
        scope: data.scope,
        scopeId: data.scopeId,
        kind: data.kind,
        label: data.label,
        encryptedValue: data.encryptedValue,
        refId: data.refId ?? null,
        refType: data.refType ?? null,
        createdBy: data.createdBy ?? null,
        createdAt: new Date('2025-01-01T00:00:00Z'),
        updatedAt: new Date('2025-01-01T00:00:00Z'),
      }
      store.set(record.id, record)
      return record
    }),
    findById: jest.fn(async (id: number) => {
      return store.get(id) ?? null
    }),
    findByRef: jest.fn(),
    listByScope: jest.fn(async (scope: string, scopeId: string) => {
      const results: any[] = []
      for (const record of store.values()) {
        if (record.scope === scope && record.scopeId === scopeId) {
          results.push(record)
        }
      }
      return results.sort((a, b) => b.id - a.id)
    }),
    updateValue: jest.fn(),
    update: jest.fn(async (id: number, data: any) => {
      const existing = store.get(id)
      if (!existing) throw new Error('Not found')
      const updated = { ...existing, ...data, updatedAt: new Date() }
      store.set(id, updated)
      return updated
    }),
    delete: jest.fn(async (id: number) => {
      store.delete(id)
    }),
  }
}

function createSecretVaultService(mockRepo: any) {
  return new SecretVaultService({
    masterKey: '0123456789abcdef0123456789abcdef',
    repository: mockRepo,
  })
}

describe('Secret Vault API', () => {
  let mockRepo: ReturnType<typeof createMockRepository>
  let svc: SecretVaultService

  beforeEach(() => {
    mockRepo = createMockRepository()
    svc = createSecretVaultService(mockRepo)
  })

  describe('GET /secrets', () => {
    it('admin 可以列出系统级和用户级 secret', async () => {
      // Seed data
      await svc.createSecret({ scope: 'system', scopeId: 'system', kind: 'mcp_credential', label: 'SysKey', value: 'sys123', createdBy: 1 })
      await svc.createSecret({ scope: 'user', scopeId: '1', kind: 'mcp_credential', label: 'UserKey', value: 'usr456', createdBy: 1 })

      const app = createSecretVaultApi(svc)
      const res = await app.request('http://localhost/?scope=system&kind=mcp_credential', {
        method: 'GET',
        headers: { 'x-role': 'ADMIN' },
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(Array.isArray(body.data)).toBe(true)
      // System secrets returned
      expect(body.data.length).toBeGreaterThanOrEqual(1)
      expect(body.data[0].label).toBe('SysKey')
      // Must NOT expose encryptedValue or plaintext
      expect(body.data[0].encryptedValue).toBeUndefined()
      expect(body.data[0].hasValue).toBe(true)
    })

    it('admin 无 scope 参数时返回 system + 自己 user', async () => {
      await svc.createSecret({ scope: 'system', scopeId: 'system', kind: 'api_key', label: 'SysA', value: 'a', createdBy: 1 })
      await svc.createSecret({ scope: 'user', scopeId: '1', kind: 'api_key', label: 'MyA', value: 'b', createdBy: 1 })

      const app = createSecretVaultApi(svc)
      const res = await app.request('http://localhost/', { method: 'GET', headers: { 'x-role': 'ADMIN' } })
      expect(res.status).toBe(200)
      const data = (await res.json()).data as any[]
      expect(data.length).toBe(2)
      const labels = data.map((d: any) => d.label).sort()
      expect(labels).toEqual(['MyA', 'SysA'])
    })

    it('admin scope=system 只返回 system secret', async () => {
      await svc.createSecret({ scope: 'system', scopeId: 'system', kind: 'api_key', label: 'SysA', value: 'a', createdBy: 1 })
      await svc.createSecret({ scope: 'user', scopeId: '1', kind: 'api_key', label: 'MyA', value: 'b', createdBy: 1 })

      const app = createSecretVaultApi(svc)
      const res = await app.request('http://localhost/?scope=system', { method: 'GET', headers: { 'x-role': 'ADMIN' } })
      expect(res.status).toBe(200)
      const data = (await res.json()).data as any[]
      expect(data.length).toBe(1)
      expect(data[0].label).toBe('SysA')
    })

    it('admin scope=user 只返回自己的 user secret', async () => {
      await svc.createSecret({ scope: 'system', scopeId: 'system', kind: 'api_key', label: 'SysA', value: 'a', createdBy: 1 })
      await svc.createSecret({ scope: 'user', scopeId: '1', kind: 'api_key', label: 'MyA', value: 'b', createdBy: 1 })

      const app = createSecretVaultApi(svc)
      const res = await app.request('http://localhost/?scope=user', { method: 'GET', headers: { 'x-role': 'ADMIN' } })
      expect(res.status).toBe(200)
      const data = (await res.json()).data as any[]
      expect(data.length).toBe(1)
      expect(data[0].label).toBe('MyA')
    })

    it('普通用户只能看自己的 user scope secret', async () => {
      await svc.createSecret({ scope: 'system', scopeId: 'system', kind: 'mcp_credential', label: 'SysKey', value: 'sys123', createdBy: 1 })
      await svc.createSecret({ scope: 'user', scopeId: '1', kind: 'mcp_credential', label: 'MyKey', value: 'usr456', createdBy: 1 })
      await svc.createSecret({ scope: 'user', scopeId: '2', kind: 'mcp_credential', label: 'OtherKey', value: 'usr789', createdBy: 2 })

      const app = createSecretVaultApi(svc)
      const res = await app.request('http://localhost/', {
        method: 'GET',
        headers: { 'x-role': 'USER' },
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      // Should only see user:1 secrets (user scope with scopeId=1)
      expect(body.data.length).toBe(1)
      expect(body.data[0].label).toBe('MyKey')
    })

    it('用户 scope=system 返回 403', async () => {
      const app = createSecretVaultApi(svc)
      const res = await app.request('http://localhost/?scope=system', {
        method: 'GET',
        headers: { 'x-role': 'USER' },
      })
      expect(res.status).toBe(403)
    })

    it('用户 scope=user 或无 scope 返回自己的 user', async () => {
      await svc.createSecret({ scope: 'user', scopeId: '1', kind: 'api_key', label: 'Own', value: 'x', createdBy: 1 })

      const app = createSecretVaultApi(svc)
      const res = await app.request('http://localhost/?scope=user', {
        method: 'GET',
        headers: { 'x-role': 'USER' },
      })
      expect(res.status).toBe(200)
      const data = (await res.json()).data as any[]
      expect(data.length).toBe(1)
      expect(data[0].label).toBe('Own')
    })

    it('匿名用户访问返回 401', async () => {
      const app = createSecretVaultApi(svc)
      const res = await app.request('http://localhost/', {
        method: 'GET',
        headers: { 'x-role': 'ANONYMOUS' },
      })
      expect(res.status).toBe(401)
    })
  })

  describe('POST /secrets', () => {
    it('admin 可以创建 system scope secret', async () => {
      const app = createSecretVaultApi(svc)
      const res = await app.request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-role': 'ADMIN' },
        body: JSON.stringify({
          scope: 'system',
          kind: 'mcp_credential',
          label: '测试凭据',
          value: 'sk-test123',
        }),
      })
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.id).toBeGreaterThan(0)

      // Verify it was created via service
      const view = await svc.getSecretView(body.data.id)
      expect(view.label).toBe('测试凭据')
      expect(view.hasValue).toBe(true)
    })

    it('普通用户可以创建自己的 user scope secret', async () => {
      const app = createSecretVaultApi(svc)
      const res = await app.request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-role': 'USER' },
        body: JSON.stringify({
          scope: 'user',
          kind: 'api_key',
          label: '我的 API Key',
          value: 'sk-mykey',
        }),
      })
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.success).toBe(true)
    })

    it('普通用户不能创建 system scope secret', async () => {
      const app = createSecretVaultApi(svc)
      const res = await app.request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-role': 'USER' },
        body: JSON.stringify({
          scope: 'system',
          kind: 'mcp_credential',
          label: '作弊',
          value: 'hack',
        }),
      })
      expect(res.status).toBe(403)
    })

    it('匿名用户不能创建 secret', async () => {
      const app = createSecretVaultApi(svc)
      const res = await app.request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-role': 'ANONYMOUS' },
        body: JSON.stringify({
          scope: 'user',
          kind: 'api_key',
          label: 'test',
          value: 'x',
        }),
      })
      expect(res.status).toBe(401)
    })

    it('不接受未知 kind 但会校验长度', async () => {
      const app = createSecretVaultApi(svc)
      const res = await app.request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-role': 'ADMIN' },
        body: JSON.stringify({
          scope: 'system',
          kind: '',
          label: '空 kind',
          value: 'x',
        }),
      })
      expect(res.status).toBe(400)
    })
  })

  describe('PATCH /secrets/:id', () => {
    it('admin 可以更新 system secret', async () => {
      const { id } = await svc.createSecret({ scope: 'system', scopeId: 'system', kind: 'mcp_credential', label: '旧标签', value: '旧值', createdBy: 1 })

      const app = createSecretVaultApi(svc)
      const res = await app.request(`http://localhost/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-role': 'ADMIN' },
        body: JSON.stringify({ label: '新标签', value: '新值' }),
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.label).toBe('新标签')
      // Value should not appear in response
      expect(body.data.value).toBeUndefined()

      // Verify new value was encrypted
      const decrypted = await svc.decryptById(id)
      expect(decrypted).toBe('新值')
    })

    it('普通用户不能更新 system secret', async () => {
      const { id } = await svc.createSecret({ scope: 'system', scopeId: 'system', kind: 'mcp_credential', label: 'SysKey', value: 'sys', createdBy: 1 })

      const app = createSecretVaultApi(svc)
      const res = await app.request(`http://localhost/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-role': 'USER' },
        body: JSON.stringify({ label: 'hack' }),
      })
      expect(res.status).toBe(403)
    })

    it('普通用户不能更新别人的 user secret', async () => {
      const { id } = await svc.createSecret({ scope: 'user', scopeId: '2', kind: 'mcp_credential', label: '别人', value: 'x', createdBy: 2 })

      const app = createSecretVaultApi(svc)
      const res = await app.request(`http://localhost/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-role': 'USER' },
        body: JSON.stringify({ label: 'hack' }),
      })
      expect(res.status).toBe(403)
    })

    it('不存在返回 404', async () => {
      const app = createSecretVaultApi(svc)
      const res = await app.request('http://localhost/99999', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-role': 'ADMIN' },
        body: JSON.stringify({ label: 'nope' }),
      })
      expect(res.status).toBe(404)
    })
  })

  describe('DELETE /secrets/:id', () => {
    it('admin 可以删除 system secret', async () => {
      const { id } = await svc.createSecret({ scope: 'system', scopeId: 'system', kind: 'mcp_credential', label: 'DelMe', value: 'x', createdBy: 1 })

      const app = createSecretVaultApi(svc)
      const res = await app.request(`http://localhost/${id}`, {
        method: 'DELETE',
        headers: { 'x-role': 'ADMIN' },
      })
      expect(res.status).toBe(200)
      expect((await res.json()).success).toBe(true)

      // Verify it's gone
      await expect(svc.getSecretView(id)).rejects.toThrow()
    })

    it('普通用户不能删除 system secret', async () => {
      const { id } = await svc.createSecret({ scope: 'system', scopeId: 'system', kind: 'mcp_credential', label: 'Sys', value: 'x', createdBy: 1 })

      const app = createSecretVaultApi(svc)
      const res = await app.request(`http://localhost/${id}`, {
        method: 'DELETE',
        headers: { 'x-role': 'USER' },
      })
      expect(res.status).toBe(403)
    })
  })

  describe('安全校验：永远不返回明文', () => {
    it('所有 API 响应都不包含 encryptedValue', async () => {
      await svc.createSecret({ scope: 'system', scopeId: 'system', kind: 'api_key', label: '测试', value: 'secret123', createdBy: 1 })

      const app = createSecretVaultApi(svc)

      // GET list
      const listRes = await app.request('http://localhost/', {
        method: 'GET',
        headers: { 'x-role': 'ADMIN' },
      })
      const listBody = await listRes.json()
      for (const item of listBody.data) {
        expect(item.encryptedValue).toBeUndefined()
        expect(typeof item.hasValue).toBe('boolean')
      }

      // PATCH response
      const list = await svc.listSecrets('system', 'system')
      const patchRes = await app.request(`http://localhost/${list[0].id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-role': 'ADMIN' },
        body: JSON.stringify({ label: '更新' }),
      })
      const patchBody = await patchRes.json()
      expect(patchBody.data.encryptedValue).toBeUndefined()
    })
  })
})
