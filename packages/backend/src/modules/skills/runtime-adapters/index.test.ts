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

jest.mock('../../../services/workspace/docker-executor', () => ({
  dockerExecutor: {
    run: jest.fn(),
    assertDockerAvailable: jest.fn(),
  },
  DockerExecutor: jest.fn(),
}))

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}))

const { spawn } = jest.requireMock('node:child_process') as {
  spawn: jest.Mock
}

const { dockerExecutor: mockDocker } = jest.requireMock('../../../services/workspace/docker-executor') as {
  dockerExecutor: { run: jest.Mock; assertDockerAvailable: jest.Mock }
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

const makeDockerResult = (result: {
  stdout?: string
  stderr?: string
  exitCode?: number | null
  truncated?: boolean
  timeout?: boolean
}) => ({
  stdout: result.stdout ?? '',
  stderr: result.stderr ?? '',
  exitCode: typeof result.exitCode === 'number' ? result.exitCode : 0,
  durationMs: 100,
  truncated: result.truncated ?? false,
  timeout: result.timeout ?? false,
})

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

  describe('Python runtime (Docker sandbox)', () => {
    it('auto installs missing requirements in Docker sandbox', async () => {
      const dockerRuns = [
        makeDockerResult({
          stderr: "ModuleNotFoundError: No module named 'yaml'",
          exitCode: 1,
        }),
        makeDockerResult({
          stdout: '{"ok":true}',
          exitCode: 0,
        }),
      ]
      // Venv creation + 2 code runs
      mockDocker.run
        .mockResolvedValueOnce(makeDockerResult({ exitCode: 0 })) // venv create
        .mockResolvedValueOnce(dockerRuns[0])                     // run 1 (fail)
        .mockResolvedValueOnce(makeDockerResult({ exitCode: 0 })) // pip install (in background)
        .mockResolvedValueOnce(dockerRuns[1])                     // run 2 (success)
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

      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('{"ok":true}')
      expect(result.autoInstalledRequirements).toEqual(['pyyaml'])
    })

    it('retries at most 3 rounds for auto install in Docker', async () => {
      const requirements = [['alpha-lib'], ['beta-lib'], ['gamma-lib'], ['delta-lib']]
      mockDocker.run
        .mockResolvedValueOnce(makeDockerResult({ exitCode: 0 }))  // venv create
        .mockResolvedValueOnce(makeDockerResult({ stderr: "No module named 'alpha'", exitCode: 1 }))
        .mockResolvedValueOnce(makeDockerResult({ exitCode: 0 }))  // pip install
        .mockResolvedValueOnce(makeDockerResult({ stderr: "No module named 'beta'", exitCode: 1 }))
        .mockResolvedValueOnce(makeDockerResult({ exitCode: 0 }))  // pip install
        .mockResolvedValueOnce(makeDockerResult({ stderr: "No module named 'gamma'", exitCode: 1 }))
        .mockResolvedValueOnce(makeDockerResult({ exitCode: 0 }))  // pip install
        .mockResolvedValueOnce(makeDockerResult({ stderr: "No module named 'delta'", exitCode: 1 }))
      ;(pythonRuntimeService.parseMissingRequirementsFromOutput as jest.Mock)
        .mockReturnValueOnce(requirements[0])
        .mockReturnValueOnce(requirements[1])
        .mockReturnValueOnce(requirements[2])
        .mockReturnValueOnce(requirements[3])

      const result = await executeSkillRuntime({
        runtime: pythonRuntimeManifest as any,
        packageRoot: '/tmp/skill',
        entry: 'main.py',
        input: {},
        actorUserId: 9,
        skillId: 100,
        versionId: 200,
      })

      // 1 venv + 4 code runs + 3 pip installs = 8
      expect(mockDocker.run).toHaveBeenCalledTimes(8)
      expect(result.exitCode).toBe(1)
      expect(result.autoInstalledRequirements).toEqual(['alpha-lib', 'beta-lib', 'gamma-lib'])
    })

    it('skips auto install when no requirements detected', async () => {
      mockDocker.run
        .mockResolvedValueOnce(makeDockerResult({ exitCode: 0 }))  // venv create
        .mockResolvedValueOnce(makeDockerResult({ exitCode: 0, stdout: '{"ok":true}' }))

      const result = await executeSkillRuntime({
        runtime: pythonRuntimeManifest as any,
        packageRoot: '/tmp/skill',
        entry: 'main.py',
        input: {},
        actorUserId: 5,
        skillId: 100,
        versionId: 200,
      })

      // Only venv create + 1 code run + 1 script exec
      expect(result.exitCode).toBe(0)
    })
  })
})
