import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import type { SkillRuntimeManifest } from '../types'
import { pythonRuntimeService } from '../../../services/python-runtime'
import { DockerExecutor, dockerExecutor } from '../../../services/workspace/docker-executor'
import { getAppConfig } from '../../../config/app-config'

const SAFE_ENV_KEYS = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'TMPDIR',
  'TEMP',
  'TMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LC_MESSAGES',
  'PYTHONPATH',
  'PYTHONUNBUFFERED',
  'PYTHONIOENCODING',
  'NODE_PATH',
  'SHELL',
  'TERM',
  'COLORTERM',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
])

const MAX_AUTO_INSTALL_ROUNDS = 3

function buildSafeEnv(skillEnv?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {}

  for (const key of SAFE_ENV_KEYS) {
    const value = process.env[key]
    if (value !== undefined) {
      env[key] = value
    }
  }

  if (skillEnv) {
    for (const [key, value] of Object.entries(skillEnv)) {
      if (key.trim().length > 0 && !key.startsWith('AICHAT_') && value != null && String(value).trim().length > 0) {
        env[key] = String(value)
      }
    }
  }

  return env
}

export interface RuntimeExecutionOptions {
  runtime: SkillRuntimeManifest
  packageRoot: string
  entry: string
  input: Record<string, unknown>
  actorUserId?: number | null
  skillId?: number
  versionId?: number
  timeoutMs?: number
  maxOutputChars?: number
}

export interface RuntimeExecutionResult {
  stdout: string
  stderr: string
  exitCode: number | null
  durationMs: number
  truncated: boolean
  autoInstalledRequirements?: string[]
}

function resolveExecutionCommand(runtime: SkillRuntimeManifest, entryFile: string): { command: string; args: string[] } {
  const runtimeArgs = Array.isArray(runtime.args) ? runtime.args : []
  const normalizedType = runtime.type
  const isWindows = os.platform() === 'win32'

  switch (normalizedType) {
    case 'node': {
      const command = runtime.command?.trim() || process.execPath
      return { command, args: [...runtimeArgs, entryFile] }
    }
    case 'python': {
      const command = runtime.command?.trim() || ''
      return { command, args: [...runtimeArgs, entryFile] }
    }
    case 'shell': {
      if (isWindows) {
        const command = runtime.command?.trim() || 'powershell'
        const script = `${quotePowerShell(entryFile)}`
        return {
          command,
          args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
        }
      }
      const command = runtime.command?.trim() || 'bash'
      return { command, args: ['-lc', `${quotePosix(entryFile)}`] }
    }
    case 'powershell': {
      const command = runtime.command?.trim() || 'powershell'
      return {
        command,
        args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', entryFile],
      }
    }
    case 'cmd': {
      if (isWindows) {
        const command = runtime.command?.trim() || 'cmd'
        return { command, args: ['/d', '/s', '/c', entryFile] }
      }
      const command = runtime.command?.trim() || 'bash'
      return { command, args: ['-lc', `${quotePosix(entryFile)}`] }
    }
    default:
      return { command: process.execPath, args: [entryFile] }
  }
}

function quotePosix(input: string): string {
  return `'${input.replace(/'/g, `'\\''`)}'`
}

function quotePowerShell(input: string): string {
  return `'${input.replace(/'/g, "''")}'`
}

function collectWithLimit(chunks: Buffer[], chunk: Buffer, currentLength: number, limit: number): { length: number; truncated: boolean } {
  const nextLength = currentLength + chunk.length
  if (nextLength <= limit) {
    chunks.push(chunk)
    return { length: nextLength, truncated: false }
  }
  const remain = limit - currentLength
  if (remain > 0) {
    chunks.push(chunk.subarray(0, remain))
  }
  return { length: limit, truncated: true }
}

function spawnWithTimeout(options: {
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
  stdin: string
  timeoutMs: number
  maxOutputChars: number
}): Promise<RuntimeExecutionResult> {
  const startedAt = Date.now()
  return new Promise((resolve, reject) => {
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let stdoutLength = 0
    let stderrLength = 0
    let truncated = false

    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: 'pipe',
    })

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`Skill runtime timeout (${options.timeoutMs}ms)`))
    }, options.timeoutMs)

    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })

    child.stdout.on('data', (chunk: Buffer) => {
      const result = collectWithLimit(stdoutChunks, chunk, stdoutLength, options.maxOutputChars)
      stdoutLength = result.length
      if (result.truncated) truncated = true
    })

    child.stderr.on('data', (chunk: Buffer) => {
      const result = collectWithLimit(stderrChunks, chunk, stderrLength, options.maxOutputChars)
      stderrLength = result.length
      if (result.truncated) truncated = true
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode: typeof code === 'number' ? code : null,
        durationMs: Math.max(0, Date.now() - startedAt),
        truncated,
      })
    })

    child.stdin.write(options.stdin)
    child.stdin.end()
  })
}

