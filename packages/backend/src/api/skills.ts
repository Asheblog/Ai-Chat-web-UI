import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import fs from 'node:fs/promises'
import path from 'node:path'
import { actorMiddleware, adminOnlyMiddleware, requireUserActor } from '../middleware/auth'
import type { Actor, ApiResponse } from '../types'
import { prisma } from '../db'
import { skillInstaller } from '../modules/skills/skill-installer'
import { skillApprovalService } from '../modules/skills/skill-approval-service'
import {
  pythonRuntimeService,
  PythonRuntimeServiceError,
} from '../services/python-runtime'
import { createLogger } from '../utils/logger'

const logger = createLogger('SkillsApi')

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

const normalizeBooleanQuery = (value: string | undefined): boolean => {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

const parseSafeInt = (value: string | undefined, fallback: number, min: number, max: number): number => {
  const parsed = Number.parseInt(value || '', 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

const parseOptionalInt = (value: string | undefined): number | null => {
  const parsed = Number.parseInt(value || '', 10)
  if (!Number.isFinite(parsed)) return null
  return parsed
}

const safeJsonObject = (raw: string | null | undefined): Record<string, unknown> => {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // ignore parse errors
  }
  return {}
}

const resolveSkillStorageRoot = (): string => {
  const configured = process.env.SKILL_STORAGE_ROOT
  if (configured && configured.trim()) {
    return path.resolve(configured.trim())
  }
  const appDataDir = process.env.APP_DATA_DIR || process.env.DATA_DIR
  if (appDataDir && appDataDir.trim()) {
    return path.resolve(appDataDir.trim(), 'skills')
  }
  return path.resolve(process.cwd(), 'data', 'skills')
}

const isSubPath = (rootDir: string, targetPath: string): boolean => {
  const normalizedRoot = path.resolve(rootDir)
  const normalizedTarget = path.resolve(targetPath)
  if (normalizedRoot === normalizedTarget) return true
  return normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`)
}

const collectPythonRequirementsFromManifest = (manifestJson: string | null | undefined): string[] => {
  if (!manifestJson) return []
  try {
    const parsed = JSON.parse(manifestJson)
    if (!parsed || typeof parsed !== 'object') return []
    const list = (parsed as Record<string, unknown>).python_packages
    if (!Array.isArray(list)) return []
    return list
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
  } catch {
    return []
  }
}

export const createSkillsApi = () => {
  const router = new Hono()

  router.get('/catalog', actorMiddleware, async (c) => {
    try {
      const actor = c.get('actor') as Actor
      const includeAll = normalizeBooleanQuery(c.req.query('all'))
      const includeVersions = normalizeBooleanQuery(c.req.query('includeVersions'))
      const isAdmin = actor.type === 'user' && actor.role === 'ADMIN'
      if ((includeAll || includeVersions) && !isAdmin) {
        return c.json<ApiResponse>({ success: false, error: 'Admin privilege required' }, 403)
      }

      const skills = await (prisma as any).skill.findMany({
        where: includeAll ? undefined : { status: 'active' },
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
          ...(includeVersions
            ? {
                versions: {
                  select: {
                    id: true,
                    version: true,
                    status: true,
                    riskLevel: true,
                    sourceRef: true,
                    sourceSubdir: true,
                    createdAt: true,
                    approvedAt: true,
                    activatedAt: true,
                    manifestJson: true,
                  },
                  orderBy: [{ createdAt: 'desc' }],
                },
              }
            : {}),
        },
        orderBy: { slug: 'asc' },
      })

      const data = skills.map((item: any) => {
        const manifest = safeJsonObject(item.defaultVersion?.manifestJson)
        const versions = Array.isArray(item.versions)
          ? item.versions.map((version: any) => ({
              id: version.id,
              version: version.version,
              status: version.status,
              riskLevel: version.riskLevel,
              sourceRef: version.sourceRef ?? null,
              sourceSubdir: version.sourceSubdir ?? null,
              createdAt: version.createdAt,
              approvedAt: version.approvedAt,
              activatedAt: version.activatedAt,
              manifest: safeJsonObject(version.manifestJson),
            }))
          : undefined
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
          ...(versions ? { versions } : {}),
        }
      })

      return c.json<ApiResponse>({ success: true, data })
    } catch (error) {
      return c.json<ApiResponse>({ success: false, error: error instanceof Error ? error.message : 'Load catalog failed' }, 500)
    }
  })

  router.get('/approvals', actorMiddleware, requireUserActor, adminOnlyMiddleware, async (c) => {
    try {
      const status = c.req.query('status')
      const scopeType = c.req.query('scopeType')
      const scopeId = c.req.query('scopeId')
      const skillIdRaw = c.req.query('skillId')
      const limit = parseSafeInt(c.req.query('limit'), 50, 1, 200)
      const where: Record<string, unknown> = {}
      const bindingWhere: Record<string, unknown> = {}
      if (status && ['pending', 'approved', 'denied', 'expired'].includes(status)) {
        where.status = status
      }
      if (scopeType && ['system', 'user', 'session', 'battle_model'].includes(scopeType)) {
        bindingWhere.scopeType = scopeType
      }
      if (scopeId) {
        bindingWhere.scopeId = scopeId
      }
      if (Object.keys(bindingWhere).length > 0) {
        where.binding = { is: bindingWhere }
      }
      if (skillIdRaw) {
        const skillId = Number.parseInt(skillIdRaw, 10)
        if (Number.isFinite(skillId)) {
          where.skillId = skillId
        }
      }

      const list = await (prisma as any).skillApprovalRequest.findMany({
        where,
        include: {
          skill: { select: { id: true, slug: true, displayName: true } },
          version: { select: { id: true, version: true, status: true, riskLevel: true } },
          binding: { select: { id: true, scopeType: true, scopeId: true } },
          decidedBy: { select: { id: true, username: true } },
        },
        orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
        take: limit,
      })

      return c.json<ApiResponse>({ success: true, data: list })
    } catch (error) {
      return c.json<ApiResponse>({ success: false, error: error instanceof Error ? error.message : 'List approvals failed' }, 500)
    }
  })

  router.get('/audits', actorMiddleware, requireUserActor, adminOnlyMiddleware, async (c) => {
    try {
      const page = parseSafeInt(c.req.query('page'), 1, 1, 1_000_000)
      const pageSize = parseSafeInt(c.req.query('pageSize') || c.req.query('limit'), 50, 1, 200)
      const skillId = parseOptionalInt(c.req.query('skillId'))
      const versionId = parseOptionalInt(c.req.query('versionId'))
      const sessionId = parseOptionalInt(c.req.query('sessionId'))
      const battleRunId = parseOptionalInt(c.req.query('battleRunId'))
      const approvalStatus = c.req.query('approvalStatus')
      const toolName = c.req.query('toolName')
      const hasError = normalizeBooleanQuery(c.req.query('hasError'))

      const where: Record<string, unknown> = {}
      if (skillId != null) where.skillId = skillId
      if (versionId != null) where.versionId = versionId
      if (sessionId != null) where.sessionId = sessionId
      if (battleRunId != null) where.battleRunId = battleRunId
      if (toolName && toolName.trim()) where.toolName = toolName.trim()
      if (
        approvalStatus &&
        ['approved', 'denied', 'expired', 'skipped'].includes(approvalStatus.trim().toLowerCase())
      ) {
        where.approvalStatus = approvalStatus.trim().toLowerCase()
      }
      if (hasError) {
        where.error = { not: null }
      }

      const [total, items] = await Promise.all([
        (prisma as any).skillExecutionAudit.count({ where }),
        (prisma as any).skillExecutionAudit.findMany({
          where,
          include: {
            skill: {
              select: { id: true, slug: true, displayName: true },
            },
            version: {
              select: { id: true, version: true, status: true, riskLevel: true },
            },
            approvalRequest: {
              select: {
                id: true,
                status: true,
                requestedAt: true,
                decidedAt: true,
                requestedByActor: true,
                decidedByUserId: true,
              },
            },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ])

      return c.json<ApiResponse>({
        success: true,
        data: {
          items,
          page,
          pageSize,
          total,
          hasMore: page * pageSize < total,
        },
      })
    } catch (error) {
      return c.json<ApiResponse>({ success: false, error: error instanceof Error ? error.message : 'List audits failed' }, 500)
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

  router.get('/:skillId/uninstall-plan', actorMiddleware, requireUserActor, adminOnlyMiddleware, async (c) => {
    try {
      const skillId = Number.parseInt(c.req.param('skillId'), 10)
      if (!Number.isFinite(skillId)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid skill id' }, 400)
      }

      const skill = await (prisma as any).skill.findUnique({
        where: { id: skillId },
        select: {
          id: true,
          slug: true,
          displayName: true,
          sourceType: true,
          versions: {
            select: {
              id: true,
              version: true,
              manifestJson: true,
              packagePath: true,
            },
          },
        },
      })

      if (!skill) {
        return c.json<ApiResponse>({ success: false, error: 'Skill not found' }, 404)
      }
      if (skill.sourceType === 'builtin') {
        return c.json<ApiResponse>({ success: false, error: 'Builtin skill cannot be uninstalled' }, 400)
      }

      const removedRequirements = Array.from(
        new Set(
          (skill.versions || []).flatMap((version: any) =>
            collectPythonRequirementsFromManifest(version.manifestJson),
          ),
        ),
      )
      const packagePaths = Array.from(
        new Set(
          (skill.versions || [])
            .map((version: any) => (typeof version.packagePath === 'string' ? version.packagePath.trim() : ''))
            .filter(Boolean),
        ),
      )

      const cleanupPlan = await pythonRuntimeService.previewCleanupAfterSkillRemoval({
        removedRequirements,
      })

      return c.json<ApiResponse>({
        success: true,
        data: {
          skillId: skill.id,
          slug: skill.slug,
          displayName: skill.displayName,
          removedRequirements,
          packagePaths,
          cleanupPlan,
        },
      })
    } catch (error) {
      if (error instanceof PythonRuntimeServiceError) {
        return c.json<ApiResponse>(
          {
            success: false,
            error: error.message,
            data: error.details ? { code: error.code, details: error.details } : { code: error.code },
          },
          error.statusCode,
        )
      }
      return c.json<ApiResponse>({ success: false, error: error instanceof Error ? error.message : 'Load uninstall plan failed' }, 500)
    }
  })

  router.delete('/:skillId', actorMiddleware, requireUserActor, adminOnlyMiddleware, async (c) => {
    try {
      const skillId = Number.parseInt(c.req.param('skillId'), 10)
      if (!Number.isFinite(skillId)) {
        return c.json<ApiResponse>({ success: false, error: 'Invalid skill id' }, 400)
      }

      const skill = await (prisma as any).skill.findUnique({
        where: { id: skillId },
        select: {
          id: true,
          slug: true,
          sourceType: true,
          versions: {
            select: {
              id: true,
              version: true,
              manifestJson: true,
              packagePath: true,
            },
          },
        },
      })

      if (!skill) {
        return c.json<ApiResponse>({ success: false, error: 'Skill not found' }, 404)
      }
      if (skill.sourceType === 'builtin') {
        return c.json<ApiResponse>({ success: false, error: 'Builtin skill cannot be uninstalled' }, 400)
      }

      const removedRequirements = Array.from(
        new Set(
          (skill.versions || []).flatMap((version: any) =>
            collectPythonRequirementsFromManifest(version.manifestJson),
          ),
        ),
      )
      const packagePaths = Array.from(
        new Set(
          (skill.versions || [])
            .map((version: any) => (typeof version.packagePath === 'string' ? version.packagePath.trim() : ''))
            .filter(Boolean),
        ),
      )

      await (prisma as any).skill.delete({
        where: { id: skill.id },
      })

      const storageRoot = resolveSkillStorageRoot()
      const removedPackageDirs: string[] = []
      const skippedPackageDirs: string[] = []
      for (const packagePath of packagePaths) {
        if (!isSubPath(storageRoot, packagePath)) {
          skippedPackageDirs.push(packagePath)
          logger.warn('skip deleting skill package path outside storage root', {
            skillId: skill.id,
            skillSlug: skill.slug,
            packagePath,
            storageRoot,
          })
          continue
        }
        try {
          await fs.rm(packagePath, { recursive: true, force: true })
          removedPackageDirs.push(packagePath)
        } catch (error) {
          skippedPackageDirs.push(packagePath)
          logger.warn('delete skill package path failed', {
            skillId: skill.id,
            skillSlug: skill.slug,
            packagePath,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      let pythonCleanup: Record<string, unknown> | null = null
      if (removedRequirements.length > 0) {
        try {
          const cleanup = await pythonRuntimeService.cleanupPackagesAfterSkillRemoval({
            removedRequirements,
          })
          pythonCleanup = cleanup as unknown as Record<string, unknown>
        } catch (error) {
          if (error instanceof PythonRuntimeServiceError) {
            pythonCleanup = {
              error: error.message,
              code: error.code,
              details: error.details,
            }
          } else {
            pythonCleanup = {
              error: error instanceof Error ? error.message : 'Unknown python cleanup error',
              code: 'PYTHON_RUNTIME_SKILL_CLEANUP_UNKNOWN_ERROR',
            }
          }
        }
      }

      logger.info('skill uninstalled', {
        skillId: skill.id,
        skillSlug: skill.slug,
        removedRequirementsCount: removedRequirements.length,
        removedPackageDirCount: removedPackageDirs.length,
        skippedPackageDirCount: skippedPackageDirs.length,
      })

      return c.json<ApiResponse>({
        success: true,
        data: {
          skillId: skill.id,
          slug: skill.slug,
          removedRequirements,
          removedPackageDirs,
          skippedPackageDirs,
          pythonCleanup,
        },
      })
    } catch (error) {
      return c.json<ApiResponse>({ success: false, error: error instanceof Error ? error.message : 'Uninstall skill failed' }, 500)
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

        const indexes = await pythonRuntimeService.getIndexes()
        if (indexes.autoInstallOnActivate) {
          let manifest: Record<string, unknown> = {}
          try {
            manifest = version.manifestJson ? JSON.parse(version.manifestJson) : {}
          } catch {
            manifest = {}
          }

          const pythonPackages = Array.isArray(manifest.python_packages)
            ? manifest.python_packages
                .map((item) => (typeof item === 'string' ? item.trim() : ''))
                .filter(Boolean)
            : []

          if (pythonPackages.length > 0) {
            try {
              await pythonRuntimeService.installRequirements({
                requirements: pythonPackages,
                source: 'skill',
                skillId,
                versionId,
              })
            } catch (error) {
              if (error instanceof PythonRuntimeServiceError) {
                return c.json<ApiResponse>(
                  {
                    success: false,
                    error: `Skill 依赖安装失败：${error.message}`,
                    data: error.details
                      ? { code: error.code, details: error.details }
                      : { code: error.code },
                  },
                  error.statusCode,
                )
              }
              throw error
            }
          }
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
