import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { actorMiddleware, requireUserActor, adminOnlyMiddleware } from '../middleware/auth'
import type { Actor, ApiResponse } from '../types'
import { SecretVaultService, SecretVaultServiceError } from '../services/secret-vault'

const VALID_KINDS = ['api_key', 'mcp_credential', 'skill_secret'] as const

const createSchema = z.object({
  scope: z.enum(['system', 'user']),
  kind: z.enum(VALID_KINDS),
  label: z.string().min(1).max(256),
  value: z.string().min(1).max(8192),
  refType: z.string().max(64).optional(),
  refId: z.string().max(128).optional(),
})

const updateSchema = z.object({
  label: z.string().min(1).max(256).optional(),
  kind: z.enum(VALID_KINDS).optional(),
  value: z.string().min(1).max(8192).optional(),
  refType: z.string().max(64).nullable().optional(),
  refId: z.string().max(128).nullable().optional(),
})

const listQuerySchema = z.object({
  scope: z.enum(['system', 'user']).optional(),
  kind: z.enum(VALID_KINDS).optional(),
})

const isAdmin = (actor: Actor): boolean => actor.type === 'user' && actor.role === 'ADMIN'
const getUserId = (actor: Actor): number | null => actor.type === 'user' ? actor.id : null

const handleServiceError = (c: any, error: unknown, fallback: string, label: string) => {
  if (error instanceof SecretVaultServiceError) {
    return c.json({ success: false, error: error.message }, error.statusCode)
  }
  console.error(label, error)
  return c.json({ success: false, error: fallback }, 500)
}

export const createSecretVaultApi = (secretVault: SecretVaultService) => {
  const router = new Hono()

  // ─── GET /secrets ─────────────────────────────────────────────────────────

  router.get('/', actorMiddleware, zValidator('query', listQuerySchema), async (c) => {
    try {
      const actor = c.get('actor') as Actor | undefined
      if (!actor) {
        return c.json<ApiResponse>({ success: false, error: '未认证' }, 401)
      }

      const { scope, kind } = c.req.valid('query')

      if (isAdmin(actor)) {
        if (scope === 'system') {
          const data = await secretVault.listSecretsByKind('system', 'system', kind)
          return c.json<ApiResponse>({ success: true, data })
        }
        if (scope === 'user') {
          const ownId = getUserId(actor)
          const data = ownId ? await secretVault.listSecretsByKind('user', String(ownId), kind) : []
          return c.json<ApiResponse>({ success: true, data })
        }
        // No scope: system + own user
        const systemSecrets = await secretVault.listSecretsByKind('system', 'system', kind)
        const ownId = getUserId(actor)
        const userSecrets = ownId
          ? await secretVault.listSecretsByKind('user', String(ownId), kind)
          : []
        return c.json<ApiResponse>({ success: true, data: [...systemSecrets, ...userSecrets] })
      }

      // Non-admin user
      if (scope === 'system') {
        return c.json<ApiResponse>({ success: false, error: '无权查看系统级 Secret' }, 403)
      }

      const userId = getUserId(actor)
      if (!userId) {
        return c.json<ApiResponse>({ success: false, error: '未认证用户' }, 401)
      }
      const secrets = await secretVault.listSecretsByKind('user', String(userId), kind)
      return c.json<ApiResponse>({ success: true, data: secrets })
    } catch (error) {
      return handleServiceError(c, error, '获取 Secret 列表失败', 'SV:GET:/')
    }
  })

  // ─── POST /secrets ─────────────────────────────────────────────────────────

  router.post('/', actorMiddleware, requireUserActor, zValidator('json', createSchema), async (c) => {
    try {
      const actor = c.get('actor') as Actor
      const body = c.req.valid('json')

      // System scope requires admin
      if (body.scope === 'system' && !isAdmin(actor)) {
        return c.json<ApiResponse>({ success: false, error: '仅管理员可创建系统级 Secret' }, 403)
      }

      const createdBy = getUserId(actor) ?? undefined
      const scopeId = body.scope === 'system' ? 'system' : String(getUserId(actor))

      const result = await secretVault.createSecret({
        scope: body.scope,
        scopeId,
        kind: body.kind,
        label: body.label,
        value: body.value,
        refId: body.refId ?? null,
        refType: body.refType ?? null,
        createdBy: createdBy ?? null,
      })

      return c.json<ApiResponse>({ success: true, data: result }, 201)
    } catch (error) {
      return handleServiceError(c, error, '创建 Secret 失败', 'SV:POST:/')
    }
  })

  // ─── PATCH /secrets/:id ────────────────────────────────────────────────────

  router.patch('/:id', actorMiddleware, requireUserActor, zValidator('json', updateSchema), async (c) => {
    try {
      const actor = c.get('actor') as Actor
      const id = Number(c.req.param('id'))

      // Fetch current secret to check ownership
      let view: ReturnType<typeof secretVault.getSecretView> extends Promise<infer U> ? U : never
      try {
        view = await secretVault.getSecretView(id) as any
      } catch {
        return c.json<ApiResponse>({ success: false, error: 'Secret 不存在' }, 404)
      }

      // Permission check
      if (view.scope === 'system' && !isAdmin(actor)) {
        return c.json<ApiResponse>({ success: false, error: '无权修改系统级 Secret' }, 403)
      }
      if (view.scope === 'user') {
        const actorId = String(getUserId(actor))
        if (view.scopeId !== actorId && !isAdmin(actor)) {
          return c.json<ApiResponse>({ success: false, error: '无权修改此 Secret' }, 403)
        }
      }

      const body = c.req.valid('json')
      const updated = await secretVault.updateSecret(id, body)
      return c.json<ApiResponse>({ success: true, data: updated })
    } catch (error) {
      return handleServiceError(c, error, '更新 Secret 失败', 'SV:PATCH:/:id')
    }
  })

  // ─── DELETE /secrets/:id ───────────────────────────────────────────────────

  router.delete('/:id', actorMiddleware, requireUserActor, async (c) => {
    try {
      const actor = c.get('actor') as Actor
      const id = Number(c.req.param('id'))

      // Fetch current secret to check ownership
      let view: ReturnType<typeof secretVault.getSecretView> extends Promise<infer U> ? U : never
      try {
        view = await secretVault.getSecretView(id) as any
      } catch {
        return c.json<ApiResponse>({ success: false, error: 'Secret 不存在' }, 404)
      }

      // Permission check
      if (view.scope === 'system' && !isAdmin(actor)) {
        return c.json<ApiResponse>({ success: false, error: '无权删除系统级 Secret' }, 403)
      }
      if (view.scope === 'user') {
        const actorId = String(getUserId(actor))
        if (view.scopeId !== actorId && !isAdmin(actor)) {
          return c.json<ApiResponse>({ success: false, error: '无权删除此 Secret' }, 403)
        }
      }

      await secretVault.deleteSecret(id)
      return c.json<ApiResponse>({ success: true })
    } catch (error) {
      return handleServiceError(c, error, '删除 Secret 失败', 'SV:DELETE:/:id')
    }
  })

  return router
}