function extractMissingModuleRequirements(output: string): string[] {
  const regex = /No module named ['"]?([^'"\r\n]+)['"]?/gi
  const found = new Set<string>()
  let match: RegExpExecArray | null
  while ((match = regex.exec(output)) !== null) {
    const moduleName = (match[1] || '').trim().toLowerCase()
    if (!moduleName) continue
    if (!/^[A-Za-z0-9_.-]+$/.test(moduleName)) continue
    found.add(moduleName)
  }
  return Array.from(found)
}

function toContainerEntryPath(entryFile: string, packageRoot: string): string {
  const rel = path.relative(packageRoot, entryFile)
  if (!rel || path.isAbsolute(rel) || rel.startsWith('..')) {
    return `/skill/${path.basename(entryFile)}`
  }
  return `/skill/${rel.split(path.sep).join('/')}`
}

async function executeInDockerSandbox(
  executor: DockerExecutor,
  workspaceRoot: string,
  options: {
    command: string[]
    workdir: string
    readOnlyMounts: Array<{ source: string; target: string }>
    stdin?: string
    timeoutMs: number
    maxOutputChars: number
    networkMode: 'none' | 'default'
    env?: Record<string, string>
  },
): Promise<{
  stdout: string
  stderr: string
  exitCode: number | null
  truncated: boolean
  timeout: boolean
}> {
  // Write a temporary wrapper script to set up environment and run the command
  const scriptId = randomUUID()
  const scriptRelativePath = path.join('.meta', 'runs', `${scriptId}.sh`)
  const scriptAbsolutePath = path.resolve(workspaceRoot, scriptRelativePath)
  await fs.mkdir(path.dirname(scriptAbsolutePath), { recursive: true })

  const envExports = Object.entries(options.env || {})
    .filter(([k, v]) => k && v)
    .map(([k, v]) => `export ${k}='${v.replace(/'/g, `'\\''`)}'`)
    .join('\n')

  const cmdLine = options.command.map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ')
  await fs.writeFile(scriptAbsolutePath, `#!/bin/bash\nset -e\n${envExports}\nexec ${cmdLine}\n`, 'utf8')
  await fs.chmod(scriptAbsolutePath, 0o755)

  const runResult = await executor.run({
    workspaceRoot,
    command: ['/bin/bash', `/workspace/${scriptRelativePath.split(path.sep).join('/')}`],
    stdin: options.stdin,
    timeoutMs: options.timeoutMs,
    maxOutputChars: options.maxOutputChars,
    networkMode: options.networkMode,
    workdir: options.workdir,
    readOnlyMounts: options.readOnlyMounts,
  })

  return {
    stdout: runResult.stdout,
    stderr: runResult.stderr,
    exitCode: runResult.exitCode,
    truncated: runResult.truncated,
    timeout: runResult.timeout,
  }
}

async function executePythonSkillInDocker(options: {
  executor: DockerExecutor
  workspaceRoot: string
  packageRoot: string
  entryFile: string
  inputJson: string
  timeoutMs: number
  maxOutputChars: number
  env: Record<string, string>
  actorUserId?: number | null
  skillId?: number
  versionId?: number
}): Promise<RuntimeExecutionResult> {
  const {
    executor,
    workspaceRoot,
    packageRoot,
    entryFile,
    inputJson,
    timeoutMs,
    maxOutputChars,
    env,
  } = options

  const containerEntry = toContainerEntryPath(entryFile, packageRoot)

  // Ensure venv exists in workspace
  const venvPythonPath = path.resolve(workspaceRoot, '.venv', 'bin', 'python')
  const venvExists = await fs.access(venvPythonPath).then(() => true).catch(() => false)
  if (!venvExists) {
    const createResult = await executor.run({
      workspaceRoot,
      command: ['python', '-m', 'venv', '/workspace/.venv'],
      timeoutMs: Math.max(10_000, timeoutMs),
      maxOutputChars: 10_000,
      networkMode: 'none',
    })
    if ((createResult.exitCode ?? 1) !== 0) {
      throw new Error(`初始化 Python 虚拟环境失败：${createResult.stderr || createResult.stdout || 'unknown error'}`)
    }
  }

  const autoInstalledRequirements: string[] = []
  const installedSet = new Set<string>()
  let installFailureReason = ''
  let attempt = 0
  let lastResult: { stdout: string; stderr: string; exitCode: number | null; truncated: boolean } | null = null

  while (attempt <= MAX_AUTO_INSTALL_ROUNDS) {
    const runResult = await executeInDockerSandbox(executor, workspaceRoot, {
      command: ['/workspace/.venv/bin/python', containerEntry],
      workdir: '/skill',
      readOnlyMounts: [{ source: packageRoot, target: '/skill' }],
      stdin: inputJson,
      timeoutMs,
      maxOutputChars,
      networkMode: 'none',
      env: {
        ...env,
        PYTHONUNBUFFERED: '1',
        PYTHONDONTWRITEBYTECODE: '1',
        HOME: '/workspace',
      },
    })

    const detectedMissing = extractMissingModuleRequirements(`${runResult.stderr}\n${runResult.stdout}`)
      .filter((name) => !installedSet.has(name))

    lastResult = {
      stdout: runResult.stdout,
      stderr: runResult.stderr,
      exitCode: runResult.exitCode,
      truncated: runResult.truncated,
    }

    if ((runResult.exitCode ?? 1) === 0 && detectedMissing.length === 0) {
      break
    }

    if (attempt >= MAX_AUTO_INSTALL_ROUNDS) {
      break
    }

    if (detectedMissing.length === 0) {
      break
    }

    // Map module names to pip requirements and install in Docker
    const requirements = detectedMissing
      .map((mod) => {
        const req = pythonRuntimeService.parseMissingRequirementsFromOutput(`No module named '${mod}'`)
        return req.length > 0 ? req[0] : null
      })
      .filter((r): r is string => r !== null)
      .slice(0, 16)

    if (requirements.length === 0) {
      break
    }

    try {
      const installResult = await executor.run({
        workspaceRoot,
        command: [
          '/workspace/.venv/bin/python',
          '-m', 'pip', 'install',
          '--disable-pip-version-check',
          '--no-input',
          ...requirements,
        ],
        timeoutMs: 300_000,
        maxOutputChars: 20_000,
        networkMode: 'default',
      })

      if ((installResult.exitCode ?? 1) !== 0) {
        installFailureReason = `pip install 失败（exit code: ${installResult.exitCode}）：${installResult.stderr || installResult.stdout || 'unknown error'}`
        break
      }

      for (const requirement of requirements) {
        installedSet.add(requirement)
        autoInstalledRequirements.push(requirement)
      }
    } catch (err) {
      installFailureReason = err instanceof Error ? err.message : String(err || 'pip install 失败')
      break
    }

    attempt += 1
  }

  if (!lastResult) {
    throw new Error('Python 执行失败')
  }

  const stderrLines: string[] = []
  if (lastResult.stderr?.trim()) stderrLines.push(lastResult.stderr.trim())
  if (installFailureReason) stderrLines.push(`自动安装依赖失败：${installFailureReason}`)

  return {
    ...lastResult,
    stderr: stderrLines.join('\n'),
    autoInstalledRequirements: autoInstalledRequirements.length > 0 ? autoInstalledRequirements : undefined,
    durationMs: 0,
  }
}

export async function executeSkillRuntime(options: RuntimeExecutionOptions): Promise<RuntimeExecutionResult> {
  const entryFile = path.resolve(options.packageRoot, options.entry)
  const timeoutMs = Math.max(1000, options.timeoutMs ?? options.runtime.timeout_ms ?? 30000)
  const maxOutputChars = Math.max(256, options.maxOutputChars ?? options.runtime.max_output_chars ?? 20000)
  const startedAt = Date.now()
  const inputJson = JSON.stringify(options.input)
  const env = buildSafeEnv(options.runtime.env)
  env['AICHAT_SKILL_PAYLOAD_JSON'] = inputJson

  // Python runtime: execute in Docker sandbox
  if (options.runtime.type === 'python') {
    const config = getAppConfig().workspace
    const workspaceRoot = path.resolve(config.rootDir, 'skills', String(options.skillId || 'adhoc'))
    await fs.mkdir(workspaceRoot, { recursive: true })

    const result = await executePythonSkillInDocker({
        executor: dockerExecutor,
        workspaceRoot,
        packageRoot: options.packageRoot,
        entryFile,
        inputJson,
        timeoutMs,
        maxOutputChars,
        env,
        actorUserId: options.actorUserId ?? null,
        skillId: options.skillId,
        versionId: options.versionId,
      })

      return {
        ...result,
        durationMs: Math.max(0, Date.now() - startedAt),
      }
  }

  // Non-Python runtimes: spawn on host with whitelisted env
  const cmd = resolveExecutionCommand(options.runtime, entryFile)

  const runOnce = (command: string) =>
    spawnWithTimeout({
      command,
      args: cmd.args,
      cwd: options.packageRoot,
      env,
      stdin: inputJson,
      timeoutMs,
      maxOutputChars,
    })

  let result = await runOnce(cmd.command)
  return result
}
