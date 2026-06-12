import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { actorMiddleware, requireUserActor, adminOnlyMiddleware } from '../middleware/auth'
import type { Actor, ApiResponse } from '../types'
import { McpService, McpServiceError } from '../services/mcp'
import { prisma } from '../db'

const handleServiceError = (c: any, error: unknown, fallback: string, label: string) => {
  if (error instanceof McpServiceError) {
    return c.json({ success: false, error: error.message }, error.statusCode)
  }
  console.error(label, error)
  return c.json({ success: false, error: fallback }, 500)
}

const isAdmin = (actor: Actor): boolean => actor.type === 'user' && actor.role === 'ADMIN'

/** Resolve the set of connection IDs visible to the given actor. */
async function getActorVisibleConnectionIds(svc: McpService, actor: Actor): Promise<Set<number>> {
  if (isAdmin(actor)) {
    // Admin sees all — return all connection IDs
    const conns = await svc.listConnections({})
    return new Set(conns.map((c) => c.id))
  }
  const userId = actor.type === 'user' ? actor.id : null
  const conns = await svc.listConnections({})
  return new Set(
    conns
      .filter((c) => c.ownerUserId === null || c.ownerUserId === userId)
      .map((c) => c.id),
  )
}

/**
 * Validate that a session belongs to the actor (user by userId, anonymous by anonymousKey).
 * Returns true if the actor owns (or is admin and can see) the session.
 */
async function assertSessionOwnership(actor: Actor, sessionId: number, allowAdmin = false): Promise<boolean> {
  if (allowAdmin && isAdmin(actor)) return true
  const where: Record<string, unknown> = { id: sessionId }
  if (actor.type === 'user') {
    where.userId = actor.id
  } else {
    where.anonymousKey = actor.key
  }
  const session = await (prisma as any).chatSession.findFirst({ where, select: { id: true } })
  return Boolean(session)
}

/**
 * Validate that a binding's scope is within the actor's authority.
 * Admin can manage any scope. Non-admin can only manage their own user/session scopes.
 */
function isBindingWithinActorScope(actor: Actor, scopeType: string, scopeId: string): boolean {
  if (isAdmin(actor)) return true
  if (scopeType === 'system' || scopeType === 'battle_model') return false
  if (scopeType === 'user') {
    if (actor.type !== 'user') return false
    return scopeId === String(actor.id)
  }
  if (scopeType === 'session') return true // session ownership checked separately via assertSessionOwnership
  return false
}

const installationSchema = z.object({
  namespaceKey: z.string().min(3).max(256),
  name: z.string().min(1).max(256),
  description: z.string().max(2000).optional(),
  sourceType: z.enum(['remote', 'local_package']).optional().default('remote'),
  sourceUrl: z.string().max(2048).optional(),
  sourceKey: z.string().max(256).optional(),
  registrySource: z.string().max(256).optional(),
  transport: z.enum(['streamable_http', 'sse', 'stdio']).optional().default('streamable_http'),
  endpoint: z.string().max(2048).optional(),
  command: z.string().max(2048).optional(),
  argsJson: z.string().optional(),
  envJson: z.string().optional(),
})

const connectionSchema = z.object({
  installationId: z.number().int().positive(),
  name: z.string().min(1).max(256),
  enabled: z.boolean().optional().default(true),
  configJson: z.string().optional(),
  secretVaultId: z.number().int().positive().optional(),
})

const connectionUpdateSchema = z.object({
  name: z.string().min(1).max(256).optional(),
  enabled: z.boolean().optional(),
  configJson: z.string().optional(),
  secretVaultId: z.number().int().positive().nullable().optional(),
  status: z.enum(['active', 'error', 'disabled']).optional(),
})

const bindingSchema = z.object({
  connectionId: z.number().int().positive(),
  scopeType: z.enum(['system', 'user', 'session', 'battle_model']),
  scopeId: z.string().min(1).max(128),
  enabled: z.boolean().optional().default(true),
})

const bindingUpdateSchema = z.object({
  enabled: z.boolean(),
})

const toolPinSchema = z.object({
  connectionId: z.number().int().positive(),
  originalName: z.string().min(1).max(256),
})

const toolSearchSchema = z.object({
  q: z.string().min(1).max(256),
})

export interface McpApiDeps {
  mcpService: McpService
}

