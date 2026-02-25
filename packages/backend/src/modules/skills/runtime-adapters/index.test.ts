import { EventEmitter } from 'node:events'
import { executeSkillRuntime } from './index'
import { pythonRuntimeService } from '../../../services/python-runtime'

jest.mock('node:child_process', () => ({
  spawn: jest.fn(),
}))

jest.mock('../../../services/python-runtime', () => ({
  pythonRuntimeService: {
    getManagedPythonPath: jest.fn(),
    getAutoInstallOnMissing: jest.fn(),
    parseMissingRequirementsFromOutput: jest.fn(),
    installRequirements: jest.fn(),
  },
}))

const { spawn } = jest.requireMock('node:child_process') as {
  spawn: jest.Mock
}

type SpawnResult = {
  stdout?: string
  stderr?: string
  code?: number | null
}

const makeChildProcess = (result: SpawnResult) => {
  const child = new EventEmitter() as any
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.stdin = {
    write: jest.fn(),
    end: jest.fn(),
  }
  child.kill = jest.fn()

  process.nextTick(() => {
    if (typeof result.stdout === 'string' && result.stdout.length > 0) {
      child.stdout.emit('data', Buffer.from(result.stdout))
    }
    if (typeof result.stderr === 'string' && result.stderr.length > 0) {
      child.stderr.emit('data', Buffer.from(result.stderr))
    }
    child.emit('close', typeof result.code === 'number' ? result.code : 0)
  })

  return child
}

const pythonRuntimeManifest = {
  type: 'python',
  command: '',
  args: [],
  timeout_ms: 30_000,
  max_output_chars: 20_000,
  env: {},
}

describe('executeSkillRuntime', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(pythonRuntimeService.getManagedPythonPath as jest.Mock).mockResolvedValue('/runtime/python')
    ;(pythonRuntimeService.getAutoInstallOnMissing as jest.Mock).mockResolvedValue(true)
    ;(pythonRuntimeService.parseMissingRequirementsFromOutput as jest.Mock).mockReturnValue([])
    ;(pythonRuntimeService.installRequirements as jest.Mock).mockResolvedValue({})
  })

  it('auto installs missing requirements for python skill runtime', async () => {
    const runs: SpawnResult[] = [
      {
        stderr: "ModuleNotFoundError: No module named 'yaml'",
        code: 1,
      },
      {
        stdout: '{"ok":true}',
        code: 0,
      },
    ]
    spawn.mockImplementation(() => makeChildProcess(runs.shift() || { code: 0 }))
    ;(pythonRuntimeService.parseMissingRequirementsFromOutput as jest.Mock).mockReturnValue(['pyyaml'])

    const result = await executeSkillRuntime({
      runtime: pythonRuntimeManifest as any,
      packageRoot: '/tmp/skill',
      entry: 'main.py',
      input: { a: 1 },
      actorUserId: 5,
      skillId: 100,
      versionId: 200,
    })

    expect(spawn).toHaveBeenCalledTimes(2)
    expect(pythonRuntimeService.installRequirements).toHaveBeenCalledWith({
      requirements: ['pyyaml'],
      source: 'skill_auto',
      skillId: 100,
      versionId: 200,
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('{"ok":true}')
    expect(result.autoInstalledRequirements).toEqual(['pyyaml'])
  })

  it('retries at most 3 rounds for python skill auto install', async () => {
    const runs: SpawnResult[] = [
      { stderr: "ModuleNotFoundError: No module named 'alpha'", code: 1 },
      { stderr: "ModuleNotFoundError: No module named 'beta'", code: 1 },
      { stderr: "ModuleNotFoundError: No module named 'gamma'", code: 1 },
      { stderr: "ModuleNotFoundError: No module named 'delta'", code: 1 },
    ]
    const parsedRequirements = [['alpha-lib'], ['beta-lib'], ['gamma-lib'], ['delta-lib']]
    spawn.mockImplementation(() => makeChildProcess(runs.shift() || { code: 1 }))
    ;(pythonRuntimeService.parseMissingRequirementsFromOutput as jest.Mock).mockImplementation(
      () => parsedRequirements.shift() || [],
    )

    const result = await executeSkillRuntime({
      runtime: pythonRuntimeManifest as any,
      packageRoot: '/tmp/skill',
      entry: 'main.py',
      input: {},
      actorUserId: 9,
      skillId: 100,
      versionId: 200,
    })

    expect(spawn).toHaveBeenCalledTimes(4)
    expect(pythonRuntimeService.installRequirements).toHaveBeenCalledTimes(3)
    expect(pythonRuntimeService.installRequirements).toHaveBeenNthCalledWith(1, {
      requirements: ['alpha-lib'],
      source: 'skill_auto',
      skillId: 100,
      versionId: 200,
    })
    expect(pythonRuntimeService.installRequirements).toHaveBeenNthCalledWith(2, {
      requirements: ['beta-lib'],
      source: 'skill_auto',
      skillId: 100,
      versionId: 200,
    })
    expect(pythonRuntimeService.installRequirements).toHaveBeenNthCalledWith(3, {
      requirements: ['gamma-lib'],
      source: 'skill_auto',
      skillId: 100,
      versionId: 200,
    })
    expect(result.exitCode).toBe(1)
    expect(result.autoInstalledRequirements).toEqual(['alpha-lib', 'beta-lib', 'gamma-lib'])
  })

  it('skips auto install for anonymous actor', async () => {
    spawn.mockImplementation(() =>
      makeChildProcess({
        stderr: "ModuleNotFoundError: No module named 'yaml'",
        code: 1,
      }),
    )
    ;(pythonRuntimeService.parseMissingRequirementsFromOutput as jest.Mock).mockReturnValue(['pyyaml'])

    const result = await executeSkillRuntime({
      runtime: pythonRuntimeManifest as any,
      packageRoot: '/tmp/skill',
      entry: 'main.py',
      input: {},
      actorUserId: null,
      skillId: 100,
      versionId: 200,
    })

    expect(spawn).toHaveBeenCalledTimes(1)
    expect(pythonRuntimeService.installRequirements).not.toHaveBeenCalled()
    expect(result.exitCode).toBe(1)
  })

  it('keeps original stderr and appends install failure reason', async () => {
    spawn.mockImplementation(() =>
      makeChildProcess({
        stderr: "ModuleNotFoundError: No module named 'yaml'",
        code: 1,
      }),
    )
    ;(pythonRuntimeService.parseMissingRequirementsFromOutput as jest.Mock).mockReturnValue(['pyyaml'])
    ;(pythonRuntimeService.installRequirements as jest.Mock).mockRejectedValue(new Error('pip failed'))

    const result = await executeSkillRuntime({
      runtime: pythonRuntimeManifest as any,
      packageRoot: '/tmp/skill',
      entry: 'main.py',
      input: {},
      actorUserId: 1,
      skillId: 100,
      versionId: 200,
    })

    expect(spawn).toHaveBeenCalledTimes(1)
    expect(result.stderr).toContain("ModuleNotFoundError: No module named 'yaml'")
    expect(result.stderr).toContain('自动安装依赖失败：pip failed')
    expect(result.exitCode).toBe(1)
  })
})
