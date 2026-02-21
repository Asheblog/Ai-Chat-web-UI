import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import type { SkillRuntimeManifest } from '../types'
import { pythonRuntimeService } from '../../../services/python-runtime'

export interface RuntimeExecutionOptions {
  runtime: SkillRuntimeManifest
  packageRoot: string
  entry: string
  input: Record<string, unknown>
  timeoutMs?: number
  maxOutputChars?: number
}

export interface RuntimeExecutionResult {
  stdout: string
  stderr: string
  exitCode: number | null
  durationMs: number
  truncated: boolean
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

export async function executeSkillRuntime(options: RuntimeExecutionOptions): Promise<RuntimeExecutionResult> {
  const entryFile = path.resolve(options.packageRoot, options.entry)
  const timeoutMs = Math.max(1000, options.timeoutMs ?? options.runtime.timeout_ms ?? 30000)
  const maxOutputChars = Math.max(256, options.maxOutputChars ?? options.runtime.max_output_chars ?? 20000)
  const startedAt = Date.now()
  const inputJson = JSON.stringify(options.input)
  const env = {
    ...process.env,
    ...(options.runtime.env || {}),
    AICHAT_SKILL_PAYLOAD_JSON: inputJson,
  }

  const cmd = resolveExecutionCommand(options.runtime, entryFile)
  if (options.runtime.type === 'python') {
    cmd.command = await pythonRuntimeService.getManagedPythonPath()
  }

  const runOnce = (command: string) =>
    new Promise<RuntimeExecutionResult>((resolve, reject) => {
      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []
      let stdoutLength = 0
      let stderrLength = 0
      let truncated = false

      const child = spawn(command, cmd.args, {
        cwd: options.packageRoot,
        env,
        stdio: 'pipe',
      })

      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error(`Skill runtime timeout (${timeoutMs}ms)`))
      }, timeoutMs)

      child.on('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })

      child.stdout.on('data', (chunk: Buffer) => {
        const result = collectWithLimit(stdoutChunks, chunk, stdoutLength, maxOutputChars)
        stdoutLength = result.length
        if (result.truncated) truncated = true
      })

      child.stderr.on('data', (chunk: Buffer) => {
        const result = collectWithLimit(stderrChunks, chunk, stderrLength, maxOutputChars)
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

      child.stdin.write(inputJson)
      child.stdin.end()
    })

  return runOnce(cmd.command)
}
