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

jest.mock('../../services/python-runtime', () => {
  class PythonRuntimeServiceError extends Error {
    statusCode: number
    code: string
    details?: Record<string, unknown>

    constructor(
      message: string,
      statusCode = 400,
      code = 'PYTHON_RUNTIME_ERROR',
      details?: Record<string, unknown>,
    ) {
      super(message)
      this.name = 'PythonRuntimeServiceError'
      this.statusCode = statusCode
      this.code = code
      this.details = details
    }
  }

  return {
    pythonRuntimeService: {},
    PythonRuntimeServiceError,
  }
})

jest.mock('../../services/settings/settings-facade', () => {
  class SettingsServiceError extends Error {
    statusCode: number

    constructor(message: string, statusCode = 400) {
      super(message)
      this.name = 'SettingsServiceError'
      this.statusCode = statusCode
    }
  }

  class HealthServiceError extends Error {
    statusCode: number

    constructor(message: string, statusCode = 503) {
      super(message)
      this.name = 'HealthServiceError'
      this.statusCode = statusCode
    }
  }

  return {
    settingsFacade: {},
    SettingsServiceError,
    HealthServiceError,
  }
})

import { createSettingsApi } from '../settings'
import { PythonRuntimeServiceError } from '../../services/python-runtime'
import type { PythonRuntimeService } from '../../services/python-runtime/python-runtime-service'
import type { SettingsFacade } from '../../services/settings/settings-facade'

const createPythonRuntimeMock = (): jest.Mocked<PythonRuntimeService> =>
  ({
    getIndexes: jest.fn(),
    getAutoInstallOnActivate: jest.fn(),
    updateIndexes: jest.fn(),
    getRuntimeStatus: jest.fn(),
    installRequirements: jest.fn(),
    uninstallPackages: jest.fn(),
    reconcile: jest.fn(),
    collectActiveDependencies: jest.fn(),
    analyzeConflicts: jest.fn(),
    ensureManagedRuntime: jest.fn(),
    resolvePaths: jest.fn(),
    getManagedPythonPath: jest.fn(),
    listInstalledPackages: jest.fn(),
  }) as unknown as jest.Mocked<PythonRuntimeService>

const createFacadeMock = (): SettingsFacade => ({}) as SettingsFacade

describe('settings python-runtime api', () => {
  it('GET /python-runtime 管理员可读状态', async () => {
    const runtime = createPythonRuntimeMock()
    runtime.getRuntimeStatus.mockResolvedValue({
      dataRoot: '/app/data',
      runtimeRoot: '/app/data/python-runtime',
      venvPath: '/app/data/python-runtime/venv',
      pythonPath: '/app/data/python-runtime/venv/bin/python',
      ready: true,
      indexes: {
        indexUrl: 'https://pypi.org/simple',
        extraIndexUrls: [],
        trustedHosts: [],
        autoInstallOnActivate: true,
        autoInstallOnMissing: true,
      },
      manualPackages: [],
      installedPackages: [{ name: 'numpy', version: '2.1.0' }],
      packageSources: [{ name: 'numpy', sources: ['manual'] }],
      activeDependencies: [],
      conflicts: [],
    })

    const app = createSettingsApi({
      settingsFacade: createFacadeMock(),
      pythonRuntimeService: runtime,
    })

    const res = await app.request('http://localhost/python-runtime', {
      method: 'GET',
      headers: { 'x-role': 'ADMIN' },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.pythonPath).toBe('/app/data/python-runtime/venv/bin/python')
    expect(runtime.getRuntimeStatus).toHaveBeenCalledTimes(1)
  })

  it('GET /python-runtime 非管理员被拒绝', async () => {
    const runtime = createPythonRuntimeMock()
    const app = createSettingsApi({
      settingsFacade: createFacadeMock(),
      pythonRuntimeService: runtime,
    })

    const res = await app.request('http://localhost/python-runtime', {
      method: 'GET',
      headers: { 'x-role': 'USER' },
    })

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(runtime.getRuntimeStatus).not.toHaveBeenCalled()
  })

  it('POST /python-runtime/uninstall 被激活依赖占用时返回 409', async () => {
    const runtime = createPythonRuntimeMock()
    runtime.uninstallPackages.mockRejectedValue(
      new PythonRuntimeServiceError(
        '存在激活 Skill 依赖，禁止卸载',
        409,
        'PYTHON_RUNTIME_PACKAGE_IN_USE',
        {
          blocked: [{ packageName: 'numpy', skillSlug: 'data-agent' }],
        },
      ),
    )

    const app = createSettingsApi({
      settingsFacade: createFacadeMock(),
      pythonRuntimeService: runtime,
    })

    const res = await app.request('http://localhost/python-runtime/uninstall', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-role': 'ADMIN' },
      body: JSON.stringify({ packages: ['numpy'] }),
    })

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.data.code).toBe('PYTHON_RUNTIME_PACKAGE_IN_USE')
    expect(body.data.details.blocked).toEqual(
      expect.arrayContaining([expect.objectContaining({ packageName: 'numpy' })]),
    )
  })

  it('PUT /python-runtime/indexes 支持 autoInstallOnMissing', async () => {
    const runtime = createPythonRuntimeMock()
    runtime.updateIndexes.mockResolvedValue({
      indexUrl: 'https://pypi.org/simple',
      extraIndexUrls: [],
      trustedHosts: [],
      autoInstallOnActivate: true,
      autoInstallOnMissing: false,
    })

    const app = createSettingsApi({
      settingsFacade: createFacadeMock(),
      pythonRuntimeService: runtime,
    })

    const res = await app.request('http://localhost/python-runtime/indexes', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-role': 'ADMIN' },
      body: JSON.stringify({
        indexUrl: 'https://pypi.org/simple',
        autoInstallOnMissing: false,
      }),
    })

    expect(res.status).toBe(200)
    expect(runtime.updateIndexes).toHaveBeenCalledWith({
      indexUrl: 'https://pypi.org/simple',
      autoInstallOnMissing: false,
    })
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.autoInstallOnMissing).toBe(false)
  })
})
