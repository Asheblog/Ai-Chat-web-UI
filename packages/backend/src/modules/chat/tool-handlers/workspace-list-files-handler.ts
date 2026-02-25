import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { workspaceService } from '../../../services/workspace/workspace-service'
import { resolveWorkspacePath } from '../../../services/workspace/workspace-path'
import { WorkspaceServiceError } from '../../../services/workspace/workspace-errors'
import type {
  IToolHandler,
  ToolCall,
  ToolCallContext,
  ToolDefinition,
  ToolHandlerResult,
  WorkspaceHandlerConfig,
} from './types'

interface ListedEntry {
  path: string
  kind: 'file' | 'directory'
  sizeBytes?: number
}

const normalizeListPath = (value: string) => {
  const trimmed = (value || '').trim()
  return trimmed || '.'
}

export class WorkspaceListFilesToolHandler implements IToolHandler {
  readonly toolName = 'workspace_list_files'
  private readonly config: WorkspaceHandlerConfig

  constructor(config: WorkspaceHandlerConfig) {
    this.config = config
  }

  get toolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: 'workspace_list_files',
        description:
          'List files and directories inside the current workspace. Use this before reading files or running analysis scripts.',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Relative path inside workspace. Defaults to workspace root.',
            },
            recursive: {
              type: 'boolean',
              description: 'Whether to recursively list subdirectories.',
            },
            maxEntries: {
              type: 'number',
              description: 'Maximum number of entries to return.',
            },
          },
          required: [],
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
    const requestedPath = normalizeListPath(typeof args.path === 'string' ? args.path : '')
    const recursive = Boolean(args.recursive)
    const maxEntriesArg = Number(args.maxEntries)
    const maxEntries = Number.isFinite(maxEntriesArg)
      ? Math.max(1, Math.min(Math.floor(maxEntriesArg), this.config.listMaxEntries))
      : this.config.listMaxEntries

    context.sendToolEvent({
      id: callId,
      tool: this.toolName,
      stage: 'start',
      summary: `列出 ${requestedPath} 下的文件`,
      details: {
        path: requestedPath,
        recursive,
        maxEntries,
      },
    })

    try {
      const workspace = await workspaceService.ensureWorkspace(context.sessionId)
      const resolved = await resolveWorkspacePath(workspace.rootPath, requestedPath, {
        allowRoot: true,
        requireExists: true,
      })

      const stat = await fs.stat(resolved.absolutePath)
      if (!stat.isDirectory()) {
        throw new WorkspaceServiceError('目标路径不是目录', 400, 'WORKSPACE_LIST_NOT_DIRECTORY')
      }

      const entries: ListedEntry[] = []
      const queue = [resolved.absolutePath]

      while (queue.length > 0 && entries.length < maxEntries) {
        const current = queue.shift()!
        const children = await fs.readdir(current, { withFileTypes: true })
        for (const child of children) {
          if (entries.length >= maxEntries) break
          const absolute = path.resolve(current, child.name)
          const relative = path.relative(workspace.rootPath, absolute).split(path.sep).join('/')
          if (!relative) continue

          if (child.isDirectory()) {
            entries.push({ path: relative, kind: 'directory' })
            if (recursive) {
              queue.push(absolute)
            }
            continue
          }

          if (child.isFile()) {
            const fileStat = await fs.stat(absolute).catch(() => null)
            entries.push({
              path: relative,
              kind: 'file',
              sizeBytes: fileStat?.size,
            })
          }
        }
      }

      context.sendToolEvent({
        id: callId,
        tool: this.toolName,
        stage: 'result',
        summary: `共找到 ${entries.length} 个条目`,
        details: {
          path: resolved.relativePath,
          recursive,
          returned: entries.length,
          maxEntries,
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
            path: resolved.relativePath,
            recursive,
            entries,
            truncated: entries.length >= maxEntries,
          }),
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'workspace 列目录失败'
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
