import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { PrismaClient } from '@prisma/client'
import { actorMiddleware, adminOnlyMiddleware, requireUserActor } from '../middleware/auth'
import type { Actor, ApiResponse } from '../types'
import {
  type PythonRuntimeService,
  PythonRuntimeServiceError,
} from '../services/python-runtime'
import type { SkillInstaller } from '../modules/skills/skill-installer'
import type { SkillApprovalService } from '../modules/skills/skill-approval-service'
import {
  getCuratedSkillSource,
  listSkillStoreCatalog,
  resolveSkillStoreItem,
} from '../modules/skills/skill-store'
import type { SkillLicensePolicy } from '../modules/skills/skill-license'
import { createLogger } from '../utils/logger'

const logger = createLogger('SkillsApi')

const installSchema = z.object({
  source: z.string().min(3).max(512).optional(),
  itemKey: z.string().min(3).max(512).optional(),
  token: z.string().min(1).max(512).optional(),
}).refine((value) => Boolean(value.source || value.itemKey), {
  message: 'source or itemKey is required',
})

const storeQuerySchema = z.object({
  q: z.string().max(120).optional(),
  sourceKey: z.string().max(120).optional(),
  refresh: z.string().optional(),
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

const sessionSkillBindingSchema = z.object({
  skillId: z.number().int().positive(),
  versionId: z.number().int().positive(),
  enabled: z.boolean(),
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

const isUserActor = (actor: Actor): actor is Extract<Actor, { type: 'user' }> => actor.type === 'user'

const isSystemSkill = (skill: any): boolean => skill?.visibility === 'system' || skill?.sourceType === 'builtin'

const canManageSkill = (actor: Actor, skill: any): boolean => {
  if (!isUserActor(actor)) return false
  if (skill?.ownerUserId === actor.id) return true
  return actor.role === 'ADMIN' && isSystemSkill(skill)
}

const assertSessionOwner = async (prisma: PrismaClient, actor: Actor, sessionId: number): Promise<boolean> => {
  if (!isUserActor(actor)) return false
  const session = await (prisma as any).chatSession.findFirst({
    where: { id: sessionId, userId: actor.id },
    select: { id: true },
  })
  return Boolean(session)
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

export interface SkillsApiDeps {
  prisma: PrismaClient
  skillInstaller: SkillInstaller
  skillApprovalService: SkillApprovalService
  pythonRuntimeService: PythonRuntimeService
}

export const createSkillsApi = (deps: SkillsApiDeps) => {
  const { prisma, skillInstaller, skillApprovalService, pythonRuntimeService } = deps
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

      const visibleWhere =
        actor.type === 'user'
          ? {
              status: 'active',
              OR: [
                { visibility: 'system' },
                { ownerUserId: actor.id },
              ],
            }
          : {
              status: 'active',
              visibility: 'system',
            }

      const skills = await (prisma as any).skill.findMany({
        where: includeAll ? undefined : visibleWhere,
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
          namespaceKey: item.namespaceKey,
          slug: item.slug,
          displayName: item.displayName,
          description: item.description,
          sourceType: item.sourceType,
          sourceUrl: item.sourceUrl,
          sourceKey: item.sourceKey,
          storeItemKey: item.storeItemKey,
          visibility: item.visibility,
          ownerUserId: item.ownerUserId,
          licenseName: item.licenseName,
          licenseUrl: item.licenseUrl,
          licenseStatus: item.licenseStatus,
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

  router.get('/store', actorMiddleware, zValidator('query', storeQuerySchema), async (c) => {
    try {
      const actor = c.get('actor') as Actor
      const query = c.req.valid('query')
      const q = (query.q || '').trim().toLowerCase()
      const sourceKey = (query.sourceKey || '').trim()
      const catalog = await listSkillStoreCatalog({
        prisma,
        userId: actor.type === 'user' ? actor.id : null,
        refresh: normalizeBooleanQuery(query.refresh),
      })

      let items = catalog.items
      if (sourceKey) {
        items = items.filter((item) => item.sourceKey === sourceKey)
      }
      if (q) {
        items = items.filter((item) => {
          const haystack = [
            item.displayName,
            item.slug,
            item.sourceName,
            item.repository,
            item.description,
            item.tags.join(' '),
          ].join(' ').toLowerCase()
          return haystack.includes(q)
        })
      }

      return c.json<ApiResponse>({
        success: true,
        data: {
          items,
          sources: catalog.sources.map((source) => ({
            key: source.key,
            name: source.name,
            repository: `${source.owner}/${source.repo}`,
            ref: source.ref,
            description: source.description,
            homepageUrl: source.homepageUrl,
            tags: source.tags,
            status: catalog.sourceStatuses[source.key] || 'fallback',
          })),
          refreshedAt: catalog.refreshedAt,
          anonymous: actor.type !== 'user',
        },
      })
    } catch (error) {
      return c.json<ApiResponse>({ success: false, error: error instanceof Error ? error.message : 'Load skill store failed' }, 500)
    }
  })

  router.get('/session-options', actorMiddleware, requireUserActor, async (c) => {
    try {
      const actor = c.get('actor') as Actor
      if (!isUserActor(actor)) {
        return c.json<ApiResponse>({ success: false, error: 'Authentication required' }, 401)
      }
      const sessionId = parseOptionalInt(c.req.query('sessionId'))
      if (sessionId == null) {
        return c.json<ApiResponse>({ success: false, error: 'sessionId is required' }, 400)
      }
      if (!(await assertSessionOwner(prisma, actor, sessionId))) {
        return c.json<ApiResponse>({ success: false, error: 'Session not found' }, 404)
      }

      const [skills, bindings] = await Promise.all([
        (prisma as any).skill.findMany({
          where: {
            ownerUserId: actor.id,
            visibility: 'user_private',
            status: 'active',
          },
          include: {
            defaultVersion: {
              select: {
                id: true,
                version: true,
                status: true,
                riskLevel: true,
                activatedAt: true,
                manifestJson: true,
              },
            },
          },
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        }),
        (prisma as any).skillBinding.findMany({
          where: {
            scopeType: 'session',
            scopeId: String(sessionId),
            sessionId,
            createdByUserId: actor.id,
          },
          select: {
            id: true,
            skillId: true,
            versionId: true,
            enabled: true,
          },
        }),
      ])

      const bindingBySkillId = new Map<any, any>(bindings.map((binding: any) => [binding.skillId, binding]))
      const items = skills.map((skill: any) => {
        const binding = bindingBySkillId.get(skill.id)
        const defaultVersion = skill.defaultVersion
        return {
          id: skill.id,
          slug: skill.slug,
          displayName: skill.displayName,
          description: skill.description,
          sourceType: skill.sourceType,
          sourceUrl: skill.sourceUrl,
          sourceKey: skill.sourceKey,
          storeItemKey: skill.storeItemKey,
          visibility: skill.visibility,
          licenseName: skill.licenseName,
          licenseUrl: skill.licenseUrl,
          licenseStatus: skill.licenseStatus,
          defaultVersion: defaultVersion
            ? {
                id: defaultVersion.id,
                version: defaultVersion.version,
                status: defaultVersion.status,
                riskLevel: defaultVersion.riskLevel,
                activatedAt: defaultVersion.activatedAt,
                manifest: safeJsonObject(defaultVersion.manifestJson),
              }
            : null,
          sessionBinding: binding
            ? {
                id: binding.id,
                enabled: Boolean(binding.enabled),
                versionId: binding.versionId,
              }
            : null,
        }
      })

      return c.json<ApiResponse>({ success: true, data: { items } })
    } catch (error) {
      return c.json<ApiResponse>({ success: false, error: error instanceof Error ? error.message : 'Load session skills failed' }, 500)
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

  router.post('/install', actorMiddleware, requireUserActor, zValidator('json', installSchema), async (c) => {
    try {
      const actor = c.get('actor') as Actor
      const payload = c.req.valid('json')
      if (!isUserActor(actor)) {
        return c.json<ApiResponse>({ success: false, error: 'Authentication required' }, 401)
      }
      const actorUserId = actor.id
      const token = payload.token || process.env.GITHUB_SKILL_TOKEN || undefined
      let source = payload.source?.trim() || ''
      let storeItemKey: string | null = null
      let sourceKey: string | null = null
      let trustedSource = false
      let licensePolicy: SkillLicensePolicy | undefined

      if (payload.itemKey) {
        const storeItem = await resolveSkillStoreItem(payload.itemKey)
        if (!storeItem) {
          return c.json<ApiResponse>({ success: false, error: 'Skill store item not found' }, 404)
        }
        const curatedSource = getCuratedSkillSource(storeItem.sourceKey)
        if (!curatedSource) {
          return c.json<ApiResponse>({ success: false, error: 'Skill source is not curated' }, 400)
        }
        source = `${storeItem.repository}@${storeItem.ref}:${storeItem.subdir}`
        storeItemKey = storeItem.key
        sourceKey = storeItem.sourceKey
        trustedSource = true
        licensePolicy = curatedSource.licensePolicy as any
      }

      const result = await skillInstaller.installFromGithub({
        source,
        actorUserId,
        token,
        storeItemKey,
        sourceKey,
        trustedSource,
        licensePolicy: licensePolicy as any,
      })
      return c.json<ApiResponse>({ success: true, data: result })
    } catch (error) {
      return c.json<ApiResponse>({ success: false, error: error instanceof Error ? error.message : 'Install skill failed' }, 400)
    }
  })

  router.put(
    '/sessions/:sessionId',
    actorMiddleware,
    requireUserActor,
    zValidator('json', sessionSkillBindingSchema),
    async (c) => {
      try {
        const actor = c.get('actor') as Actor
        if (!isUserActor(actor)) {
          return c.json<ApiResponse>({ success: false, error: 'Authentication required' }, 401)
        }
        const sessionId = Number.parseInt(c.req.param('sessionId'), 10)
        if (!Number.isFinite(sessionId)) {
          return c.json<ApiResponse>({ success: false, error: 'Invalid session id' }, 400)
        }
        if (!(await assertSessionOwner(prisma, actor, sessionId))) {
          return c.json<ApiResponse>({ success: false, error: 'Session not found' }, 404)
        }

        const payload = c.req.valid('json')
        const version = await (prisma as any).skillVersion.findFirst({
          where: {
            id: payload.versionId,
            skillId: payload.skillId,
            status: 'active',
            skill: {
              ownerUserId: actor.id,
              visibility: 'user_private',
              status: 'active',
            },
          },
          include: {
            skill: {
              select: {
                id: true,
                slug: true,
                displayName: true,
                ownerUserId: true,
              },
            },
          },
        })
        if (!version) {
          return c.json<ApiResponse>({ success: false, error: 'Skill version not found' }, 404)
        }

        const binding = await (prisma as any).skillBinding.upsert({
          where: {
            skillId_scopeType_scopeId: {
              skillId: payload.skillId,
              scopeType: 'session',
              scopeId: String(sessionId),
            },
          },
          update: {
            versionId: payload.versionId,
            sessionId,
            enabled: payload.enabled,
            createdByUserId: actor.id,
          },
          create: {
            skillId: payload.skillId,
            versionId: payload.versionId,
            scopeType: 'session',
            scopeId: String(sessionId),
            sessionId,
            enabled: payload.enabled,
            createdByUserId: actor.id,
            policyJson: '{}',
            overridesJson: '{}',
          },
        })

        return c.json<ApiResponse>({
          success: true,
          data: {
            ...binding,
            skill: version.skill,
            version: {
              id: version.id,
              version: version.version,
              status: version.status,
            },
          },
        })
      } catch (error) {
        return c.json<ApiResponse>({ success: false, error: error instanceof Error ? error.message : 'Update session skill failed' }, 400)
      }
    },
  )

  router.get('/:skillId/uninstall-plan', actorMiddleware, requireUserActor, async (c) => {
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
          visibility: true,
          ownerUserId: true,
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
      const actor = c.get('actor') as Actor
      if (!canManageSkill(actor, skill)) {
        return c.json<ApiResponse>({ success: false, error: 'Skill not found' }, 404)
      }

      const removedRequirements: string[] = Array.from(
        new Set<string>(
          (skill.versions || []).flatMap((version: any) =>
            collectPythonRequirementsFromManifest(version.manifestJson),
          ),
        ),
      )
      const packagePaths: string[] = Array.from(
        new Set<string>(
          (skill.versions || [])
            .map((version: any) => (typeof version.packagePath === 'string' ? version.packagePath.trim() : ''))
            .filter(Boolean),
        ),
      )

      const cleanupPlan = await pythonRuntimeService.previewCleanupAfterSkillRemoval({
        removedRequirements,
        excludeSkillIds: [skill.id],
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
          error.statusCode as any,
        )
      }
      return c.json<ApiResponse>({ success: false, error: error instanceof Error ? error.message : 'Load uninstall plan failed' }, 500)
    }
  })

  router.delete('/:skillId', actorMiddleware, requireUserActor, async (c) => {
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
          visibility: true,
          ownerUserId: true,
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
      const actor = c.get('actor') as Actor
      if (!canManageSkill(actor, skill)) {
        return c.json<ApiResponse>({ success: false, error: 'Skill not found' }, 404)
      }

      const removedRequirements: string[] = Array.from(
        new Set<string>(
          (skill.versions || []).flatMap((version: any) =>
            collectPythonRequirementsFromManifest(version.manifestJson),
          ),
        ),
      )
      const packagePaths: string[] = Array.from(
        new Set<string>(
          (skill.versions || [])
            .map((version: any) => (typeof version.packagePath === 'string' ? version.packagePath.trim() : ''))
            .filter(Boolean),
        ),
      )
      const packageSelfReferenceCounts = new Map<string, number>()
      for (const version of skill.versions || []) {
        const packagePath = typeof version.packagePath === 'string' ? version.packagePath.trim() : ''
        if (!packagePath) continue
        packageSelfReferenceCounts.set(packagePath, (packageSelfReferenceCounts.get(packagePath) || 0) + 1)
      }
      const packageReferenceCounts = new Map<string, number>(
        await Promise.all(
          packagePaths.map(async (packagePath) => [
            packagePath,
            await (prisma as any).skillVersion.count({ where: { packagePath } }),
          ] as const),
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
        const referenceCountBeforeDelete = packageReferenceCounts.get(packagePath) || 0
        const selfReferenceCountBeforeDelete = packageSelfReferenceCounts.get(packagePath) || 0
        if (referenceCountBeforeDelete > selfReferenceCountBeforeDelete) {
          skippedPackageDirs.push(packagePath)
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
                  error.statusCode as any,
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
      const sessionId =
        payload.scopeType === 'session'
          ? Number.parseInt(payload.scopeId, 10)
          : null
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
          sessionId: Number.isFinite(sessionId) && sessionId && sessionId > 0 ? sessionId : null,
          enabled: payload.enabled ?? true,
          policyJson: payload.policy ? JSON.stringify(payload.policy) : '{}',
          overridesJson: payload.overrides ? JSON.stringify(payload.overrides) : '{}',
          createdByUserId: actorUserId,
        },
        create: {
          skillId: payload.skillId,
          versionId: payload.versionId ?? null,
          sessionId: Number.isFinite(sessionId) && sessionId && sessionId > 0 ? sessionId : null,
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
