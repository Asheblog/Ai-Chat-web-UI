import { EventEmitter } from 'node:events'
import { runPythonSnippet } from './python-runner'
import { pythonRuntimeService } from '../services/python-runtime'

jest.mock('node:child_process', () => ({
  spawn: jest.fn(),
}))

jest.mock('../services/python-runtime', () => ({
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

describe('runPythonSnippet', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(pythonRuntimeService.getManagedPythonPath as jest.Mock).mockResolvedValue('/runtime/python')
    ;(pythonRuntimeService.getAutoInstallOnMissing as jest.Mock).mockResolvedValue(true)
    ;(pythonRuntimeService.parseMissingRequirementsFromOutput as jest.Mock).mockReturnValue([])
    ;(pythonRuntimeService.installRequirements as jest.Mock).mockResolvedValue({})
  })

  it('auto installs missing requirements for logged-in users and retries', async () => {
    const runs: SpawnResult[] = [
      {
        stderr: "ModuleNotFoundError: No module named 'yaml'",
        code: 1,
      },
      {
        stdout: 'ok',
        code: 0,
      },
    ]
    spawn.mockImplementation(() => makeChildProcess(runs.shift() || { code: 0 }))
    ;(pythonRuntimeService.parseMissingRequirementsFromOutput as jest.Mock).mockReturnValue(['pyyaml'])

    const result = await runPythonSnippet({
      code: 'import yaml\nprint("ok")',
      actorUserId: 7,
      timeoutMs: 5_000,
      maxOutputChars: 5_000,
      maxSourceChars: 5_000,
    })

    expect(spawn).toHaveBeenCalledTimes(2)
    expect(pythonRuntimeService.installRequirements).toHaveBeenCalledWith({
      requirements: ['pyyaml'],
      source: 'python_auto',
    })
    expect(result.stdout.trim()).toBe('ok')
    expect(result.exitCode).toBe(0)
    expect(result.autoInstalledRequirements).toEqual(['pyyaml'])
  })

  it('does not auto install for anonymous users', async () => {
    spawn.mockImplementation(() =>
      makeChildProcess({
        stderr: "ModuleNotFoundError: No module named 'yaml'",
        code: 1,
      }),
    )
    ;(pythonRuntimeService.parseMissingRequirementsFromOutput as jest.Mock).mockReturnValue(['pyyaml'])

    const result = await runPythonSnippet({
      code: 'import yaml',
      actorUserId: null,
      timeoutMs: 5_000,
      maxOutputChars: 5_000,
      maxSourceChars: 5_000,
    })

    expect(spawn).toHaveBeenCalledTimes(1)
    expect(pythonRuntimeService.installRequirements).not.toHaveBeenCalled()
    expect(result.exitCode).toBe(1)
    expect(result.autoInstalledRequirements).toBeUndefined()
  })

  it('keeps original error and appends install failure reason', async () => {
    spawn.mockImplementation(() =>
      makeChildProcess({
        stderr: "ModuleNotFoundError: No module named 'yaml'",
        code: 1,
      }),
    )
    ;(pythonRuntimeService.parseMissingRequirementsFromOutput as jest.Mock).mockReturnValue(['pyyaml'])
    ;(pythonRuntimeService.installRequirements as jest.Mock).mockRejectedValue(new Error('pip failed'))

    const result = await runPythonSnippet({
      code: 'import yaml',
      actorUserId: 1,
      timeoutMs: 5_000,
      maxOutputChars: 5_000,
      maxSourceChars: 5_000,
    })

    expect(spawn).toHaveBeenCalledTimes(1)
    expect(result.stderr).toContain("ModuleNotFoundError: No module named 'yaml'")
    expect(result.stderr).toContain('自动安装依赖失败：pip failed')
    expect(result.exitCode).toBe(1)
  })
})
