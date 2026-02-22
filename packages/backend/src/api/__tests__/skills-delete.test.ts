jest.mock('../../middleware/auth', () => ({
  actorMiddleware: async (c: any, next: any) => {
    const role = (c.req.header('x-role') || 'ADMIN').toUpperCase()
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
    skill: {
      findUnique: jest.fn(),
      delete: jest.fn(),
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

describe('skills api - uninstall skill', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('deletes third-party skill and triggers python cleanup', async () => {
    const prismaMock = prisma as any
    const runtimeMock = pythonRuntimeService as any

    prismaMock.skill.findUnique.mockResolvedValue({
      id: 12,
      slug: 'data-agent',
      sourceType: 'github',
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

    const app = createSkillsApi()
    const res = await app.request('http://localhost/12', {
      method: 'DELETE',
      headers: { 'x-role': 'ADMIN' },
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
      sourceType: 'github',
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
      keptByManual: [],
      removablePackages: ['pandas'],
    })

    const app = createSkillsApi()
    const res = await app.request('http://localhost/12/uninstall-plan', {
      method: 'GET',
      headers: { 'x-role': 'ADMIN' },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(runtimeMock.previewCleanupAfterSkillRemoval).toHaveBeenCalledWith({
      removedRequirements: expect.arrayContaining(['numpy==2.1.0', 'pandas>=2.2']),
    })
    expect(body.data.cleanupPlan.removablePackages).toEqual(['pandas'])
  })

  it('blocks uninstalling builtin skill', async () => {
    const prismaMock = prisma as any
    const runtimeMock = pythonRuntimeService as any
    prismaMock.skill.findUnique.mockResolvedValue({
      id: 1,
      slug: 'python-runner',
      sourceType: 'builtin',
      versions: [],
    })

    const app = createSkillsApi()
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

  it('rejects non-admin request', async () => {
    const app = createSkillsApi()
    const res = await app.request('http://localhost/12', {
      method: 'DELETE',
      headers: { 'x-role': 'USER' },
    })

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.success).toBe(false)
  })
})
