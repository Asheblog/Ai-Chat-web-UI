import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { workspaceService } from '../../../services/workspace/workspace-service'
import {
  ensureHttpsGitUrl,
  resolveWorkspacePath,
} from '../../../services/workspace/workspace-path'
import { WorkspaceServiceError } from '../../../services/workspace/workspace-errors'
import type {
  IToolHandler,
  ToolCall,
  ToolCallContext,
  ToolDefinition,
  ToolHandlerResult,
  WorkspaceHandlerConfig,
} from './types'

const sanitizeRepoFolderName = (value: string) => {
  const trimmed = (value || '').trim()
  if (!trimmed) return null
  if (trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) {
    return null
  }
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) {
    return null
  }
  return trimmed
}

const deriveRepoNameFromUrl = (rawUrl: string) => {
  try {
    const parsed = new URL(rawUrl)
    const parts = parsed.pathname.split('/').filter(Boolean)
    const last = parts[parts.length - 1] || 'repo'
    const withoutGit = last.replace(/\.git$/i, '')
    return sanitizeRepoFolderName(withoutGit) || 'repo'
  } catch {
    return 'repo'
  }
}

const runGitClone = async (params: {
  cwd: string
  url: string
  branch?: string
  targetPath: string
  timeoutMs: number
}) => {
  const args = ['clone', '--depth=1']
  if (params.branch) {
    args.push('--branch', params.branch, '--single-branch')
  }
  args.push(params.url, params.targetPath)

  return new Promise<{ stdout: string; stderr: string; exitCode: number | null; durationMs: number }>((resolve, reject) => {
    const startedAt = Date.now()
    const child = spawn('git', args, {
      cwd: params.cwd,
      stdio: 'pipe',
      windowsHide: true,
    })

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    const timer =
      params.timeoutMs > 0
        ? setTimeout(() => {
            try {
              child.kill('SIGKILL')
            } catch {
              // ignore
            }
            reject(
              new WorkspaceServiceError(
                `git clone 超时（${params.timeoutMs}ms）`,
                408,
                'WORKSPACE_GIT_CLONE_TIMEOUT',
              ),
            )
          }, params.timeoutMs)
        : null

    child.on('error', (error: any) => {
      if (timer) clearTimeout(timer)
      if (error?.code === 'ENOENT') {
        reject(new WorkspaceServiceError('系统未安装 git', 503, 'WORKSPACE_GIT_NOT_AVAILABLE'))
        return
      }
      reject(error)
    })

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))

    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode: typeof code === 'number' ? code : null,
        durationMs: Math.max(0, Date.now() - startedAt),
      })
    })
  })
}

export class WorkspaceGitCloneToolHandler implements IToolHandler {
  readonly toolName = 'workspace_git_clone'
  private readonly config: WorkspaceHandlerConfig

  constructor(config: WorkspaceHandlerConfig) {
    this.config = config
  }

  get toolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: 'workspace_git_clone',
        description:
          'Clone a public Git repository into /workspace/repos for code analysis. Only https URLs are allowed.',
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'Git repository URL (https only).',
            },
            branch: {
              type: 'string',
              description: 'Optional branch name. Defaults to repository default branch.',
            },
            target: {
              type: 'string',
              description: 'Optional destination folder name under /workspace/repos.',
            },
          },
          required: ['url'],
        },
      },
    }
  }

  canHandle(toolName: string): boolean {
    return toolName === this.toolName
  }

  async handle(
    toolCall: ToolCall,
    args: Record<string, unknown>,
    context: ToolCallContext,
  ): Promise<ToolHandlerResult> {
    const callId = toolCall.id || randomUUID()
    const urlRaw = typeof args.url === 'string' ? args.url : ''
    const branchRaw = typeof args.branch === 'string' ? args.branch.trim() : ''
    const targetRaw = typeof args.target === 'string' ? args.target : ''

    let url = ''
    try {
      url = ensureHttpsGitUrl(urlRaw)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'git 地址无效'
      context.sendToolEvent({
        id: callId,
        tool: this.toolName,
        stage: 'error',
        error: message,
      })
      return {
        toolCallId: callId,
        toolName: this.toolName,
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          name: this.toolName,
          content: JSON.stringify({ error: message }),
        },
      }
    }

    const targetFolder =
      sanitizeRepoFolderName(targetRaw) ||
      deriveRepoNameFromUrl(url)

    if (!targetFolder) {
      const message = 'target 目录名无效'
      context.sendToolEvent({ id: callId, tool: this.toolName, stage: 'error', error: message })
      return {
        toolCallId: callId,
        toolName: this.toolName,
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          name: this.toolName,
          content: JSON.stringify({ error: message }),
        },
      }
    }

    const branch = branchRaw || undefined

    context.sendToolEvent({
      id: callId,
      tool: this.toolName,
      stage: 'start',
      summary: `开始克隆仓库到 repos/${targetFolder}`,
      details: {
        url,
        branch,
        target: `repos/${targetFolder}`,
      },
    })

    try {
      const workspace = await workspaceService.ensureWorkspace(context.sessionId)
      const targetRelativePath = path.join('repos', targetFolder)
      const targetResolved = await resolveWorkspacePath(workspace.rootPath, targetRelativePath, {
        allowRoot: false,
        requireExists: false,
      })

      const alreadyExists = await fs
        .access(targetResolved.absolutePath)
        .then(() => true)
        .catch(() => false)
      if (alreadyExists) {
        throw new WorkspaceServiceError(
          `目标目录已存在：${targetResolved.relativePath}`,
          409,
          'WORKSPACE_GIT_TARGET_EXISTS',
        )
      }

      const cloneResult = await runGitClone({
        cwd: workspace.rootPath,
        url,
        branch,
        targetPath: targetResolved.absolutePath,
        timeoutMs: this.config.gitCloneTimeoutMs,
      })

      if ((cloneResult.exitCode ?? 1) !== 0) {
        throw new WorkspaceServiceError(
          cloneResult.stderr.trim() || cloneResult.stdout.trim() || 'git clone 失败',
          500,
          'WORKSPACE_GIT_CLONE_FAILED',
          {
            exitCode: cloneResult.exitCode,
          },
        )
      }

      context.sendToolEvent({
        id: callId,
        tool: this.toolName,
        stage: 'result',
        summary: `仓库已克隆到 ${targetResolved.relativePath}`,
        details: {
          path: targetResolved.relativePath,
          durationMs: cloneResult.durationMs,
          stdout: cloneResult.stdout.trim() || undefined,
        },
      })

      return {
        toolCallId: callId,
        toolName: this.toolName,
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          name: this.toolName,
          content: JSON.stringify({
            ok: true,
            path: targetResolved.relativePath,
            branch: branch || 'default',
            duration_ms: cloneResult.durationMs,
          }),
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'workspace git clone 失败'
      context.sendToolEvent({
        id: callId,
        tool: this.toolName,
        stage: 'error',
        error: message,
      })
      return {
        toolCallId: callId,
        toolName: this.toolName,
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          name: this.toolName,
          content: JSON.stringify({ error: message }),
        },
      }
    }
  }
}
