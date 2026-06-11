jest.mock('../../middleware/auth', () => ({
  actorMiddleware: async (c: any, next: any) => {
    if ((c.req.header('x-actor') || '').toLowerCase() === 'anonymous') {
      c.set('actor', {
        type: 'anonymous',
        key: 'anon-1',
        identifier: 'anon:anon-1',
      })
      await next()
      return
    }
    const role = (c.req.header('x-role') || 'ADMIN').toUpperCase()
    const id = Number.parseInt(c.req.header('x-user-id') || '1', 10)
    c.set('actor', {
      type: 'user',
      id,
      role,
      status: 'ACTIVE',
      username: `tester-${id}`,
      identifier: `user:${id}`,
    })
    c.set('user', {
      id,
      username: `tester-${id}`,
      role,
      status: 'ACTIVE',
    })
    await next()
  },
  requireUserActor: async (_c: any, next: any) => next(),
  adminOnlyMiddleware: async (c: any, next: any) => {
    const actor = c.get('actor')
    if (!actor || actor.role !== 'ADMIN') {
      return c.json({ success: false, error: 'Admin required' }, 403)
    }
    await next()
  },
}))

jest.mock('../../db', () => ({
  prisma: {
    chatSession: {
      findFirst: jest.fn(),
    },
    skill: {
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
    skillVersion: {
      count: jest.fn(),
      findFirst: jest.fn(),
    },
    skillBinding: {
      upsert: jest.fn(),
    },
  },
}))

jest.mock('../../modules/skills/skill-installer', () => ({
  skillInstaller: {
    installFromGithub: jest.fn(),
  },
}))

jest.mock('../../modules/skills/skill-approval-service', () => ({
  skillApprovalService: {
    respondApproval: jest.fn(),
  },
}))

jest.mock('../../services/python-runtime', () => {
  class PythonRuntimeServiceError extends Error {
    statusCode: number
    code: string
    details?: Record<string, unknown>

    constructor(message: string, statusCode = 400, code = 'PYTHON_RUNTIME_ERROR', details?: Record<string, unknown>) {
      super(message)
      this.name = 'PythonRuntimeServiceError'
      this.statusCode = statusCode
      this.code = code
      this.details = details
    }
  }

  return {
    pythonRuntimeService: {
      getIndexes: jest.fn(),
      installRequirements: jest.fn(),
      previewCleanupAfterSkillRemoval: jest.fn(),
      cleanupPackagesAfterSkillRemoval: jest.fn(),
    },
    PythonRuntimeServiceError,
  }
})

import { createSkillsApi } from '../skills'
import { prisma } from '../../db'
import { pythonRuntimeService } from '../../services/python-runtime'
import { skillInstaller } from '../../modules/skills/skill-installer'
import { skillApprovalService } from '../../modules/skills/skill-approval-service'

const createApp = () =>
  createSkillsApi({
    prisma: prisma as any,
    skillInstaller: skillInstaller as any,
    skillApprovalService: skillApprovalService as any,
    pythonRuntimeService: pythonRuntimeService as any,
  })

describe('skills api - uninstall skill', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    const prismaMock = prisma as any
    prismaMock.skillVersion.count.mockResolvedValue(0)
  })

  it('lets the owner delete a private third-party skill and triggers python cleanup', async () => {
    const prismaMock = prisma as any
    const runtimeMock = pythonRuntimeService as any

    prismaMock.skill.findUnique.mockResolvedValue({
      id: 12,
      slug: 'data-agent',
      ownerUserId: 1,
      sourceType: 'github',
      visibility: 'user_private',
      versions: [
        {
          id: 101,
          version: '1.0.0',
          manifestJson: JSON.stringify({
            python_packages: ['numpy==2.1.0', 'pandas>=2.2'],
          }),
          packagePath: null,
        },
      ],
    })
    prismaMock.skill.delete.mockResolvedValue({ id: 12 })
    runtimeMock.cleanupPackagesAfterSkillRemoval.mockResolvedValue({
      removedSkillPackages: ['numpy', 'pandas'],
      keptByActiveSkills: [],
      keptByManual: [],
      removedPackages: ['numpy', 'pandas'],
    })

    const app = createApp()
    const res = await app.request('http://localhost/12', {
      method: 'DELETE',
      headers: { 'x-role': 'USER', 'x-user-id': '1' },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(prismaMock.skill.delete).toHaveBeenCalledWith({ where: { id: 12 } })
    expect(runtimeMock.cleanupPackagesAfterSkillRemoval).toHaveBeenCalledWith({
      removedRequirements: expect.arrayContaining(['numpy==2.1.0', 'pandas>=2.2']),
    })
  })

  it('returns uninstall dry-run plan', async () => {
    const prismaMock = prisma as any
    const runtimeMock = pythonRuntimeService as any

    prismaMock.skill.findUnique.mockResolvedValue({
      id: 12,
      slug: 'data-agent',
      displayName: 'Data Agent',
      ownerUserId: 1,
      sourceType: 'github',
      visibility: 'user_private',
      versions: [
        {
          id: 101,
          version: '1.0.0',
          manifestJson: JSON.stringify({
            python_packages: ['numpy==2.1.0', 'pandas>=2.2'],
          }),
          packagePath: '/app/data/skills/packages/data-agent/101',
        },
      ],
    })
    runtimeMock.previewCleanupAfterSkillRemoval.mockResolvedValue({
      removedSkillPackages: ['numpy', 'pandas'],
      keptByActiveSkills: ['numpy'],
      keptByActiveSkillSources: [
        {
          packageName: 'numpy',
          consumers: [
            {
              skillId: 88,
              skillSlug: 'calc-agent',
              skillDisplayName: 'Calc Agent',
              versionId: 901,
              version: '1.2.0',
              requirement: 'numpy>=2.0',
            },
          ],
        },
      ],
      keptByManual: [],
      removablePackages: ['pandas'],
    })

    const app = createApp()
    const res = await app.request('http://localhost/12/uninstall-plan', {
      method: 'GET',
      headers: { 'x-role': 'USER', 'x-user-id': '1' },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(runtimeMock.previewCleanupAfterSkillRemoval).toHaveBeenCalledWith({
      removedRequirements: expect.arrayContaining(['numpy==2.1.0', 'pandas>=2.2']),
      excludeSkillIds: [12],
    })
    expect(body.data.cleanupPlan.removablePackages).toEqual(['pandas'])
    expect(body.data.cleanupPlan.keptByActiveSkillSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          packageName: 'numpy',
        }),
      ]),
    )
  })

  it('blocks uninstalling builtin skill', async () => {
    const prismaMock = prisma as any
    const runtimeMock = pythonRuntimeService as any
    prismaMock.skill.findUnique.mockResolvedValue({
      id: 1,
      slug: 'python-runner',
      sourceType: 'builtin',
      visibility: 'system',
      versions: [],
    })

    const app = createApp()
    const res = await app.request('http://localhost/1', {
      method: 'DELETE',
      headers: { 'x-role': 'ADMIN' },
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(prismaMock.skill.delete).not.toHaveBeenCalled()
    expect(runtimeMock.cleanupPackagesAfterSkillRemoval).not.toHaveBeenCalled()
  })

  it('rejects deleting another user private skill', async () => {
    const prismaMock = prisma as any
    prismaMock.skill.findUnique.mockResolvedValue({
      id: 12,
      slug: 'other-user-skill',
      ownerUserId: 2,
      sourceType: 'github',
      visibility: 'user_private',
      versions: [],
    })

    const app = createApp()
    const res = await app.request('http://localhost/12', {
      method: 'DELETE',
      headers: { 'x-role': 'USER', 'x-user-id': '1' },
    })

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(prismaMock.skill.delete).not.toHaveBeenCalled()
  })

  it('does not remove shared package directory still referenced by another skill', async () => {
    const fs = await import('node:fs/promises')
    const os = await import('node:os')
    const path = await import('node:path')
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aichat-skill-api-'))
    const previousRoot = process.env.SKILL_STORAGE_ROOT
    process.env.SKILL_STORAGE_ROOT = tempRoot
    const packageDir = path.join(tempRoot, 'packages', 'aa', 'aabbcc')
    await fs.mkdir(packageDir, { recursive: true })
    await fs.writeFile(path.join(packageDir, 'SKILL.md'), '# Shared package\n', 'utf8')
    try {
      const prismaMock = prisma as any
      prismaMock.skill.findUnique.mockResolvedValue({
        id: 12,
        slug: 'shared-agent',
        ownerUserId: 1,
        sourceType: 'github',
        visibility: 'user_private',
        versions: [
          {
            id: 101,
            version: '1.0.0',
            manifestJson: '{}',
            packagePath: packageDir,
          },
        ],
      })
      prismaMock.skillVersion.count.mockResolvedValue(2)
      prismaMock.skill.delete.mockResolvedValue({ id: 12 })

      const app = createApp()
      const res = await app.request('http://localhost/12', {
        method: 'DELETE',
        headers: { 'x-role': 'USER', 'x-user-id': '1' },
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.skippedPackageDirs).toEqual([packageDir])
      await expect(fs.stat(packageDir)).resolves.toBeTruthy()
    } finally {
      if (previousRoot == null) {
        delete process.env.SKILL_STORAGE_ROOT
      } else {
        process.env.SKILL_STORAGE_ROOT = previousRoot
      }
      await fs.rm(tempRoot, { recursive: true, force: true })
    }
  })

  it('rejects anonymous store install before invoking installer', async () => {
    const installerMock = skillInstaller as any
    const app = createApp()
    const res = await app.request('http://localhost/install', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-actor': 'anonymous',
      },
      body: JSON.stringify({ itemKey: 'openai-skills:skills/.curated/pdf' }),
    })

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(installerMock.installFromGithub).not.toHaveBeenCalled()
  })

  it('creates a session binding only for an owned session and private active version', async () => {
    const prismaMock = prisma as any
    prismaMock.chatSession.findFirst.mockResolvedValue({ id: 99 })
    prismaMock.skillVersion.findFirst.mockResolvedValue({
      id: 501,
      version: '1.0.0',
      status: 'active',
      skill: {
        id: 12,
        slug: 'private-agent',
        displayName: 'Private Agent',
        ownerUserId: 1,
      },
    })
    prismaMock.skillBinding.upsert.mockResolvedValue({
      id: 77,
      skillId: 12,
      versionId: 501,
      sessionId: 99,
      scopeType: 'session',
      scopeId: '99',
      enabled: true,
      createdByUserId: 1,
    })

    const app = createApp()
    const res = await app.request('http://localhost/sessions/99', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-role': 'USER',
        'x-user-id': '1',
      },
      body: JSON.stringify({ skillId: 12, versionId: 501, enabled: true }),
    })

    expect(res.status).toBe(200)
    expect(prismaMock.skillVersion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 501,
          skillId: 12,
          skill: expect.objectContaining({
            ownerUserId: 1,
            visibility: 'user_private',
            status: 'active',
          }),
        }),
      }),
    )
    expect(prismaMock.skillBinding.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          sessionId: 99,
          createdByUserId: 1,
        }),
      }),
    )
  })
})
