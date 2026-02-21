import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { actorMiddleware, adminOnlyMiddleware, requireUserActor } from '../middleware/auth'
import type { Actor, ApiResponse } from '../types'
import { prisma } from '../db'
import { skillInstaller } from '../modules/skills/skill-installer'
import { skillApprovalService } from '../modules/skills/skill-approval-service'

const installSchema = z.object({
  source: z.string().min(3).max(256),
  token: z.string().min(1).max(512).optional(),
})

const activateVersionSchema = z.object({
  makeDefault: z.boolean().optional(),
})

const bindingSchema = z.object({
  skillId: z.number().int().positive(),
  versionId: z.number().int().positive().nullable().optional(),
  scopeType: z.enum(['system', 'user', 'session', 'battle_model']),
  scopeId: z.string().min(1).max(128),
  enabled: z.boolean().optional(),
  policy: z.record(z.unknown()).optional(),
  overrides: z.record(z.unknown()).optional(),
})

const approvalRespondSchema = z.object({
  approved: z.boolean(),
  note: z.string().max(2000).optional(),
})

export const createSkillsApi = () => {
  const router = new Hono()

  router.get('/catalog', actorMiddleware, async (c) => {
    try {
      const skills = await (prisma as any).skill.findMany({
        where: { status: 'active' },
        include: {
          defaultVersion: {
            select: {
              id: true,
              version: true,
              status: true,
              riskLevel: true,
              manifestJson: true,
              createdAt: true,
              activatedAt: true,
            },
          },
        },
        orderBy: { slug: 'asc' },
      })

      const data = skills.map((item: any) => {
        let manifest: Record<string, unknown> = {}
        try {
          manifest = item.defaultVersion?.manifestJson ? JSON.parse(item.defaultVersion.manifestJson) : {}
        } catch {
          manifest = {}
        }
        return {
          id: item.id,
          slug: item.slug,
          displayName: item.displayName,
          description: item.description,
          sourceType: item.sourceType,
          sourceUrl: item.sourceUrl,
          status: item.status,
          defaultVersion: item.defaultVersion
            ? {
                id: item.defaultVersion.id,
                version: item.defaultVersion.version,
                status: item.defaultVersion.status,
                riskLevel: item.defaultVersion.riskLevel,
                createdAt: item.defaultVersion.createdAt,
                activatedAt: item.defaultVersion.activatedAt,
                manifest,
              }
            : null,
        }
      })

      return c.json<ApiResponse>({ success: true, data })
    } catch (error) {
      return c.json<ApiResponse>({ success: false, error: error instanceof Error ? error.message : 'Load catalog failed' }, 500)
    }
  })

  router.post('/install', actorMiddleware, requireUserActor, adminOnlyMiddleware, zValidator('json', installSchema), async (c) => {
    try {
      const actor = c.get('actor') as Actor
      const payload = c.req.valid('json')
      const actorUserId = actor.type === 'user' ? actor.id : null
      const token = payload.token || process.env.GITHUB_SKILL_TOKEN || undefined
      const result = await skillInstaller.installFromGithub({
        source: payload.source,
        actorUserId,
        token,
      })
      return c.json<ApiResponse>({ success: true, data: result })
    } catch (error) {
      return c.json<ApiResponse>({ success: false, error: error instanceof Error ? error.message : 'Install skill failed' }, 400)
    }
  })

  router.post('/:skillId/versions/:versionId/approve', actorMiddleware, requireUserActor, adminOnlyMiddleware, async (c) => {
    try {
      const skillId = Number.parseInt(c.req.param('skillId'), 10)
      const versionId = Number.parseInt(c.req.param('versionId'), 10)
      if (!Number.isFinite(skillId) || !Number.isFinite(versionId)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid id' }, 400)
      }

      const version = await (prisma as any).skillVersion.findFirst({
        where: { id: versionId, skillId },
      })
      if (!version) {
        return c.json<ApiResponse>({ success: false, error: 'Skill version not found' }, 404)
      }

      const nextStatus = version.status === 'pending_approval' ? 'pending_validation' : version.status
      const updated = await (prisma as any).skillVersion.update({
        where: { id: versionId },
        data: {
          status: nextStatus,
          approvedAt: new Date(),
        },
      })

      return c.json<ApiResponse>({ success: true, data: updated })
    } catch (error) {
      return c.json<ApiResponse>({ success: false, error: error instanceof Error ? error.message : 'Approve version failed' }, 500)
    }
  })

  router.post(
    '/:skillId/versions/:versionId/activate',
    actorMiddleware,
    requireUserActor,
    adminOnlyMiddleware,
    zValidator('json', activateVersionSchema),
    async (c) => {
      try {
        const skillId = Number.parseInt(c.req.param('skillId'), 10)
        const versionId = Number.parseInt(c.req.param('versionId'), 10)
        const payload = c.req.valid('json')
        if (!Number.isFinite(skillId) || !Number.isFinite(versionId)) {
          return c.json<ApiResponse>({ success: false, error: 'Invalid id' }, 400)
        }

        const version = await (prisma as any).skillVersion.findFirst({
          where: { id: versionId, skillId },
        })
        if (!version) {
          return c.json<ApiResponse>({ success: false, error: 'Skill version not found' }, 404)
        }

        const now = new Date()
        await (prisma as any).skillVersion.update({
          where: { id: versionId },
          data: {
            status: 'active',
            activatedAt: now,
          },
        })

        if (payload.makeDefault !== false) {
          await (prisma as any).skill.update({
            where: { id: skillId },
            data: {
              defaultVersionId: versionId,
              status: 'active',
            },
          })
        }

        return c.json<ApiResponse>({ success: true, data: { skillId, versionId, activatedAt: now } })
      } catch (error) {
        return c.json<ApiResponse>({ success: false, error: error instanceof Error ? error.message : 'Activate version failed' }, 500)
      }
    },
  )

  router.post('/bindings', actorMiddleware, requireUserActor, adminOnlyMiddleware, zValidator('json', bindingSchema), async (c) => {
    try {
      const payload = c.req.valid('json')
      const actor = c.get('actor') as Actor
      const actorUserId = actor.type === 'user' ? actor.id : null
      const upserted = await (prisma as any).skillBinding.upsert({
        where: {
          skillId_scopeType_scopeId: {
            skillId: payload.skillId,
            scopeType: payload.scopeType,
            scopeId: payload.scopeId,
          },
        },
        update: {
          versionId: payload.versionId ?? null,
          enabled: payload.enabled ?? true,
          policyJson: payload.policy ? JSON.stringify(payload.policy) : '{}',
          overridesJson: payload.overrides ? JSON.stringify(payload.overrides) : '{}',
          createdByUserId: actorUserId,
        },
        create: {
          skillId: payload.skillId,
          versionId: payload.versionId ?? null,
          scopeType: payload.scopeType,
          scopeId: payload.scopeId,
          enabled: payload.enabled ?? true,
          policyJson: payload.policy ? JSON.stringify(payload.policy) : '{}',
          overridesJson: payload.overrides ? JSON.stringify(payload.overrides) : '{}',
          createdByUserId: actorUserId,
        },
      })
      return c.json<ApiResponse>({ success: true, data: upserted })
    } catch (error) {
      return c.json<ApiResponse>({ success: false, error: error instanceof Error ? error.message : 'Upsert binding failed' }, 400)
    }
  })

  router.get('/bindings', actorMiddleware, async (c) => {
    try {
      const scopeType = c.req.query('scopeType')
      const scopeId = c.req.query('scopeId')
      const where: Record<string, unknown> = {}
      if (scopeType) where.scopeType = scopeType
      if (scopeId) where.scopeId = scopeId

      const list = await (prisma as any).skillBinding.findMany({
        where,
        include: {
          skill: {
            select: { id: true, slug: true, displayName: true },
          },
          version: {
            select: { id: true, version: true, status: true },
          },
        },
        orderBy: [{ scopeType: 'asc' }, { scopeId: 'asc' }, { id: 'desc' }],
      })

      return c.json<ApiResponse>({ success: true, data: list })
    } catch (error) {
      return c.json<ApiResponse>({ success: false, error: error instanceof Error ? error.message : 'List bindings failed' }, 500)
    }
  })

  router.delete('/bindings/:bindingId', actorMiddleware, requireUserActor, adminOnlyMiddleware, async (c) => {
    try {
      const bindingId = Number.parseInt(c.req.param('bindingId'), 10)
      if (!Number.isFinite(bindingId)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid binding id' }, 400)
      }
      await (prisma as any).skillBinding.delete({ where: { id: bindingId } })
      return c.json<ApiResponse>({ success: true, data: { id: bindingId } })
    } catch (error) {
      return c.json<ApiResponse>({ success: false, error: error instanceof Error ? error.message : 'Delete binding failed' }, 500)
    }
  })

  router.post(
    '/approvals/:requestId/respond',
    actorMiddleware,
    requireUserActor,
    adminOnlyMiddleware,
    zValidator('json', approvalRespondSchema),
    async (c) => {
      try {
        const actor = c.get('actor') as Actor
        const actorUserId = actor.type === 'user' ? actor.id : null
        if (!actorUserId) {
          return c.json<ApiResponse>({ success: false, error: 'Only user can respond approval' }, 403)
        }
        const requestId = Number.parseInt(c.req.param('requestId'), 10)
        if (!Number.isFinite(requestId)) {
          return c.json<ApiResponse>({ success: false, error: 'Invalid request id' }, 400)
        }
        const payload = c.req.valid('json')
        const updated = await skillApprovalService.respondApproval({
          requestId,
          approved: payload.approved,
          decidedByUserId: actorUserId,
          note: payload.note,
        })
        return c.json<ApiResponse>({ success: true, data: updated })
      } catch (error) {
        return c.json<ApiResponse>({ success: false, error: error instanceof Error ? error.message : 'Respond approval failed' }, 400)
      }
    },
  )

  return router
}

export default createSkillsApi
