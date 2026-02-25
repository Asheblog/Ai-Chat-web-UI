import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
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

export class WorkspaceReadTextToolHandler implements IToolHandler {
  readonly toolName = 'workspace_read_text'
  private readonly config: WorkspaceHandlerConfig

  constructor(config: WorkspaceHandlerConfig) {
    this.config = config
  }

  get toolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: 'workspace_read_text',
        description:
          'Read text content from a file inside workspace. Use this for source code, markdown, json, csv and logs.',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Relative file path inside workspace.',
            },
            maxChars: {
              type: 'number',
              description: 'Maximum characters to return.',
            },
          },
          required: ['path'],
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
    const targetPath = typeof args.path === 'string' ? args.path : ''
    const rawMaxChars = Number(args.maxChars)
    const maxChars = Number.isFinite(rawMaxChars)
      ? Math.max(128, Math.min(Math.floor(rawMaxChars), this.config.readMaxChars))
      : this.config.readMaxChars

    if (!targetPath.trim()) {
      const message = 'path 参数不能为空'
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

    context.sendToolEvent({
      id: callId,
      tool: this.toolName,
      stage: 'start',
      summary: `读取文件 ${targetPath}`,
      details: {
        path: targetPath,
        maxChars,
      },
    })

    try {
      const workspace = await workspaceService.ensureWorkspace(context.sessionId)
      const resolved = await resolveWorkspacePath(workspace.rootPath, targetPath, {
        allowRoot: false,
        requireExists: true,
      })

      const stat = await fs.stat(resolved.absolutePath)
      if (!stat.isFile()) {
        throw new WorkspaceServiceError('目标路径不是文件', 400, 'WORKSPACE_READ_NOT_FILE')
      }

      const raw = await fs.readFile(resolved.absolutePath)
      const content = raw.toString('utf8')
      const truncated = content.length > maxChars
      const output = truncated ? content.slice(0, maxChars) : content

      context.sendToolEvent({
        id: callId,
        tool: this.toolName,
        stage: 'result',
        summary: `已读取 ${resolved.relativePath}`,
        details: {
          path: resolved.relativePath,
          chars: output.length,
          truncated,
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
            content: output,
            truncated,
            chars: output.length,
          }),
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'workspace 读取文件失败'
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
