import {
  PythonRuntimeService,
  PythonRuntimeServiceError,
  type PythonRuntimeDependencyItem,
} from './python-runtime-service'

const createMockPrisma = () => ({
  systemSetting: {
    findMany: jest.fn(async () => []),
    upsert: jest.fn(async () => ({})),
  },
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
    expect(plan.keptByManual).toEqual(['pandas'])
    expect(plan.removablePackages).toEqual(['scipy'])
  })
})
