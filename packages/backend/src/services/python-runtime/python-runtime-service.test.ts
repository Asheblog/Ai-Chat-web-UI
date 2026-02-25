import {
  PythonRuntimeService,
  PythonRuntimeServiceError,
  type PythonRuntimeDependencyItem,
} from './python-runtime-service'

const createMockPrisma = () => ({
  systemSetting: (() => {
    const store = new Map<string, string>()
    return {
      findMany: jest.fn(async (args: any = {}) => {
        const keys = Array.isArray(args?.where?.key?.in) ? args.where.key.in : []
        if (keys.length === 0) return []
        return keys
          .filter((key: string) => store.has(key))
          .map((key: string) => ({ key, value: store.get(key) || '' }))
      }),
      upsert: jest.fn(async (args: any) => {
        const key = String(args?.where?.key || '')
        const value =
          typeof args?.update?.value === 'string'
            ? args.update.value
            : typeof args?.create?.value === 'string'
              ? args.create.value
              : ''
        store.set(key, value)
        return { key, value }
      }),
    }
  })(),
  skill: {
    findMany: jest.fn(async () => []),
  },
})

describe('PythonRuntimeService', () => {
  it('resolves managed runtime paths for linux', () => {
    const prisma = createMockPrisma()
    const service = new PythonRuntimeService({
      prisma: prisma as any,
      env: { APP_DATA_DIR: '/app/data' } as any,
      platform: 'linux',
    })

    const paths = service.resolvePaths()
    expect(paths.dataRoot).toBe('/app/data')
    expect(paths.runtimeRoot).toBe('/app/data/python-runtime')
    expect(paths.venvPath).toBe('/app/data/python-runtime/venv')
    expect(paths.pythonPath).toBe('/app/data/python-runtime/venv/bin/python')
  })

  it('resolves managed runtime paths for windows', () => {
    const prisma = createMockPrisma()
    const service = new PythonRuntimeService({
      prisma: prisma as any,
      env: { APP_DATA_DIR: 'D:\\aichat-data' } as any,
      platform: 'win32',
    })

    const paths = service.resolvePaths()
    expect(paths.pythonPath.toLowerCase()).toContain('scripts')
    expect(paths.pythonPath.toLowerCase().endsWith('python.exe')).toBe(true)
  })

  it('detects dependency conflicts by package name', () => {
    const prisma = createMockPrisma()
    const service = new PythonRuntimeService({ prisma: prisma as any })

    const deps: PythonRuntimeDependencyItem[] = [
      {
        skillId: 1,
        skillSlug: 'alpha',
        skillDisplayName: 'Alpha',
        versionId: 11,
        version: '1.0.0',
        requirement: 'numpy==1.26.4',
        packageName: 'numpy',
      },
      {
        skillId: 2,
        skillSlug: 'beta',
        skillDisplayName: 'Beta',
        versionId: 22,
        version: '2.0.0',
        requirement: 'numpy>=2.0.0',
        packageName: 'numpy',
      },
      {
        skillId: 3,
        skillSlug: 'gamma',
        skillDisplayName: 'Gamma',
        versionId: 33,
        version: '1.0.1',
        requirement: 'pandas>=2.2',
        packageName: 'pandas',
      },
    ]

    const conflicts = service.analyzeConflicts(deps)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].packageName).toBe('numpy')
    expect(conflicts[0].requirements).toEqual(expect.arrayContaining(['numpy==1.26.4', 'numpy>=2.0.0']))
  })

  it('rejects unsafe requirements before executing pip', async () => {
    const prisma = createMockPrisma()
    const service = new PythonRuntimeService({ prisma: prisma as any })

    await expect(
      service.installRequirements({
        requirements: ['git+https://example.com/repo.git'],
        source: 'manual',
      }),
    ).rejects.toThrow(PythonRuntimeServiceError)
  })

  it('defaults autoInstallOnMissing to true when setting is absent', async () => {
    const prisma = createMockPrisma()
    const service = new PythonRuntimeService({ prisma: prisma as any })
    const indexes = await service.getIndexes()
    expect(indexes.autoInstallOnMissing).toBe(true)
  })

  it('extracts safe requirements from missing module errors', () => {
    const prisma = createMockPrisma()
    const service = new PythonRuntimeService({ prisma: prisma as any })
    const requirements = service.parseMissingRequirementsFromOutput(`
Traceback (most recent call last):
  File "<string>", line 1, in <module>
ModuleNotFoundError: No module named 'yaml'
ModuleNotFoundError: No module named cv2
ImportError: No module named 'dateutil.tz'
No module named "unknown_module"
`)

    expect(requirements).toEqual(
      expect.arrayContaining(['opencv-python', 'pyyaml', 'python-dateutil', 'unknown-module']),
    )
  })

  it('includes packageSources in runtime status', async () => {
    const prisma = createMockPrisma()
    const service = new PythonRuntimeService({ prisma: prisma as any })

    jest.spyOn(service, 'getIndexes').mockResolvedValue({
      indexUrl: undefined,
      extraIndexUrls: [],
      trustedHosts: [],
      autoInstallOnActivate: true,
      autoInstallOnMissing: true,
    })
    jest.spyOn(service, 'getManualPackages').mockResolvedValue(['numpy'])
    jest.spyOn(service, 'getPythonAutoPackages').mockResolvedValue(['pyyaml'])
    jest.spyOn(service, 'getSkillAutoPackages').mockResolvedValue(['pandas'])
    jest.spyOn(service, 'collectActiveDependencies').mockResolvedValue([
      {
        skillId: 1,
        skillSlug: 'data-agent',
        skillDisplayName: 'Data Agent',
        versionId: 11,
        version: '1.0.0',
        requirement: 'numpy==2.1.0',
        packageName: 'numpy',
      },
      {
        skillId: 2,
        skillSlug: 'sci-agent',
        skillDisplayName: 'Sci Agent',
        versionId: 22,
        version: '2.0.0',
        requirement: 'scipy>=1.13',
        packageName: 'scipy',
      },
    ])
    jest.spyOn(service, 'ensureManagedRuntime').mockResolvedValue(service.resolvePaths())
    jest.spyOn(service, 'listInstalledPackages').mockResolvedValue([
      { name: 'numpy', version: '2.1.0' },
      { name: 'pandas', version: '2.2.2' },
      { name: 'pyyaml', version: '6.0.1' },
      { name: 'scipy', version: '1.13.1' },
      { name: 'requests', version: '2.32.0' },
    ])

    const status = await service.getRuntimeStatus()
    const sourceMap = new Map(status.packageSources.map((item) => [item.name, item.sources]))
    expect(sourceMap.get('numpy')).toEqual(['manual', 'skill_manifest'])
    expect(sourceMap.get('pandas')).toEqual(['skill_auto'])
    expect(sourceMap.get('pyyaml')).toEqual(['python_auto'])
    expect(sourceMap.get('scipy')).toEqual(['skill_manifest'])
    expect(sourceMap.get('requests')).toEqual([])
  })

  it('tracks python_auto and skill_auto package sources after install and uninstall', async () => {
    const prisma = createMockPrisma()
    const service = new PythonRuntimeService({ prisma: prisma as any })
    const paths = service.resolvePaths()

    jest.spyOn(service, 'ensureManagedRuntime').mockResolvedValue(paths)
    jest.spyOn(service, 'getIndexes').mockResolvedValue({
      indexUrl: undefined,
      extraIndexUrls: [],
      trustedHosts: [],
      autoInstallOnActivate: true,
      autoInstallOnMissing: true,
    })
    jest.spyOn(service as any, 'runCommand').mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      durationMs: 1,
    })
    jest.spyOn(service, 'listInstalledPackages').mockResolvedValue([])
    jest.spyOn(service, 'collectActiveDependencies').mockResolvedValue([])

    await service.installRequirements({
      requirements: ['pyyaml'],
      source: 'python_auto',
    })
    await service.installRequirements({
      requirements: ['pandas'],
      source: 'skill_auto',
      skillId: 1,
      versionId: 2,
    })

    expect(await service.getPythonAutoPackages()).toEqual(['pyyaml'])
    expect(await service.getSkillAutoPackages()).toEqual(['pandas'])

    await service.uninstallPackages(['pyyaml', 'pandas'])
    expect(await service.getPythonAutoPackages()).toEqual([])
    expect(await service.getSkillAutoPackages()).toEqual([])
  })

  it('blocks uninstall when packages are required by active skills', async () => {
    const prisma = createMockPrisma()
    const service = new PythonRuntimeService({ prisma: prisma as any })

    jest.spyOn(service, 'collectActiveDependencies').mockResolvedValue([
      {
        skillId: 1,
        skillSlug: 'calc',
        skillDisplayName: 'Calc',
        versionId: 101,
        version: '1.0.0',
        requirement: 'numpy==2.1.0',
        packageName: 'numpy',
      },
    ])

    await expect(service.uninstallPackages(['numpy'])).rejects.toMatchObject({
      code: 'PYTHON_RUNTIME_PACKAGE_IN_USE',
      statusCode: 409,
    })
  })

  it('cleans up only packages no longer required after skill removal', async () => {
    const prisma = createMockPrisma()
    const service = new PythonRuntimeService({ prisma: prisma as any })

    jest.spyOn(service, 'collectActiveDependencies').mockResolvedValue([
      {
        skillId: 2,
        skillSlug: 'other',
        skillDisplayName: 'Other',
        versionId: 202,
        version: '2.0.0',
        requirement: 'numpy>=2.0',
        packageName: 'numpy',
      },
    ])
    jest.spyOn(service, 'getManualPackages').mockResolvedValue(['pandas'])
    jest.spyOn(service, 'uninstallPackages').mockResolvedValue({
      packages: ['scipy'],
      pipCheckPassed: true,
      pipCheckOutput: '',
      installedPackages: [],
    })

    const result = await service.cleanupPackagesAfterSkillRemoval({
      removedRequirements: ['numpy==2.1.0', 'pandas>=2.2', 'scipy==1.13'],
    })

    expect(service.uninstallPackages).toHaveBeenCalledWith(['scipy'])
    expect(result.removedSkillPackages).toEqual(['numpy', 'pandas', 'scipy'])
    expect(result.keptByActiveSkills).toEqual(['numpy'])
    expect(result.keptByActiveSkillSources).toEqual([
      {
        packageName: 'numpy',
        consumers: [
          expect.objectContaining({
            skillId: 2,
            skillSlug: 'other',
            skillDisplayName: 'Other',
            versionId: 202,
            version: '2.0.0',
            requirement: 'numpy>=2.0',
          }),
        ],
      },
    ])
    expect(result.keptByManual).toEqual(['pandas'])
    expect(result.removablePackages).toEqual(['scipy'])
    expect(result.removedPackages).toEqual(['scipy'])
  })

  it('previews skill cleanup plan without uninstalling', async () => {
    const prisma = createMockPrisma()
    const service = new PythonRuntimeService({ prisma: prisma as any })

    jest.spyOn(service, 'collectActiveDependencies').mockResolvedValue([
      {
        skillId: 2,
        skillSlug: 'other',
        skillDisplayName: 'Other',
        versionId: 202,
        version: '2.0.0',
        requirement: 'numpy>=2.0',
        packageName: 'numpy',
      },
    ])
    jest.spyOn(service, 'getManualPackages').mockResolvedValue(['pandas'])
    const uninstallSpy = jest.spyOn(service, 'uninstallPackages')

    const plan = await service.previewCleanupAfterSkillRemoval({
      removedRequirements: ['numpy==2.1.0', 'pandas>=2.2', 'scipy==1.13'],
    })

    expect(uninstallSpy).not.toHaveBeenCalled()
    expect(plan.removedSkillPackages).toEqual(['numpy', 'pandas', 'scipy'])
    expect(plan.keptByActiveSkills).toEqual(['numpy'])
    expect(plan.keptByActiveSkillSources).toEqual([
      {
        packageName: 'numpy',
        consumers: [
          expect.objectContaining({
            skillId: 2,
            skillSlug: 'other',
            skillDisplayName: 'Other',
            versionId: 202,
            version: '2.0.0',
            requirement: 'numpy>=2.0',
          }),
        ],
      },
    ])
    expect(plan.keptByManual).toEqual(['pandas'])
    expect(plan.removablePackages).toEqual(['scipy'])
  })

  it('returns degraded runtime status when managed runtime is unavailable', async () => {
    const prisma = createMockPrisma()
    const service = new PythonRuntimeService({
      prisma: prisma as any,
      env: { APP_DATA_DIR: '/app/data' } as any,
      platform: 'linux',
    })

    jest.spyOn(service, 'getIndexes').mockResolvedValue({
      indexUrl: undefined,
      extraIndexUrls: [],
      trustedHosts: [],
      autoInstallOnActivate: true,
      autoInstallOnMissing: true,
    })
    jest.spyOn(service, 'getManualPackages').mockResolvedValue([])
    jest.spyOn(service, 'collectActiveDependencies').mockResolvedValue([])
    jest.spyOn(service, 'ensureManagedRuntime').mockRejectedValue(
      new PythonRuntimeServiceError(
        '受管环境 pip 不可用，自动修复失败。',
        500,
        'PYTHON_RUNTIME_PIP_UNAVAILABLE',
        { finalPipCheck: 'No module named pip' },
      ),
    )
    const listInstalledSpy = jest.spyOn(service, 'listInstalledPackages')

    const status = await service.getRuntimeStatus()

    expect(status.ready).toBe(false)
    expect(status.runtimeIssue?.code).toBe('PYTHON_RUNTIME_PIP_UNAVAILABLE')
    expect(status.runtimeIssue?.details).toEqual(
      expect.objectContaining({ finalPipCheck: 'No module named pip' }),
    )
    expect(status.installedPackages).toEqual([])
    expect(listInstalledSpy).not.toHaveBeenCalled()
  })
})