export const createMcpApi = (deps: McpApiDeps) => {
  const svc = deps.mcpService
  const router = new Hono()

  // --- Installations (admin only) ---

  router.post(
    '/installations',
    actorMiddleware,
    adminOnlyMiddleware,
    zValidator('json', installationSchema),
    async (c) => {
      try {
        const body = c.req.valid('json')
        const inst = await svc.createInstallation(body, true)
        return c.json({ success: true, data: inst } satisfies ApiResponse, 201)
      } catch (error) {
        return handleServiceError(c, error, '创建 MCP 安装失败', 'MCP:POST:/installations')
      }
    },
  )

  router.get('/installations', actorMiddleware, async (c) => {
    try {
      const sourceType = c.req.query('sourceType')
      const status = c.req.query('status')
      const list = await svc.listInstallations({ sourceType, status })
      return c.json({ success: true, data: list } satisfies ApiResponse)
    } catch (error) {
      return handleServiceError(c, error, '获取 MCP 安装列表失败', 'MCP:GET:/installations')
    }
  })

  router.get('/installations/:id', actorMiddleware, async (c) => {
    try {
      const id = Number(c.req.param('id'))
      const inst = await svc.getInstallation(id)
      return c.json({ success: true, data: inst } satisfies ApiResponse)
    } catch (error) {
      return handleServiceError(c, error, '获取 MCP 安装失败', 'MCP:GET:/installations/:id')
    }
  })

  router.patch(
    '/installations/:id',
    actorMiddleware,
    adminOnlyMiddleware,
    zValidator('json', installationSchema.partial()),
    async (c) => {
      try {
        const id = Number(c.req.param('id'))
        const body = c.req.valid('json')
        const inst = await svc.updateInstallation(id, body)
        return c.json({ success: true, data: inst } satisfies ApiResponse)
      } catch (error) {
        return handleServiceError(c, error, '更新 MCP 安装失败', 'MCP:PATCH:/installations/:id')
      }
    },
  )

  // --- Connections ---

  router.post(
    '/connections',
    actorMiddleware,
    requireUserActor,
    zValidator('json', connectionSchema),
    async (c) => {
      try {
        const actor = c.get('actor') as Actor
        const body = c.req.valid('json')
        const isAdmin = actor.type === 'user' && actor.role === 'ADMIN'
        const conn = await svc.createConnection(
          { ...body, ownerUserId: actor.type === 'user' ? actor.id : null },
          isAdmin,
        )
        return c.json({ success: true, data: conn } satisfies ApiResponse, 201)
      } catch (error) {
        return handleServiceError(c, error, '创建 MCP 连接失败', 'MCP:POST:/connections')
      }
    },
  )

  router.post(
    '/connections/system',
    actorMiddleware,
    adminOnlyMiddleware,
    zValidator('json', connectionSchema),
    async (c) => {
      try {
        const body = c.req.valid('json')
        const conn = await svc.createConnection(
          { ...body, ownerUserId: null },
          true,
        )
        return c.json({ success: true, data: conn } satisfies ApiResponse, 201)
      } catch (error) {
        return handleServiceError(c, error, '创建系统 MCP 连接失败', 'MCP:POST:/connections/system')
      }
    },
  )

  router.get('/connections', actorMiddleware, async (c) => {
    try {
      const actor = c.get('actor') as Actor
      const isAdmin = actor.type === 'user' && actor.role === 'ADMIN'
      const installationId = c.req.query('installationId')
      const status = c.req.query('status')
      const mine = c.req.query('mine') === 'true'
      const list = await svc.listConnections({
        installationId: installationId ? Number(installationId) : undefined,
        status,
      })
      // Non-admin: only see own connections or system-shared connections
      if (!isAdmin || mine) {
        const userId = actor.type === 'user' ? actor.id : null
        return c.json({
          success: true,
          data: list.filter((conn) => conn.ownerUserId === null || conn.ownerUserId === userId),
        } satisfies ApiResponse)
      }
      return c.json({ success: true, data: list } satisfies ApiResponse)
    } catch (error) {
      return handleServiceError(c, error, '获取 MCP 连接列表失败', 'MCP:GET:/connections')
    }
  })

  router.get('/connections/:id', actorMiddleware, async (c) => {
    try {
      const id = Number(c.req.param('id'))
      const actor = c.get('actor') as Actor
      const conn = await svc.getConnection(id)
      // Non-admin users can only access their own connections or system-shared connections
      if (actor.type !== 'user' || actor.role !== 'ADMIN') {
        const ownerId = actor.type === 'user' ? actor.id : null
        if (conn.ownerUserId !== null && conn.ownerUserId !== ownerId) {
          return c.json({ success: false, error: '无权访问此 MCP 连接' }, 403)
        }
      }
      return c.json({ success: true, data: conn } satisfies ApiResponse)
    } catch (error) {
      return handleServiceError(c, error, '获取 MCP 连接失败', 'MCP:GET:/connections/:id')
    }
  })

  router.patch(
    '/connections/:id',
    actorMiddleware,
    requireUserActor,
    zValidator('json', connectionUpdateSchema),
    async (c) => {
      try {
        const id = Number(c.req.param('id'))
        const actor = c.get('actor') as Actor
        const conn = await svc.getConnection(id)
        // Non-admin users can only modify their own connections (not system-shared)
        if (actor.type !== 'user' || actor.role !== 'ADMIN') {
          if (conn.ownerUserId === null) {
            return c.json({ success: false, error: '无权修改系统共享连接' }, 403)
          }
          const ownerId = actor.type === 'user' ? actor.id : null
          if (conn.ownerUserId !== ownerId) {
            return c.json({ success: false, error: '无权访问此 MCP 连接' }, 403)
          }
        }
        const body = c.req.valid('json')
        const updated = await svc.updateConnection(id, body)
        return c.json({ success: true, data: updated } satisfies ApiResponse)
      } catch (error) {
        return handleServiceError(c, error, '更新 MCP 连接失败', 'MCP:PATCH:/connections/:id')
      }
    },
  )

  router.delete('/connections/:id', actorMiddleware, adminOnlyMiddleware, async (c) => {
    try {
      const id = Number(c.req.param('id'))
      await svc.deleteConnection(id)
      return c.json({ success: true } satisfies ApiResponse)
    } catch (error) {
      return handleServiceError(c, error, '删除 MCP 连接失败', 'MCP:DELETE:/connections/:id')
    }
  })

  // --- Bindings ---

  router.post(
    '/bindings',
    actorMiddleware,
    requireUserActor,
    zValidator('json', bindingSchema),
    async (c) => {
      try {
        const actor = c.get('actor') as Actor
        const body = c.req.valid('json')

        // Scope authority check
        if (!isBindingWithinActorScope(actor, body.scopeType, body.scopeId)) {
          return c.json({ success: false, error: '无权创建此范围的绑定' }, 403)
        }

        // Session scope: verify session ownership
        if (body.scopeType === 'session') {
          const sid = Number(body.scopeId)
          if (!Number.isFinite(sid) || sid <= 0) {
            return c.json({ success: false, error: '无效的 scopeId' }, 400)
          }
          if (!(await assertSessionOwnership(actor, sid, false))) {
            return c.json({ success: false, error: '无权访问此会话' }, 404)
          }
        }

        // Connection visibility: must be own or system-shared (admin can bind any)
        const visibleIds = await getActorVisibleConnectionIds(svc, actor)
        if (!visibleIds.has(body.connectionId)) {
          return c.json({ success: false, error: '无权访问此 MCP 连接' }, 403)
        }

        const binding = await svc.bindConnection({
          ...body,
          createdBy: actor.type === 'user' ? actor.id : null,
        })
        return c.json({ success: true, data: binding } satisfies ApiResponse, 201)
      } catch (error) {
        return handleServiceError(c, error, '创建 MCP 绑定失败', 'MCP:POST:/bindings')
      }
    },
  )

  router.get('/bindings', actorMiddleware, async (c) => {
    try {
      const actor = c.get('actor') as Actor

      if (isAdmin(actor)) {
        // Admin: existing behavior with optional filters
        const scopeType = c.req.query('scopeType')
        const scopeId = c.req.query('scopeId')
        const connectionId = c.req.query('connectionId')
        const list = await svc.listBindings({
          scopeType,
          scopeId,
          connectionId: connectionId ? Number(connectionId) : undefined,
        })
        return c.json({ success: true, data: list } satisfies ApiResponse)
      }

      // Non-admin: scope to own user/session bindings on visible connections
      const visibleIds = await getActorVisibleConnectionIds(svc, actor)
      const allBindings = await svc.listBindings({})
      const filtered: Array<typeof allBindings[number]> = []
      for (const b of allBindings) {
        // Only user or session scope bindings
        if (b.scopeType === 'system' || b.scopeType === 'battle_model') continue
        // User scope must match actor's userId
        if (b.scopeType === 'user') {
          if (actor.type !== 'user') continue
          if (b.scopeId !== String(actor.id)) continue
          if (!visibleIds.has(b.connectionId)) continue
          filtered.push(b)
          continue
        }
        // Session scope: must belong to the actor
        if (b.scopeType === 'session') {
          const sid = Number(b.scopeId)
          if (!Number.isFinite(sid) || sid <= 0) continue
          if (!(await assertSessionOwnership(actor, sid, false))) continue
          // Connection must be visible
          if (!visibleIds.has(b.connectionId)) continue
          filtered.push(b)
        }
      }
      return c.json({ success: true, data: filtered } satisfies ApiResponse)
    } catch (error) {
      return handleServiceError(c, error, '获取 MCP 绑定列表失败', 'MCP:GET:/bindings')
    }
  })

  router.patch(
    '/bindings/:id',
    actorMiddleware,
    requireUserActor,
    zValidator('json', bindingUpdateSchema),
    async (c) => {
      try {
        const id = Number(c.req.param('id'))
        const actor = c.get('actor') as Actor
        const body = c.req.valid('json')

        // Fetch the binding to check ownership
        const allBindings = await svc.listBindings({})
        const binding = allBindings.find((b) => b.id === id)
        if (!binding) {
          return c.json({ success: false, error: '绑定不存在' }, 404)
        }

        // Admin can update any binding
        if (!isAdmin(actor)) {
          if (!isBindingWithinActorScope(actor, binding.scopeType, binding.scopeId)) {
            return c.json({ success: false, error: '无权修改此绑定' }, 403)
          }
          // Session scope: verify session ownership
          if (binding.scopeType === 'session') {
            const sid = Number(binding.scopeId)
            if (!Number.isFinite(sid) || sid <= 0) {
              return c.json({ success: false, error: '绑定数据异常' }, 400)
            }
            if (!(await assertSessionOwnership(actor, sid, false))) {
              return c.json({ success: false, error: '无权访问此会话' }, 404)
            }
          }
          // Connection visibility
          const visibleIds = await getActorVisibleConnectionIds(svc, actor)
          if (!visibleIds.has(binding.connectionId)) {
            return c.json({ success: false, error: '无权访问此绑定关联的连接' }, 403)
          }
        }

        const updated = await svc.updateBinding(id, body)
        return c.json({ success: true, data: updated } satisfies ApiResponse)
      } catch (error) {
        return handleServiceError(c, error, '更新 MCP 绑定失败', 'MCP:PATCH:/bindings/:id')
      }
    },
  )

  router.delete('/bindings/:id', actorMiddleware, requireUserActor, async (c) => {
    try {
      const id = Number(c.req.param('id'))
      const actor = c.get('actor') as Actor

      // Fetch the binding to check ownership
      const allBindings = await svc.listBindings({})
      const binding = allBindings.find((b) => b.id === id)
      if (!binding) {
        return c.json({ success: false, error: '绑定不存在' }, 404)
      }

      // Admin can delete any binding
      if (!isAdmin(actor)) {
        if (!isBindingWithinActorScope(actor, binding.scopeType, binding.scopeId)) {
          return c.json({ success: false, error: '无权删除此绑定' }, 403)
        }
        if (binding.scopeType === 'session') {
          const sid = Number(binding.scopeId)
          if (!Number.isFinite(sid) || sid <= 0) {
            return c.json({ success: false, error: '绑定数据异常' }, 400)
          }
          if (!(await assertSessionOwnership(actor, sid, false))) {
            return c.json({ success: false, error: '无权访问此会话' }, 404)
          }
        }
        const visibleIds = await getActorVisibleConnectionIds(svc, actor)
        if (!visibleIds.has(binding.connectionId)) {
          return c.json({ success: false, error: '无权访问此绑定关联的连接' }, 403)
        }
      }

      await svc.deleteBinding(id)
      return c.json({ success: true } satisfies ApiResponse)
    } catch (error) {
      return handleServiceError(c, error, '删除 MCP 绑定失败', 'MCP:DELETE:/bindings/:id')
    }
  })

  // --- Tool Cache ---

  router.post(
    '/connections/:id/refresh-tools',
    actorMiddleware,
    adminOnlyMiddleware,
    async (c) => {
      try {
        const id = Number(c.req.param('id'))
        const revision = await svc.refreshToolCache(id)
        return c.json({ success: true, data: { toolSetRevision: revision } } satisfies ApiResponse)
      } catch (error) {
        return handleServiceError(c, error, '刷新 MCP 工具缓存失败', 'MCP:POST:/connections/:id/refresh-tools')
      }
    },
  )

  router.get('/tools/search', actorMiddleware, zValidator('query', toolSearchSchema), async (c) => {
    try {
      const actor = c.get('actor') as Actor
      const { q } = c.req.valid('query')

      if (isAdmin(actor)) {
        const tools = await svc.searchTools(q)
        return c.json({ success: true, data: tools } satisfies ApiResponse)
      }

      // Non-admin: scope to visible connections
      const visibleIds = await getActorVisibleConnectionIds(svc, actor)
      const tools = await svc.searchTools(q)
      const filtered = tools.filter((t) => visibleIds.has(t.connectionId))
      return c.json({ success: true, data: filtered } satisfies ApiResponse)
    } catch (error) {
      return handleServiceError(c, error, '搜索 MCP 工具失败', 'MCP:GET:/tools/search')
    }
  })

  router.get('/tools/:connectionId/:originalName', actorMiddleware, async (c) => {
    try {
      const connectionId = Number(c.req.param('connectionId'))
      const originalName = c.req.param('originalName')
      const actor = c.get('actor') as Actor

      // Non-admin: check connection visibility
      if (!isAdmin(actor)) {
        const visibleIds = await getActorVisibleConnectionIds(svc, actor)
        if (!visibleIds.has(connectionId)) {
          return c.json({ success: false, error: '无权访问此连接的工具' }, 404)
        }
      }

      const tool = await svc.getToolDetail(connectionId, originalName)
      return c.json({ success: true, data: tool } satisfies ApiResponse)
    } catch (error) {
      return handleServiceError(c, error, '获取 MCP 工具详情失败', 'MCP:GET:/tools/:connectionId/:originalName')
    }
  })

  router.post(
    '/tools/pin',
    actorMiddleware,
    requireUserActor,
    zValidator('json', toolPinSchema),
    async (c) => {
      try {
        const actor = c.get('actor') as Actor
        const { connectionId, originalName } = c.req.valid('json')

        // Admin can pin any connection's tools
        if (isAdmin(actor)) {
          const tool = await svc.pinTool(connectionId, originalName, (actor as any).id)
          return c.json({ success: true, data: tool } satisfies ApiResponse)
        }

        // Non-admin: only pin on own connections (ownerUserId=theirId), not system-shared
        const conns = await svc.listConnections({})
        const targetConn = conns.find((c) => c.id === connectionId)
        if (!targetConn) {
          return c.json({ success: false, error: 'MCP 连接不存在' }, 404)
        }
        if (targetConn.ownerUserId === null) {
          // System-shared connections: non-admin cannot modify pin state
          return c.json({ success: false, error: '无权修改系统共享连接的固定状态' }, 403)
        }
        if (actor.type !== 'user' || targetConn.ownerUserId !== actor.id) {
          return c.json({ success: false, error: '无权固定此连接的工具' }, 403)
        }

        const tool = await svc.pinTool(connectionId, originalName, actor.id)
        return c.json({ success: true, data: tool } satisfies ApiResponse)
      } catch (error) {
        return handleServiceError(c, error, '固定 MCP 工具失败', 'MCP:POST:/tools/pin')
      }
    },
  )

  router.post(
    '/tools/unpin',
    actorMiddleware,
    requireUserActor,
    zValidator('json', toolPinSchema),
    async (c) => {
      try {
        const actor = c.get('actor') as Actor
        const { connectionId, originalName } = c.req.valid('json')

        // Admin can unpin any
        if (isAdmin(actor)) {
          const tool = await svc.unpinTool(connectionId, originalName)
          return c.json({ success: true, data: tool } satisfies ApiResponse)
        }

        // Non-admin: only unpin on own connections, not system-shared
        const conns = await svc.listConnections({})
        const targetConn = conns.find((c) => c.id === connectionId)
        if (!targetConn) {
          return c.json({ success: false, error: 'MCP 连接不存在' }, 404)
        }
        if (targetConn.ownerUserId === null) {
          return c.json({ success: false, error: '无权修改系统共享连接的固定状态' }, 403)
        }
        if (actor.type !== 'user' || targetConn.ownerUserId !== actor.id) {
          return c.json({ success: false, error: '无权取消固定此连接的工具' }, 403)
        }

        const tool = await svc.unpinTool(connectionId, originalName)
        return c.json({ success: true, data: tool } satisfies ApiResponse)
      } catch (error) {
        return handleServiceError(c, error, '取消固定 MCP 工具失败', 'MCP:POST:/tools/unpin')
      }
    },
  )

  // --- Session Tools (for chat) ---

  router.get('/sessions/:sessionId/tools', actorMiddleware, async (c) => {
    try {
      const sessionId = Number(c.req.param('sessionId'))
      const actor = c.get('actor') as Actor

      // Validate session ownership (admin also must own or have access)
      if (!(await assertSessionOwnership(actor, sessionId, true))) {
        return c.json({ success: false, error: '会话不存在或无权访问' }, 404)
      }

      const tools = await svc.listToolsForSession(sessionId)
      return c.json({ success: true, data: tools } satisfies ApiResponse)
    } catch (error) {
      return handleServiceError(c, error, '获取会话 MCP 工具失败', 'MCP:GET:/sessions/:sessionId/tools')
    }
  })

  return router
}
